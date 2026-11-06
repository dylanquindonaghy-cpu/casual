import type { Pool } from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import type { OutboundMessage } from "@/lib/messaging/transport";
import { createRequestUpdateTask, REQUEST_UPDATE_QUEUE } from "@/lib/notices/request-update";
import { answerRequest } from "@/lib/office/quick-actions";
import { loadRequestQueue, type QueueRequest } from "@/lib/office/request-queue";
import {
  answeredBy,
  answerResultText,
  approveHint,
  approveWord,
  askedLines,
  canDecline,
  markAgainHref,
  markedNowText,
  outcomeWord,
  toldText,
} from "@/lib/office/requests-copy";
import { myRequests, withdrawRequest } from "@/lib/portal/requests";
import { resolveRequest } from "@/lib/requests/resolve";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Phase 28.9 on the office's side (docs/screens.md "### 28.9", `/office/enquiries` "Requests from
// the app"), on the real database as the app role: an attendance question ("Says the mark is
// wrong", "Mark again", one action that answers it, stored approved and told as "answered", never
// changing the mark), and a request the casual took back (out of the waiting list, "Taken back" in
// the history; answering it changes nothing). NOW is Monday 2 November 2026, 09:00 London.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));
const { RequestQueueView } = await import("@/app/office/enquiries/request-queue-view");

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const refOf = (id: string) => id.slice(0, 8).toUpperCase();

