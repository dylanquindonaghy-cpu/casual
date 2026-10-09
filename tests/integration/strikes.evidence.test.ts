import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { EmailMayHaveArrivedError, EmailNotSentError } from "@/lib/messaging/smtp";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import { resendEvidenceAsOffice } from "@/lib/office/cancellations";
import {
  confirmStrikesEmail,
  runStrikesEmailLink,
  saveStrikesEmail,
  STRIKES_EMAIL_LINK_QUEUE,
} from "@/lib/office/strikes-email";
import { loadToday } from "@/lib/office/today";
import { cancelMyShift } from "@/lib/portal/cancel-shift";
import { takeShift } from "@/lib/portal/take-shift";
import { EVIDENCE_RETRY_AFTER_MS, runStrikeEvidence } from "@/lib/strikes/evidence";
import { STRIKE_EVIDENCE_QUEUE, type StrikeEvidencePayload } from "@/lib/strikes/evidence-queue";
import { STRIKE_WARNING_VERSION } from "@/lib/strikes/words";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { pdfText } from "../helpers/pdf-text";

// The evidence email to the strikes team (12C.4; docs/office-v2.md 5.6) on the real database, as
// the app role, through the real paths: a casual takes a shift and cancels it 19 hours before the
// start (a strike), the job runs with a transport that keeps what it's given (or fails as asked).
// Nothing is sent anywhere. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

const SECRET = "a-test-secret-for-signing-links-0123456789";
const TEAM = "strikes.team@example.com";
const at = (d: Date) => ({ now: () => d });
const later = (h: number) => new Date(NOW.getTime() + h * HOUR);
const HEALTH = /unwell|health/i;

// A transport that keeps each message, or throws `fail(n)` on the nth send (from 1) when given.
function transport(fail?: (n: number) => Error | null) {
  const { transport: keep, sent } = captureTransport();
  let n = 0;
  const t: MessagingTransport = {
    name: "test",
    async send(message: OutboundMessage) {
      n += 1;
      const error = fail?.(n) ?? null;
      if (error) throw error;
      return keep.send(message);
    },
  };
  return { transport: t, sent };
}

async function evidenceFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const portal = (now = NOW) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
    run: withFirm,
    clock: at(now),
  });
  // A casual takes a session (20 hours away) and cancels it an hour from now: a strike.
  const strike = async (
    reason = "Travel problem",
    o: { first?: string; worker?: string; startsIn?: number; cancelAt?: number } = {},
  ) => {
    const worker = o.worker ?? (await f.worker(o.first ? { first: o.first } : {}));
    const shiftId = await f.shift({ startsAt: hoursFromNow(o.startsIn ?? 20) });
    expect(await takeShift(portal(), worker, shiftId)).toMatchObject({ status: "booked" });
    const done = await cancelMyShift(portal(later(o.cancelAt ?? 1)), worker, shiftId, reason, {
      kind: "strike",
      version: STRIKE_WARNING_VERSION,
    });
    expect(done).toMatchObject({ status: "cancelled" });
    const { rows } = await su.query<{ id: string; assignment_id: string }>(
      "select id::text, assignment_id::text from strikes where shift_id = $1",
      [shiftId],
    );
    const row = rows[0];
    if (!row) throw new Error("no strike");
    return { strikeId: row.id, assignmentId: row.assignment_id, worker, shiftId };
  };
  const jobs = async (strikeId: string) =>
    (
      await su.query<{ data: StrikeEvidencePayload; start_after: Date }>(
        `select data, start_after from pgboss.job
          where name = $1 and data ->> 'strikeId' = $2 order by created_on, data ->> 'attempt'`,
        [STRIKE_EVIDENCE_QUEUE, strikeId],
      )
    ).rows;
  const run = (payload: StrikeEvidencePayload, t: MessagingTransport, now = later(2)) =>
    runStrikeEvidence(payload, withFirm, {
      transport: t,
      baseDomain: "localhost:3000",
      clock: at(now),
    });
  const evidence = async (strikeId: string) =>
    (
      await su.query<{ status: string | null; to: string | null; sent_at: Date | null }>(
        `select evidence_email_status as status, evidence_email_to as to,
                evidence_email_sent_at as sent_at from strikes where id = $1`,
        [strikeId],
      )
    ).rows[0];
  const logged = async (strikeId: string) =>
    (
      await su.query<{ action: string; actor_type: string; data: Record<string, unknown> }>(
        `select action, actor_type, data from events
          where entity_id = $1 and action like 'strike.evidence%' order by id`,
        [strikeId],
      )
    ).rows;
  // The strikes team's address saved on Settings, then confirmed through its emailed link.
  let saved = false;
  const saveTeam = async () => {
    const office = { firm: { id: f.firmId }, officeUserId: admin, run: withFirm, clock: at(NOW) };
    expect(await saveStrikesEmail(office, { address: TEAM })).toMatchObject({ status: "saved" });
    saved = true;
  };
  const confirmTeam = async () => {
    if (!saved) await saveTeam();
    const { rows } = await su.query<{ data: { firmId: string; idempotencyKey: string } }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [STRIKES_EMAIL_LINK_QUEUE, f.firmId],
    );
    const link = transport();
    for (const r of rows) {
      await runStrikesEmailLink(r.data, withFirm, {
        transport: link.transport,
        baseDomain: "localhost:3000",
        clock: at(NOW),
        secret: SECRET,
      });
    }
    const body = link.sent.map((m) => ("body" in m ? m.body : "")).join("\n");
    const token = /confirm-email#(\S+)/.exec(body)?.[1];
    if (!token) throw new Error("no link");
    expect(
      await confirmStrikesEmail(
        {
          firm: { id: f.firmId },
          ip: "203.0.113.9",
          run: withFirm,
          clock: at(later(1.5)),
          secret: SECRET,
        },
        token,
      ),
    ).toEqual({ status: "confirmed" });
  };
  const office = (officeUserId: string) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: at(later(3)),
  });
  const today = () => withFirm(f.firmId, (tx) => loadToday(tx, later(3)));
  const slug = async () =>
    (await su.query<{ slug: string }>("select slug from firms where id = $1", [f.firmId])).rows[0]
      ?.slug;
  return {
    f,
    admin,
    resourcer,
    strike,
    jobs,
    run,
    evidence,
    logged,
    saveTeam,
    confirmTeam,
    office,
    today,
    slug,
  };
}

