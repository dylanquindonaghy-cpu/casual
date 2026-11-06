import type { Pool } from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FirmDirectoryEntry } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { unseenAnswers } from "@/lib/portal/request-answers";
import { markNowText, withdrawOutcomeText } from "@/lib/portal/request-kinds";
import { canWithdrawRequest, myRequests } from "@/lib/portal/requests";
import { resolveRequest } from "@/lib/requests/resolve";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Phase 28.9 on My requests (docs/screens.md "### 28.9"), through the page's own server actions and
// the page itself, on the real database as the app role: "Take back this request" (28.2's
// withdrawRequest: first answer wins), and the answers she hasn't seen, marked seen by the action
// the list calls once it's on her screen, never by making the page (so a prefetch can't clear the
// count). The session and the firm come from stand-ins for the request's cookie and host.

const signedIn: {
  firm: FirmDirectoryEntry | null;
  worker: { id: string; firstName: string; lastName: string } | null;
} = { firm: null, worker: null };

const session = () =>
  signedIn.firm && signedIn.worker
    ? {
        firm: signedIn.firm,
        worker: signedIn.worker,
        session: {
          id: "00000000-0000-4000-8000-000000000000",
          kind: "worker" as const,
          subjectId: signedIn.worker.id,
          expiresAt: new Date(Date.now() + 86_400_000),
          rotatedAt: new Date(),
          steppedUpUntil: null,
          rotationDue: false,
        },
      }
    : null;

vi.mock("@/lib/auth/current-worker", () => ({
  getWorkerSession: async () => session(),
  requireWorker: async () => {
    const s = session();
    if (!s) throw new Error("logged out");
    return s;
  },
}));
vi.mock("@/lib/tenancy/current-firm", () => ({
  getCurrentFirm: async () => {
    if (!signedIn.firm) throw new Error("no firm");
    return signedIn.firm;
  },
}));
const refreshed: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace(to: string) {
      refreshed.push(`replace ${to}`);
    },
    refresh() {
      refreshed.push("refresh");
    },
  }),
  redirect: () => {
    throw new Error("redirect");
  },
}));
// The tab bar reads its own counts (28.7's), never marks anything: a stand-in, so the page renders
// to HTML here (it's an async server component).
const tabBars: string[] = [];
vi.mock("@/app/casual-tab-bar", () => ({
  CasualTabBar: ({ current }: { current: string }) => {
    tabBars.push(current);
    return null;
  },
}));

const { markAnswersSeenAction, withdrawRequestAction } = await import("@/app/requests/actions");
const { default: RequestsPage } = await import("@/app/requests/page");
const { RequestsList } = await import("@/app/requests/requests-list");

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

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);
const refOf = (id: string) => id.slice(0, 8).toUpperCase();

async function setup() {
  const f = await bookingFirm(su, withFirm);
  const sam = await f.worker();
  const jo = await f.worker({ first: "Jo" });
  const resourcer = await f.office("resourcer");
  const { rows } = await su.query<{ slug: string; name: string }>(
    "select slug, name from firms where id = $1",
    [f.firmId],
  );
  const firm: FirmDirectoryEntry = {
    id: f.firmId,
    slug: rows[0]?.slug ?? "",
    name: rows[0]?.name ?? "",
    timezone: "Europe/London",
    signOff: `${rows[0]?.name ?? ""} Shift Team`,
  };
  const signIn = (workerId: string, as: FirmDirectoryEntry = firm) => {
    signedIn.firm = as;
    signedIn.worker = { id: workerId, firstName: "Sam", lastName: "Booker" };
  };
  const request = async (
    workerId: string,
    o: {
      type?: string;
      status?: string;
      shiftId?: string | null;
      resolvedAt?: Date | null;
      messageId?: string | null;
      payload?: Record<string, unknown>;
    } = {},
  ) => {
    const status = o.status ?? "open";
    const answered = status === "approved" || status === "declined";
    const { rows: made } = await su.query<{ id: string }>(
      `insert into requests (firm_id, worker_id, shift_id, type, status, payload, created_at,
                             resolved_at, resolved_by, message_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id::text as id`,
      [
        f.firmId,
        workerId,
        o.shiftId ?? null,
        o.type ?? "general",
        status,
        JSON.stringify(o.payload ?? {}),
        ago(48),
        o.resolvedAt ?? (status === "open" || status === "escalated" ? null : ago(1)),
        answered ? resourcer : null,
        o.messageId ?? null,
      ],
    );
    return made[0]?.id ?? "";
  };
  const statusOf = async (id: string) =>
    (await su.query<{ status: string }>("select status from requests where id = $1", [id])).rows[0]
      ?.status;
  const withdrawnEvents = async () =>
    (
      await su.query<{ entity_id: string }>(
        "select entity_id::text from events where firm_id = $1 and action = 'request.withdrawn'",
        [f.firmId],
      )
    ).rows.map((r) => r.entity_id);
  // The marker as it was before any answer here (answers older than her row never count).
  const answersUnreadSince = (workerId: string, at: Date | null) =>
    su.query("update workers set requests_read_at = $2 where id = $1", [workerId, at]);
  return {
    f,
    firm,
    sam,
    jo,
    resourcer,
    signIn,
    request,
    statusOf,
    withdrawnEvents,
    answersUnreadSince,
  };
}