// Ann was marked not attended at Saturday's session and says she worked it; Ben asked to swap an
// upcoming shift, then took it back.
async function queueFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  await su.query("update office_users set name = 'Sam Rota' where id = $1", [resourcer]);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const past = await f.shift({ startsAt: hoursFromNow(-49) });
  const annBooking = await f.booking(ann, past, "no_show");
  const upcoming = await f.shift({ startsAt: hoursFromNow(53) });
  await f.booking(ben, upcoming);
  const insert = async (
    workerId: string,
    type: string,
    shiftId: string,
    payload: Record<string, unknown>,
  ) =>
    (
      await su.query<{ id: string }>(
        `insert into requests (firm_id, worker_id, shift_id, type, payload, created_at)
         values ($1, $2, $3, $4, $5, $6) returning id::text as id`,
        [f.firmId, workerId, shiftId, type, JSON.stringify(payload), hoursFromNow(-3)],
      )
    ).rows[0]?.id ?? "";
  const attendance = await insert(ann, "attendance", past, {
    said: "worked",
    note: "I signed in at the gate.",
  });
  const swap = await insert(ben, "swap", upcoming, { swapWith: "", note: "" });
  const ctx = {
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: { now: () => NOW },
  };
  const portal = {
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
    run: withFirm,
    clock: { now: () => NOW },
  };
  const queue = () => withFirm(f.firmId, (tx) => loadRequestQueue(tx, NOW));
  const rowOf = async (id: string) =>
    (
      await su.query<{
        status: string;
        resolved_by: string | null;
        resolution_note: string | null;
      }>(
        "select status, resolved_by::text as resolved_by, resolution_note from requests where id = $1",
        [id],
      )
    ).rows[0];
  const markOf = async () =>
    (
      await su.query<{ status: string }>("select status from assignments where id = $1", [
        annBooking,
      ])
    ).rows[0]?.status;
  const eventsOf = async (action: string) =>
    (
      await su.query<{ entity_id: string; data: Record<string, unknown> }>(
        "select entity_id::text, data from events where firm_id = $1 and action = $2 order by id",
        [f.firmId, action],
      )
    ).rows;
  const jobs = async () =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
          order by created_on`,
        [REQUEST_UPDATE_QUEUE, f.firmId],
      )
    ).rows.map((r) => r.data);
  return {
    f,
    resourcer,
    ann,
    ben,
    past,
    annBooking,
    attendance,
    swap,
    ctx,
    portal,
    queue,
    rowOf,
    markOf,
    eventsOf,
    jobs,
  };
}

const find = (list: QueueRequest[], id: string) => list.find((r) => r.requestId === id);
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("an attendance question in Enquiries", () => {
  it("waiting: what she says, the mark now, 'Mark again' to the session's who-worked, and one action", async () => {
    const t = await queueFirm();
    const q = await t.queue();
    const r = find(q.waiting, t.attendance);
    if (!r) throw new Error("the attendance question isn't waiting");
    expect(r.asked.said).toBe("worked");
    expect(r.mark).toBe("no_show");
    expect(askedLines(r)).toEqual([
      "Says the mark is wrong: marked not attended (they say they worked).",
      "Their note: I signed in at the gate.",
    ]);
    expect(markedNowText(r)).toBe("Marked now: Didn't attend.");
    expect(markAgainHref(r)).toBe(`/office/shifts/${t.past}?show=booked#places`);
    expect(approveHint("attendance")).toBe(
      "Answering doesn't change the mark. If it's wrong, mark again first.",
    );
    expect(approveWord("attendance")).toBe("Answer");
    expect(canDecline("attendance")).toBe(false);
    expect(canDecline("swap")).toBe(true);
    // The reverse: she says she didn't work one marked worked.
    expect(askedLines({ ...r, asked: { ...r.asked, said: "not_worked", note: null } })).toEqual([
      "Says the mark is wrong: marked worked (they say they didn't work).",
    ]);

    // On the page: the card has "Mark again" and "Answer and tell Ann", and no decline.
    const html = renderToStaticMarkup(createElement(RequestQueueView, { queue: q }));
    const card = html.split("<li").find((li) => li.includes(`request-${t.attendance}`)) ?? "";
    expect(words(card)).toContain("Attendance question");
    expect(words(card)).toContain(
      "Says the mark is wrong: marked not attended (they say they worked).",
    );
    expect(words(card)).toContain("Marked now: Didn't attend.");
    expect(card).toContain(`href="/office/shifts/${t.past}?show=booked#places"`);
    expect(words(card)).toContain("Mark again");
    expect(words(card)).toContain("Note to Ann (optional)");
    expect(words(card)).toContain("Answer and tell Ann");
    expect(words(card)).not.toContain("Decline");
    // The swap still has both.
    const swapCard = html.split("<li").find((li) => li.includes(`request-${t.swap}`)) ?? "";
    expect(words(swapCard)).toContain("Decline and tell Ben");
    expect(swapCard).not.toContain("Mark again");
  });

  it("answered: stored approved, never changes the mark, and the notice says 'attendance question' and 'answered'", async () => {
    const t = await queueFirm();
    const result = await answerRequest(
      t.ctx,
      t.attendance,
      "approved",
      "We've checked the gate log.",
    );
    expect(result).toEqual({ status: "resolved", decision: "approved" });
    expect(answerResultText(result, "Ann", "attendance")).toBe("Answered. Ann will be told.");
    expect(await t.rowOf(t.attendance)).toMatchObject({
      status: "approved",
      resolved_by: t.resourcer,
      resolution_note: "We've checked the gate log.",
    });
    // The request never changes a mark (golden rule 12).
    expect(await t.markOf()).toBe("no_show");
    expect(await t.eventsOf("shift.completed")).toEqual([]);
    expect(await t.eventsOf("shift.no_show")).toEqual([]);
    expect((await t.eventsOf("request.approved")).map((e) => e.data)).toEqual([
      { type: "attendance", shiftId: t.past, withNote: true },
    ]);

    // The notice job is queued, and its words name the kind and say "answered".
    const [job] = await t.jobs();
    expect(job).toMatchObject({ requestId: t.attendance });
    const sent: OutboundMessage[] = [];
    const task = createRequestUpdateTask(() => ({
      transport: {
        name: "capture",
        async send(m) {
          sent.push(m);
          return { providerMessageId: `id-${sent.length}` };
        },
      },
      push: {
        name: "capture",
        async send() {
          return { status: "sent" };
        },
      },
      clock: { now: () => NOW },
    }));
    expect(await runFirmTask(task, { id: "job", data: job ?? {} }, withFirm)).toMatchObject({
      output: { status: "sent" },
    });
    const body = sent.map((m) => ("body" in m ? m.body : ""))[0] ?? "";
    expect(body).toContain(
      `Your request (attendance question, ref ${refOf(t.attendance)}) is answered. The office says: We've checked the gate log.`,
    );
    expect(body).toMatch(/— Booking Test \S+ Shift Team$/);

    // History: "[Answered] by Sam Rota", with the mark now; in her app, "Answered" too.
    const r = find((await t.queue()).answered, t.attendance);
    if (!r) throw new Error("not in the history");
    expect(answeredBy(r)).toBe("Answered by Sam Rota");
    expect(markedNowText(r)).toBe("Marked now: Didn't attend.");
    // Marked again on who-worked: the history shows the mark as it is now.
    await su.query("update assignments set status = 'completed' where id = $1", [t.annBooking]);
    const again = find((await t.queue()).answered, t.attendance);
    expect(again && markedNowText(again)).toBe("Marked now: Worked.");
    const mine = await myRequests(t.portal, t.ann);
    expect(mine.find((m) => m.id === t.attendance)).toMatchObject({
      status: "approved",
      mark: "completed",
    });
  });
});