const emailOf = (m: OutboundMessage | undefined) => {
  if (!m || m.channel !== "email") throw new Error("not an email");
  return m;
};

describe("only to a confirmed address", () => {
  it("nothing goes before the address is confirmed; it goes once it is, once", async () => {
    const t = await evidenceFirm();
    const s = await t.strike();
    // Queued with the strike, ids and numbers only.
    const [first] = await t.jobs(s.strikeId);
    expect(Object.keys(first?.data ?? {}).sort()).toEqual(
      ["attempt", "firmId", "idempotencyKey", "series", "strikeId"].sort(),
    );
    expect(first?.data.attempt).toBe(1);
    expect((await t.evidence(s.strikeId))?.status).toBe("pending");

    const out = transport();
    expect(await t.run(first!.data, out.transport)).toEqual({ status: "not_set_up" });
    expect(out.sent).toEqual([]);
    expect(await t.evidence(s.strikeId)).toEqual({ status: "not_set_up", to: null, sent_at: null });
    expect(await t.logged(s.strikeId)).toEqual([
      {
        action: "strike.evidence_failed",
        actor_type: "system",
        data: { request: first!.data.idempotencyKey, attempt: 1, code: "not_set_up", retry: false },
      },
    ]);
    // The Needs attention item: the address isn't confirmed, and one record waits.
    expect((await t.today()).evidence).toMatchObject({ addressConfirmed: false, waiting: 1 });

    // Saved but not confirmed yet: the same job again sends nothing.
    await t.saveTeam();
    expect(await t.run(first!.data, out.transport)).toEqual({ status: "already" });
    expect(out.sent).toEqual([]);

    // Confirmed: the waiting strike is queued again, and goes.
    await t.confirmTeam();
    const queued = await t.jobs(s.strikeId);
    expect(queued).toHaveLength(2);
    const second = queued[1]!.data;
    expect(second.series).not.toBe(first!.data.series);
    expect(await t.run(second, out.transport, later(2))).toEqual({ status: "sent" });
    expect(await t.run(second, out.transport, later(2))).toEqual({ status: "already" });
    expect(out.sent).toHaveLength(1);
    expect(emailOf(out.sent[0]).to).toBe(TEAM);
    expect(await t.evidence(s.strikeId)).toEqual({ status: "sent", to: TEAM, sent_at: later(2) });
    const entries = await t.logged(s.strikeId);
    // The confirmation queued it again as its own series (strike.evidence_queued).
    expect(entries.map((e) => e.action)).toEqual([
      "strike.evidence_failed",
      "strike.evidence_queued",
      "strike.evidence_sending",
      "strike.evidence_sent",
    ]);
    const { rows: queuedEntry } = await su.query<{ id: string }>(
      "select id::text from events where entity_id = $1 and action = 'strike.evidence_queued'",
      [s.strikeId],
    );
    expect(String(second.series)).toBe(queuedEntry[0]?.id);
    // Never the address in the log.
    expect(JSON.stringify(entries)).not.toContain("@");
    expect((await t.today()).evidence).toMatchObject({
      addressConfirmed: true,
      waiting: 0,
      failed: [],
    });
  });
});