const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("Take back this request (withdrawRequestAction)", () => {
  it("an open or an escalated request: 'Taken back' with its reference, logged once", async () => {
    const t = await setup();
    const shift = await t.f.shift();
    await t.f.booking(t.sam, shift);
    const open = await t.request(t.sam, { type: "time_change", shiftId: shift });
    const escalated = await t.request(t.sam, { type: "swap", status: "escalated", shiftId: shift });
    t.signIn(t.sam);

    const first = await withdrawRequestAction(open);
    expect(first).toEqual({ status: "withdrawn", ref: refOf(open) });
    if (first.status === "logged_out") throw new Error("logged out");
    expect(withdrawOutcomeText(first)).toEqual({
      tone: "done",
      title: `Taken back. Reference ${refOf(open)}.`,
      line: "The office won't answer it.",
    });
    expect(await withdrawRequestAction(escalated)).toEqual({
      status: "withdrawn",
      ref: refOf(escalated),
    });
    expect(await t.statusOf(open)).toBe("withdrawn");
    expect(await t.statusOf(escalated)).toBe("withdrawn");
    expect((await t.withdrawnEvents()).sort()).toEqual([open, escalated].sort());

    // A second tap changes nothing more.
    const again = await withdrawRequestAction(open);
    expect(again).toEqual({ status: "already", ref: refOf(open) });
    if (again.status === "logged_out") throw new Error("logged out");
    expect(withdrawOutcomeText(again).title).toBe(
      `You've already taken this back. Reference ${refOf(open)}.`,
    );
    expect(await t.withdrawnEvents()).toHaveLength(2);

    // My requests now reads "Taken back", with no "Take back this request" on either.
    const mine = await myRequests({ firm: t.firm, run: withFirm }, t.sam);
    const html = renderToStaticMarkup(
      createElement(RequestsList, {
        timeZone: "Europe/London",
        requests: mine.map((r) => ({ ...r, canTakeBack: canWithdrawRequest(r) })),
      }),
    );
    expect(words(html).match(/Taken back/g)).toHaveLength(2);
    expect(html).not.toContain("Take back this request");
  });

  it("one the office answered first: 'The office answered first.', and nothing changes", async () => {
    const t = await setup();
    const id = await t.request(t.sam);
    expect(
      await resolveRequest(withFirm, t.f.firmId, {
        requestId: id,
        decision: "approved",
        note: "Fine by us.",
        by: { type: "office", id: t.resourcer },
      }),
    ).toEqual({ status: "resolved", decision: "approved" });
    t.signIn(t.sam);
    const result = await withdrawRequestAction(id);
    expect(result).toEqual({ status: "answered_first", ref: refOf(id) });
    if (result.status === "logged_out") throw new Error("logged out");
    expect(withdrawOutcomeText(result)).toEqual({
      tone: "quiet",
      title: "The office answered first.",
      line: `Reference ${refOf(id)}.`,
    });
    expect(await t.statusOf(id)).toBe("approved");
    expect(await t.withdrawnEvents()).toEqual([]);
  });

  it("another casual's request, or firm B's: not found, and nothing changes", async () => {
    const t = await setup();
    const b = await setup();
    const jos = await t.request(t.jo);
    const firmBs = await b.request(b.sam);
    t.signIn(t.sam);
    for (const id of [jos, firmBs]) {
      const result = await withdrawRequestAction(id);
      expect(result).toEqual({ status: "not_yours" });
      if (result.status === "logged_out") throw new Error("logged out");
      expect(withdrawOutcomeText(result).title).toBe("We can't find that request.");
    }
    // Firm B's casual, signed in on firm A's address, can't reach firm A's request either.
    t.signIn(b.sam, t.firm);
    expect(await withdrawRequestAction(jos)).toEqual({ status: "not_yours" });
    // Not an id, or logged out.
    t.signIn(t.sam);
    expect(await withdrawRequestAction("nope")).toEqual({ status: "not_yours" });
    signedIn.worker = null;
    expect(await withdrawRequestAction(jos)).toEqual({ status: "logged_out" });
    expect(await t.statusOf(jos)).toBe("open");
    expect(await b.statusOf(firmBs)).toBe("open");
    expect(await t.withdrawnEvents()).toEqual([]);
    expect(await b.withdrawnEvents()).toEqual([]);
  });

  it("'Take back this request' shows only on one still waiting, never on a question sent as a message", async () => {
    const t = await setup();
    const { rows } = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, worker_id)
       values ($1, 'in', 'sms', $2, '+447700900111', '+447700900999', 'Is parking free?', $3)
       returning id::text as id`,
      [t.f.firmId, `SM${Math.random().toString(16).slice(2).padEnd(32, "0")}`, t.sam],
    );
    const message = rows[0]?.id ?? "";
    const open = await t.request(t.sam);
    const asked = await t.request(t.sam, { type: "general", messageId: message });
    await t.request(t.sam, { status: "approved" });
    await t.request(t.sam, { status: "withdrawn", resolvedAt: ago(2) });
    const mine = await myRequests({ firm: t.firm, run: withFirm }, t.sam);
    const html = renderToStaticMarkup(
      createElement(RequestsList, {
        timeZone: "Europe/London",
        requests: mine.map((r) => ({ ...r, canTakeBack: canWithdrawRequest(r) })),
      }),
    );
    expect(html.match(/Take back this request/g)).toHaveLength(1);
    const row = (id: string) => html.split("<li").find((li) => li.includes(refOf(id))) ?? "";
    expect(row(open)).toContain("Take back this request");
    expect(row(asked)).not.toContain("Take back this request");
    // Taking it back anyway: the office has it.
    t.signIn(t.sam);
    const result = await withdrawRequestAction(asked);
    expect(result).toEqual({ status: "office_has_it", ref: refOf(asked) });
    if (result.status === "logged_out") throw new Error("logged out");
    expect(withdrawOutcomeText(result).title).toBe(
      "The office has this one. They'll answer you in Messages.",
    );
    expect(await t.statusOf(asked)).toBe("open");
  });

  it("an answered attendance question reads 'Answered' with the mark as it is now", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: ago(30) });
    const booking = await t.f.booking(t.sam, shift, "no_show");
    await t.request(t.sam, {
      type: "attendance",
      shiftId: shift,
      status: "approved",
      payload: { said: "worked", note: "" },
    });
    // The office marked it again on who-worked: her booking now shows worked.
    await su.query("update assignments set status = 'completed' where id = $1", [booking]);
    const mine = await myRequests({ firm: t.firm, run: withFirm }, t.sam);
    const html = renderToStaticMarkup(
      createElement(RequestsList, { timeZone: "Europe/London", requests: mine }),
    );
    expect(words(html)).toContain("Answered Your shift now shows: Worked");
    expect(words(html)).toContain("Attendance question:");
    expect(words(html)).not.toMatch(/Approved|Declined/);
    expect(markNowText("no_show")).toBe("Your shift now shows: Not attended");
    expect(markNowText(null)).toBeNull();
  });
});

describe("answers she hasn't seen: cleared by the action, never by making the page", () => {
  it("making /requests (as a prefetch does, and as its first HTML) leaves the count; the seen action clears it", async () => {
    const t = await setup();
    await t.answersUnreadSince(t.sam, ago(100));
    const approved = await t.request(t.sam, { status: "approved", resolvedAt: ago(3) });
    await t.request(t.sam, { status: "declined", resolvedAt: ago(2) });
    const count = () => unseenAnswers({ firm: { id: t.f.firmId }, run: withFirm }, t.sam);
    expect(await count()).toBe(2);
    t.signIn(t.sam);

    // The page made on the server only (a prefetch), twice, then to HTML (a full load before the
    // browser takes over): its words are there, the count isn't touched.
    const made = await RequestsPage();
    await RequestsPage();
    const html = renderToStaticMarkup(made);
    expect(words(html)).toContain(`Reference ${refOf(approved)}`);
    expect(tabBars.at(-1)).toBe("profile");
    expect(await count()).toBe(2);

    // The list on her screen: the action marks the answers given by the time the page was made.
    const shownAt = new Date().toISOString();
    expect(await markAnswersSeenAction(shownAt)).toEqual({ status: "seen", moved: true });
    expect(await count()).toBe(0);
    // Again: nothing more to mark.
    expect(await markAnswersSeenAction(shownAt)).toEqual({ status: "seen", moved: false });
  });

  it("an answer given after the page was made still counts; her own answers only; logged out does nothing", async () => {
    const t = await setup();
    await t.answersUnreadSince(t.sam, ago(100));
    await t.answersUnreadSince(t.jo, ago(100));
    await t.request(t.sam, { status: "approved", resolvedAt: ago(3) });
    const shownAt = ago(2).toISOString();
    await t.request(t.sam, { status: "approved", resolvedAt: ago(1) });
    await t.request(t.jo, { status: "approved", resolvedAt: ago(3) });
    const count = (workerId: string) =>
      unseenAnswers({ firm: { id: t.f.firmId }, run: withFirm }, workerId);

    signedIn.worker = null;
    signedIn.firm = t.firm;
    expect(await markAnswersSeenAction(shownAt)).toEqual({ status: "logged_out" });
    expect(await count(t.sam)).toBe(2);

    t.signIn(t.sam);
    expect(await markAnswersSeenAction("not a time")).toEqual({ status: "error" });
    expect(await markAnswersSeenAction(shownAt)).toEqual({ status: "seen", moved: true });
    expect(await count(t.sam)).toBe(1); // the one given after the page was made
    expect(await count(t.jo)).toBe(1); // Jo's own answer: untouched
  });
});