describe("a request she took back", () => {
  it("leaves the waiting list and shows in the history as 'Taken back', with nothing to tell", async () => {
    const t = await queueFirm();
    expect(find((await t.queue()).waiting, t.swap)).toBeDefined();
    expect(await withdrawRequest(t.portal, t.ben, t.swap)).toEqual({
      status: "withdrawn",
      ref: refOf(t.swap),
    });
    const q = await t.queue();
    expect(find(q.waiting, t.swap)).toBeUndefined();
    const r = find(q.answered, t.swap);
    if (!r) throw new Error("not in the history");
    expect(r.status).toBe("withdrawn");
    expect(outcomeWord(r)).toBe("Taken back");
    expect(answeredBy(r)).toBe("Taken back by Ben");
    expect(toldText(r)).toBeNull();
    const html = renderToStaticMarkup(createElement(RequestQueueView, { queue: q }));
    const row = html.split("<li").find((li) => li.includes(refOf(t.swap))) ?? "";
    expect(words(row)).toContain("Taken back by Ben at ");
    expect(words(row)).not.toMatch(/told|Telling/);
  });

  it("answering it changes nothing: 'They took this request back.', no answer logged, no notice", async () => {
    const t = await queueFirm();
    await withdrawRequest(t.portal, t.ben, t.swap);
    for (const decision of ["approved", "declined"] as const) {
      const result = await resolveRequest(
        withFirm,
        t.f.firmId,
        { requestId: t.swap, decision, note: "Too late.", by: { type: "office", id: t.resourcer } },
        { clock: { now: () => NOW } },
      );
      expect(result).toEqual({ status: "already", current: "withdrawn" });
      expect(answerResultText(result, "Ben", "swap")).toBe("They took this request back.");
    }
    expect(await t.rowOf(t.swap)).toMatchObject({
      status: "withdrawn",
      resolved_by: null,
      resolution_note: null,
    });
    expect(await t.eventsOf("request.approved")).toEqual([]);
    expect(await t.eventsOf("request.declined")).toEqual([]);
    expect(await t.jobs()).toEqual([]);
  });

  it("firm B's queue never shows firm A's requests, waiting or taken back", async () => {
    const t = await queueFirm();
    const b = await queueFirm();
    await withdrawRequest(t.portal, t.ben, t.swap);
    const q = await b.queue();
    const ids = [...q.waiting, ...q.answered].map((r) => r.requestId);
    expect(ids).not.toContain(t.swap);
    expect(ids).not.toContain(t.attendance);
    expect(ids).toContain(b.attendance);
  });
});