describe("what is sent", () => {
  it("§5.6's subject and body, the record PDF; no health words for any quick reason", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const reasons = [
      "I'm unwell",
      "Travel problem",
      "Family or caring",
      "Something else: my health",
    ];
    const names = ["Ann", "Ben", "Cal", "Dee"];
    const out = transport();
    for (const [i, reason] of reasons.entries()) {
      const s = await t.strike(reason, { first: names[i] });
      if (i === 0)
        await su.query("update workers set external_ref = 'N001' where id = $1", [s.worker]);
      const [job] = await t.jobs(s.strikeId);
      expect(await t.run(job!.data, out.transport)).toEqual({ status: "sent" });
      const email = emailOf(out.sent.at(-1));
      const ref = s.assignmentId.slice(0, 8).toUpperCase();
      expect(email.subject).toBe(
        `Strike: ${names[i]} Booker cancelled Door supervisor with 19 hours' notice (ref ${ref})`,
      );
      if (i === 0) {
        expect(email.body).toBe(
          [
            "Ann Booker (staff id N001) cancelled Door supervisor · Fixture event · Tue 3 Nov 05:00–13:00 at 10:00 on Mon 2 Nov, 19 hours before the start. That is under your 48-hour rule, so a strike was recorded automatically. It is their strike 1 in the last 90 days.",
            "",
            "The record is attached (PDF) and is also here:",
            "",
            `http://${await t.slug()}.localhost:3000/office/cancellations/${s.assignmentId}`,
            "",
            `— Booking Test ${await t.slug()} Shift Team`,
          ].join("\n"),
        );
      }
      const [file] = email.attachments ?? [];
      expect(file).toMatchObject({
        filename: `cancellation-${ref}.pdf`,
        contentType: "application/pdf",
      });
      const pdf = await pdfText(file!.content as Uint8Array);
      expect(pdf).toContain(`Cancellation record ${ref}`);
      expect(pdf).toContain("Casual's own reason (see ShiftDesk)");
      expect(pdf).toContain("Sent to the strikes team at 11:00 on Mon 2 Nov");
      for (const text of [email.subject, email.body, pdf]) expect(text).not.toMatch(HEALTH);
    }
  });

  it("counts which of their strikes it is", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const worker = await t.f.worker();
    const out = transport();
    const first = await t.strike("Travel problem", { worker });
    await t.run((await t.jobs(first.strikeId))[0]!.data, out.transport);
    // A second session 40 hours away (past the 11-hour rest), cancelled an hour after the first.
    const second = await t.strike("Travel problem", { worker, startsIn: 40, cancelAt: 2 });
    await t.run((await t.jobs(second.strikeId))[0]!.data, out.transport);
    expect(emailOf(out.sent[0]).body).toContain("It is their strike 1 in the last 90 days.");
    expect(emailOf(out.sent[1]).body).toContain("It is their strike 2 in the last 90 days.");
  });
});

describe("failures", () => {
  it("nothing reached the server: tried again, at most 4 attempts in all, then failed", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const s = await t.strike();
    const down = transport(() => new EmailNotSentError("connect"));
    let now = later(2);
    for (const attempt of [1, 2, 3]) {
      const job = (await t.jobs(s.strikeId))[attempt - 1]!;
      expect(await t.run(job.data, down.transport, now)).toEqual({
        status: "retrying",
        attempt: attempt + 1,
      });
      const next = (await t.jobs(s.strikeId))[attempt]!;
      expect(next.data).toMatchObject({ attempt: attempt + 1, series: job.data.series });
      expect(next.start_after.getTime()).toBe(
        now.getTime() + EVIDENCE_RETRY_AFTER_MS[attempt - 1]!,
      );
      expect((await t.evidence(s.strikeId))?.status).toBe("pending");
      now = next.start_after;
    }
    const last = (await t.jobs(s.strikeId))[3]!;
    expect(await t.run(last.data, down.transport, now)).toEqual({ status: "failed" });
    expect(await t.jobs(s.strikeId)).toHaveLength(4);
    expect((await t.evidence(s.strikeId))?.status).toBe("failed");
    expect(
      (await t.logged(s.strikeId)).filter((e) => e.action === "strike.evidence_failed"),
    ).toEqual(
      [1, 2, 3, 4].map((attempt) => ({
        action: "strike.evidence_failed",
        actor_type: "system",
        data: expect.objectContaining({ attempt, code: "EmailNotSentError", retry: attempt < 4 }),
      })),
    );
    expect(down.sent).toEqual([]);
  });

  it("nothing reached the server once, then it went: sent once", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const s = await t.strike();
    const flaky = transport((n) =>
      n === 1 ? new EmailNotSentError("envelope", "EENVELOPE", 451) : null,
    );
    expect(await t.run((await t.jobs(s.strikeId))[0]!.data, flaky.transport)).toMatchObject({
      status: "retrying",
    });
    expect(await t.run((await t.jobs(s.strikeId))[1]!.data, flaky.transport)).toEqual({
      status: "sent",
    });
    expect(flaky.sent).toHaveLength(1);
    expect((await t.evidence(s.strikeId))?.status).toBe("sent");
  });

  it("an unclear failure is never sent again on its own; Needs attention shows it", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const cases = [
      { first: "Ann", error: new EmailMayHaveArrivedError("EMESSAGE", 554) },
      { first: "Ben", error: new Error("socket hang up") },
    ];
    for (const { first, error } of cases) {
      const s = await t.strike("Travel problem", { first });
      const out = transport(() => error);
      const [job] = await t.jobs(s.strikeId);
      expect(await t.run(job!.data, out.transport)).toEqual({ status: "failed" });
      // No next attempt, and the same job run again sends nothing.
      expect(await t.jobs(s.strikeId)).toHaveLength(1);
      expect(await t.run(job!.data, transport().transport)).toEqual({ status: "already" });
      expect((await t.evidence(s.strikeId))?.status).toBe("failed");
      expect((await t.logged(s.strikeId)).at(-1)?.data).toMatchObject({
        code: error.name,
        retry: false,
      });
    }
    const item = (await t.today()).evidence;
    expect(item.failed.map((f) => f.casual).sort()).toEqual(["Ann Booker", "Ben Booker"]);
  });

  it("a job stopped after its claim is never sent again: its rerun records the failure", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const s = await t.strike();
    const [job] = await t.jobs(s.strikeId);
    // The claim, as the first run left it before stopping.
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'system', 'strike.evidence_sending', 'strike', $2, $3)`,
      [t.f.firmId, s.strikeId, JSON.stringify({ request: job!.data.idempotencyKey, attempt: 1 })],
    );
    const out = transport();
    expect(await t.run(job!.data, out.transport)).toEqual({ status: "failed" });
    expect(out.sent).toEqual([]);
    expect((await t.evidence(s.strikeId))?.status).toBe("failed");
    expect((await t.logged(s.strikeId)).at(-1)?.data).toMatchObject({
      code: "stopped",
      retry: false,
    });
  });
});

describe("Resend evidence", () => {
  it("sends once more, logged by the office user; only after a failure; admins and resourcers", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const s = await t.strike();
    const failing = transport(() => new EmailMayHaveArrivedError());
    await t.run((await t.jobs(s.strikeId))[0]!.data, failing.transport);
    expect((await t.today()).evidence.failed.map((f) => f.assignmentId)).toEqual([s.assignmentId]);

    // Payroll can't; another firm's booking isn't there.
    const payroll = await t.f.office("payroll");
    expect(await resendEvidenceAsOffice(t.office(payroll), s.assignmentId)).toEqual({
      status: "not_allowed",
    });
    const other = await evidenceFirm();
    expect(await resendEvidenceAsOffice(other.office(other.resourcer), s.assignmentId)).toEqual({
      status: "not_found",
    });

    expect(await resendEvidenceAsOffice(t.office(t.resourcer), s.assignmentId)).toEqual({
      status: "queued",
    });
    // A second tap while it's on its way queues nothing.
    expect(await resendEvidenceAsOffice(t.office(t.admin), s.assignmentId)).toEqual({
      status: "not_failed",
    });
    const queued = await t.jobs(s.strikeId);
    expect(queued).toHaveLength(2);
    const out = transport();
    expect(await t.run(queued[1]!.data, out.transport, later(4))).toEqual({ status: "sent" });
    expect(out.sent).toHaveLength(1);
    expect(await t.evidence(s.strikeId)).toEqual({ status: "sent", to: TEAM, sent_at: later(4) });
    const resend = (await t.logged(s.strikeId)).filter(
      (e) => e.action === "strike.evidence_resend",
    );
    expect(resend).toEqual([{ action: "strike.evidence_resend", actor_type: "office", data: {} }]);
    const { rows } = await su.query<{ actor_id: string }>(
      "select actor_id::text from events where entity_id = $1 and action = 'strike.evidence_resend'",
      [s.strikeId],
    );
    expect(rows).toEqual([{ actor_id: t.resourcer }]);
    // Sent now: nothing to resend, and the Needs attention item has gone.
    expect(await resendEvidenceAsOffice(t.office(t.admin), s.assignmentId)).toEqual({
      status: "not_failed",
    });
    expect((await t.today()).evidence.failed).toEqual([]);
  });
});

describe("isolation", () => {
  it("a job can only reach its own firm's strike", async () => {
    const t = await evidenceFirm();
    const other = await evidenceFirm();
    const s = await t.strike();
    const [job] = await t.jobs(s.strikeId);
    // The same payload under another firm: RLS hides the strike.
    const out = transport();
    expect(
      await runStrikeEvidence({ ...job!.data, firmId: other.f.firmId }, withFirm, {
        transport: out.transport,
        baseDomain: "localhost:3000",
        clock: at(later(2)),
      }),
    ).toEqual({ status: "gone" });
    expect(out.sent).toEqual([]);
    expect((await t.evidence(s.strikeId))?.status).toBe("pending");
  });
});

describe("only to a confirmed address: never one saved but not confirmed", () => {
  it("saved, not confirmed yet: a new strike's evidence waits and nothing is sent", async () => {
    const t = await evidenceFirm();
    await t.saveTeam();
    const s = await t.strike();
    const out = transport();
    expect(await t.run((await t.jobs(s.strikeId))[0]!.data, out.transport)).toEqual({
      status: "not_set_up",
    });
    expect(out.sent).toEqual([]);
    expect((await t.evidence(s.strikeId))?.status).toBe("not_set_up");
  });

  it("confirmed, then changed to an address not confirmed yet: sent to neither", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    expect(
      await saveStrikesEmail(
        { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock: at(later(1.6)) },
        { address: "new.strikes.team@example.com" },
      ),
    ).toMatchObject({ status: "saved" });
    const s = await t.strike();
    const out = transport();
    expect(await t.run((await t.jobs(s.strikeId))[0]!.data, out.transport)).toEqual({
      status: "not_set_up",
    });
    expect(out.sent).toEqual([]);
  });
});

describe("one series at a time", () => {
  it("a resend takes over: the earlier series' job sends nothing", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const s = await t.strike();
    const [first] = await t.jobs(s.strikeId);
    // The first attempt is held up: nothing logged about the strike for 5 hours.
    await su.query(
      "update events set created_at = created_at - interval '5 hours' where entity_id = $1",
      [s.strikeId],
    );
    const item = (await t.today()).evidence.failed;
    expect(item).toEqual([expect.objectContaining({ assignmentId: s.assignmentId, stuck: true })]);
    expect(await resendEvidenceAsOffice(t.office(t.resourcer), s.assignmentId)).toEqual({
      status: "queued",
    });
    const out = transport();
    // The held-up job turns up after all: superseded, it sends nothing.
    expect(await t.run(first!.data, out.transport)).toEqual({ status: "already" });
    expect(out.sent).toEqual([]);
    expect(await t.run((await t.jobs(s.strikeId))[1]!.data, out.transport)).toEqual({
      status: "sent",
    });
    expect(out.sent).toHaveLength(1);
    expect((await t.today()).evidence.failed).toEqual([]);
  });

  it("an earlier series' late failure changes nothing and starts no retry", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const s = await t.strike();
    const [first] = await t.jobs(s.strikeId);
    // While the first attempt is sending: a rerun of its job marked it failed (its heartbeat was
    // lost), and the office resent it. Then the first attempt's send fails, nothing sent.
    const midway: MessagingTransport = {
      name: "midway",
      async send() {
        await su.query("update strikes set evidence_email_status = 'failed' where id = $1", [
          s.strikeId,
        ]);
        expect(await resendEvidenceAsOffice(t.office(t.admin), s.assignmentId)).toEqual({
          status: "queued",
        });
        throw new EmailNotSentError("connect");
      },
    };
    expect(await t.run(first!.data, midway)).toEqual({ status: "failed" });
    // No retry of the old series; the resend's job is the only one waiting, its status untouched.
    const jobs = await t.jobs(s.strikeId);
    expect(jobs.map((j) => [j.data.series === first!.data.series, j.data.attempt])).toEqual([
      [true, 1],
      [false, 1],
    ]);
    expect((await t.evidence(s.strikeId))?.status).toBe("pending");
    expect((await t.logged(s.strikeId)).at(-1)?.data).toMatchObject({
      code: "EmailNotSentError",
      retry: false,
    });
  });
});

describe("withdrawn strikes", () => {
  it("nothing sent, logged; no resend; not on Today", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const s = await t.strike();
    await su.query(
      `update strikes set status = 'withdrawn', withdrawn_at = $2, withdrawn_by = $3,
              withdrawn_reason = 'Made up for the test'
        where id = $1`,
      [s.strikeId, later(1.5), t.admin],
    );
    const out = transport();
    expect(await t.run((await t.jobs(s.strikeId))[0]!.data, out.transport)).toEqual({
      status: "gone",
    });
    expect(out.sent).toEqual([]);
    expect((await t.logged(s.strikeId)).at(-1)?.data).toMatchObject({ code: "withdrawn" });
    // Even once it's been quiet for hours.
    await su.query(
      "update events set created_at = created_at - interval '5 hours' where entity_id = $1",
      [s.strikeId],
    );
    expect(await resendEvidenceAsOffice(t.office(t.admin), s.assignmentId)).toEqual({
      status: "not_failed",
    });
    expect((await t.today()).evidence.failed).toEqual([]);
  });
});

describe("the emailed PDF names nobody else", () => {
  it("who filled the place again isn't named; the strike's own threshold is used", async () => {
    const t = await evidenceFirm();
    await t.confirmTeam();
    const s = await t.strike();
    // Jo takes the place at 10:30, before the evidence goes.
    const jo = await t.f.worker({ first: "Jo" });
    expect(
      await takeShift(
        {
          firm: { id: t.f.firmId, timezone: "Europe/London", signOff: "x" },
          run: withFirm,
          clock: at(later(1.5)),
        },
        jo,
        s.shiftId,
      ),
    ).toMatchObject({ status: "booked" });
    // The owner raises the firm's threshold afterwards: the strike's own (48) stays.
    await su.query(
      `update firms set settings = jsonb_set(settings, '{strikes}',
         coalesce(settings -> 'strikes', '{}'::jsonb) || '{"notice_hours": 72}'::jsonb)
        where id = $1`,
      [t.f.firmId],
    );
    const out = transport();
    expect(await t.run((await t.jobs(s.strikeId))[0]!.data, out.transport)).toEqual({
      status: "sent",
    });
    const email = emailOf(out.sent[0]);
    const pdf = await pdfText(email.attachments![0]!.content as Uint8Array);
    expect(pdf).toContain("filled again at 10:30");
    expect(pdf).not.toContain("Jo Booker");
    expect(pdf).toContain("Under 48 hours");
    expect(email.body).toContain("under your 48-hour rule");
  });
});

describe("isolation: the address and Today", () => {
  it("confirming one firm's address sends none of another's; Today lists only its own", async () => {
    const a = await evidenceFirm();
    const b = await evidenceFirm();
    const waiting = await b.strike();
    await b.run((await b.jobs(waiting.strikeId))[0]!.data, transport().transport);
    expect((await b.evidence(waiting.strikeId))?.status).toBe("not_set_up");
    await a.confirmTeam();
    // Firm B's strike is still waiting, with no new job.
    expect((await b.evidence(waiting.strikeId))?.status).toBe("not_set_up");
    expect(await b.jobs(waiting.strikeId)).toHaveLength(1);

    const failedA = await a.strike();
    await a.run(
      (await a.jobs(failedA.strikeId))[0]!.data,
      transport(() => new EmailMayHaveArrivedError()).transport,
    );
    expect((await a.today()).evidence.failed.map((f) => f.assignmentId)).toEqual([
      failedA.assignmentId,
    ]);
    expect((await b.today()).evidence.failed).toEqual([]);
  });
});
