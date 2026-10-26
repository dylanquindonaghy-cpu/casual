import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import type { PgBoss, WorkHandler } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { workers } from "@/lib/db/schema";
import { createWithFirm, type FirmTx, type WithFirm } from "@/lib/db/scoped";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import {
  ESCALATE_SHIFT_QUEUE,
  OFFER_WAVE_QUEUE,
  runEscalation,
  runOfferWave,
  type OfferDeps,
  type WaveResult,
} from "@/lib/offers/waves";
import { runOfficeOffer } from "@/lib/offers/office-offer";
import { assignWorker } from "@/lib/office/quick-actions";
import { takeShift } from "@/lib/portal/take-shift";
import type { PushTransport } from "@/lib/push/transport";
import { registerJobs } from "@/worker/jobs";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Offer waves and escalation never hold the shift's lock (or a recipient's) while messages go out
// (src/lib/offers/waves.ts: claim → send → record). The transport here is slow on purpose, like a
// real provider: a worker who taps "Take shift" mid-wave, and the office pressing "Assign", finish
// within 2 seconds, where the old one-transaction wave made them wait for every message. Also: each
// claim re-checks the shift and the worker under the shift's lock (an office offer, a booking, a
// suspended licence or a changed shift mid-wave), a crash after a claim never messages that worker
// twice, two copies of a wave share it, quiet hours hold a retry, and the worker runs the real
// tasks for both queues. Real database, app role, fixed clock (NOW is Monday
// 2 November 2026, 09:00 London), nothing sent anywhere.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(6);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BOUND_MS = 2_000;
const noPush: PushTransport = {
  name: "none",
  async send() {
    return { status: "skipped" };
  },
};

// A transport that takes `delayMs` per message (a real provider takes a few hundred) and can fail
// for chosen addresses. `firstSent` resolves once the first message has gone.
function slowTransport(delayMs: number, failFor: string[] = []) {
  const sent: OutboundMessage[] = [];
  let markFirst: () => void = () => undefined;
  const firstSent = new Promise<void>((resolve) => (markFirst = resolve));
  const transport: MessagingTransport = {
    name: "slow",
    async send(message) {
      await sleep(delayMs);
      if (failFor.includes(message.to)) throw new Error("timed out");
      sent.push(message);
      if (sent.length === 1) markFirst();
      return { providerMessageId: `slow-${sent.length}` };
    },
  };
  return { transport, sent, firstSent };
}

const depsFor = (transport: MessagingTransport, when = NOW): OfferDeps => ({
  transport,
  push: noPush,
  baseDomain: "localhost:3000",
  clock: { now: () => when },
});

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now();
  const value = await fn();
  return { ms: performance.now() - started, value };
}

// A firm with `count` door supervisors, an urgent shift (19:00 today unless said) and a resourcer.
async function waveFirm(
  count: number,
  settings: Record<string, unknown>,
  headcount = 1,
  startsInHours = 10,
) {
  const f = await bookingFirm(su, withFirm, { settings });
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(await f.worker({ first: `W${i}` }));
  const { rows } = await su.query<{ id: string; mobile: string }>(
    "select id::text as id, mobile_e164 as mobile from workers where firm_id = $1",
    [f.firmId],
  );
  const byMobile = new Map(rows.map((r) => [r.mobile, r.id]));
  const shiftId = await f.shift({ startsAt: hoursFromNow(startsInHours), headcount });
  await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
  const officeId = await f.office("resourcer");
  return { f, ids, byMobile, shiftId, officeId };
}

const payload = (f: BookingFirm, shiftId: string, wave = 1) => ({
  firmId: f.firmId,
  idempotencyKey: `offer-wave:${shiftId}:${wave}`,
  shiftId,
  wave,
});

async function offerRows(shiftId: string) {
  const { rows } = await su.query<{ worker_id: string; wave: number; response: string | null }>(
    "select worker_id::text, wave, response from offers where shift_id = $1",
    [shiftId],
  );
  return rows;
}

async function queuedWaves(shiftId: string, wave: number) {
  const { rows } = await su.query(
    `select id from pgboss.job where name = 'offer-wave'
        and data ->> 'shiftId' = $1 and (data ->> 'wave')::int = $2`,
    [shiftId, wave],
  );
  return rows.length;
}

describe("a wave going out holds nothing anyone else is waiting for", () => {
  it("300 workers, first come first served: Take shift and Assign finish within 2 s mid-wave, then it stops", async () => {
    // 20 per free place (the most a firm can choose): a wave of 40 for the 2 places, 20 once one
    // is taken (P4.3), so it's still going when the office fills the other.
    const t = await waveFirm(
      300,
      { allocation_mode: "first_come_first_served", wave_per_place: 20 },
      2,
    );
    const slow = slowTransport(200); // up to 40 messages: about 8 s of sending
    const wave = runOfferWave(payload(t.f, t.shiftId), withFirm, depsFor(slow.transport));
    await slow.firstSent;

    // The first worker messaged taps Take shift at once.
    const taker = t.byMobile.get(slow.sent[0]?.to ?? "") ?? "";
    const take = await timed(() =>
      takeShift(
        {
          firm: { id: t.f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
          run: withFirm,
          clock: { now: () => NOW },
        },
        taker,
        t.shiftId,
      ),
    );
    expect(take.value.status).toBe("booked");
    expect(take.ms).toBeLessThan(BOUND_MS);

    // The office places someone in the other place, also while the wave is still going.
    const placed = t.ids.find((id) => id !== taker) ?? "";
    const assign = await timed(() =>
      assignWorker(
        {
          firm: { id: t.f.firmId },
          officeUserId: t.officeId,
          run: withFirm,
          clock: { now: () => NOW },
        },
        t.shiftId,
        placed,
        null,
      ),
    );
    expect(assign.value.status).toBe("booked");
    expect(assign.ms).toBeLessThan(BOUND_MS);

    // Now full: the wave stops at its next claim, without messaging the rest.
    const result = (await wave) as Extract<WaveResult, { status: "stopped" }>;
    expect(result).toMatchObject({ status: "stopped", reason: "filled" });
    const sent = result.sent ?? 0;
    expect(sent).toBeGreaterThan(0);
    // Fewer than the 20 its size fell to when Take shift took one place (at 20 it would have
    // ended "sent", with the shift not yet full).
    expect(sent).toBeLessThan(20);
    expect(slow.sent).toHaveLength(sent);
    // Each worker messaged has exactly one offer, all closed now: the taker's accepted (and the
    // placed worker's, if they were offered it), everyone else's filled elsewhere.
    const offers = await offerRows(t.shiftId);
    expect(offers).toHaveLength(sent);
    expect(new Set(offers.map((o) => o.worker_id)).size).toBe(sent);
    expect(offers.find((o) => o.worker_id === taker)?.response).toBe("accepted");
    expect(offers.filter((o) => o.response === null)).toEqual([]);
    const others = offers.filter((o) => o.worker_id !== taker && o.worker_id !== placed);
    expect(others.every((o) => o.response === "filled_elsewhere")).toBe(true);
  }, 120_000);

  it("a recipient's STOP or erasure (their row, for update) isn't held up while the wave sends", async () => {
    // 3 places at 20 each would be 60: at most 50 a wave (P4.3), and the next wave for the rest.
    const t = await waveFirm(
      60,
      { allocation_mode: "first_come_first_served", wave_per_place: 20 },
      3,
    );
    const slow = slowTransport(40); // 50 messages: about 2 s of sending
    const wave = runOfferWave(payload(t.f, t.shiftId), withFirm, depsFor(slow.transport));
    await slow.firstSent;
    const mobile = slow.sent[0]?.to ?? "";
    // The lock an SMS STOP (src/lib/inbound/opt-out.ts) and an erasure (src/lib/gdpr/worker-erase.ts)
    // take on the worker's row.
    const stop = await timed(() =>
      withFirm(t.f.firmId, (tx: FirmTx) =>
        tx
          .select({ id: workers.id })
          .from(workers)
          .where(eq(workers.mobileE164, mobile))
          .for("update"),
      ),
    );
    expect(stop.value).toHaveLength(1);
    expect(stop.ms).toBeLessThan(BOUND_MS);
    expect(await wave).toEqual({ status: "sent", sent: 50, next: 2 });
  }, 60_000);
});

describe("claims: nobody hears twice, and nobody hears what's no longer true", () => {
  // Wraps withFirm: throws (as if the worker process died) just after the `n`th claim commits. A
  // wave's claim returns {kind: "claimed"}; an escalation's returns true.
  const crashAfterClaim = (n: number): WithFirm => {
    let claims = 0;
    return async (firmId, fn) => {
      const value = await withFirm(firmId, fn);
      const claimed = value === true || (value as { kind?: unknown } | null)?.kind === "claimed";
      if (claimed && ++claims === n) throw new Error("worker process died");
      return value;
    };
  };

  it("a crash just after a claim: the retry carries on with the rest and never messages that worker", async () => {
    const t = await waveFirm(4, { allocation_mode: "first_come_first_served" });
    const slow = slowTransport(0);
    const deps = depsFor(slow.transport);
    await expect(runOfferWave(payload(t.f, t.shiftId), crashAfterClaim(2), deps)).rejects.toThrow(
      "worker process died",
    );
    expect(slow.sent).toHaveLength(1);
    const claimed = await offerRows(t.shiftId);
    expect(claimed).toHaveLength(2);
    const firstTo = slow.sent[0]?.to;
    const unsure = claimed.find((o) => o.worker_id !== t.byMobile.get(firstTo ?? ""))?.worker_id;

    // pg-boss runs it again.
    expect(await runOfferWave(payload(t.f, t.shiftId), withFirm, deps)).toEqual({
      status: "sent",
      sent: 2,
      next: null,
    });
    const to = slow.sent.map((m) => t.byMobile.get(m.to));
    expect(to).toHaveLength(3);
    expect(new Set(to).size).toBe(3);
    // The worker claimed just before the crash may have been messaged: never again.
    expect(to).not.toContain(unsure);
    expect(await offerRows(t.shiftId)).toHaveLength(4);
    // Run once more: nothing left to send.
    expect(await runOfferWave(payload(t.f, t.shiftId), withFirm, deps)).toEqual({
      status: "already_sent",
    });
    expect(slow.sent).toHaveLength(3);
    // Every offer is in the log once: the 3 sent, and the one that may have gone, as unconfirmed
    // (src/lib/offers/unconfirmed.ts), so the notice report still has it.
    const { rows: logged } = await su.query<{ data: { workerId: string; unconfirmed?: boolean } }>(
      "select data from events where action = 'offer.sent' and data ->> 'shiftId' = $1",
      [t.shiftId],
    );
    expect(logged).toHaveLength(4);
    expect(logged.filter((e) => e.data.unconfirmed).map((e) => e.data.workerId)).toEqual([unsure]);
  });

  it("fair rotation: a crash mid-wave never overfills it, and the next wave is queued once", async () => {
    const t = await waveFirm(5, {
      allocation_mode: "fair_rotation",
      wave_size: 2,
      wave_minutes: 15,
    });
    const slow = slowTransport(0);
    const deps = depsFor(slow.transport);
    await expect(runOfferWave(payload(t.f, t.shiftId), crashAfterClaim(2), deps)).rejects.toThrow();
    expect(await queuedWaves(t.shiftId, 2)).toBe(0);
    // The retry finds the wave's 2 places taken: nothing sent, the chain goes on.
    expect(await runOfferWave(payload(t.f, t.shiftId), withFirm, deps)).toEqual({
      status: "already_sent",
    });
    expect(await runOfferWave(payload(t.f, t.shiftId), withFirm, deps)).toEqual({
      status: "already_sent",
    });
    expect(slow.sent).toHaveLength(1);
    expect((await offerRows(t.shiftId)).filter((o) => o.wave === 1)).toHaveLength(2);
    expect(await queuedWaves(t.shiftId, 2)).toBe(1);
  });

  it("two copies of a fair-rotation wave, one reading its list after the other's first claim: still 2 workers, each messaged once, one next wave", async () => {
    const t = await waveFirm(6, {
      allocation_mode: "fair_rotation",
      wave_size: 2,
      wave_minutes: 15,
    });
    const slow = slowTransport(20);
    const deps = depsFor(slow.transport);
    // Copy A opens a gate after its first claim commits. Copy B, after its own check (when the wave
    // still had no offers), waits at the gate before reading its list: so B's list leaves out A's
    // first worker and B goes for 2 more. Without the claim's "wave full" check, 3 would be offered.
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const runA: WithFirm = async (firmId, fn) => {
      const value = await withFirm(firmId, fn);
      if ((value as { kind?: unknown } | null)?.kind === "claimed") open();
      return value;
    };
    let callsB = 0;
    const runB: WithFirm = async (firmId, fn) => {
      callsB += 1;
      if (callsB === 2) await gate;
      return withFirm(firmId, fn);
    };
    await Promise.all([
      runOfferWave(payload(t.f, t.shiftId), runA, deps),
      runOfferWave(payload(t.f, t.shiftId), runB, deps),
    ]);
    expect(slow.sent).toHaveLength(2);
    expect(new Set(slow.sent.map((m) => m.to)).size).toBe(2);
    expect(await offerRows(t.shiftId)).toHaveLength(2);
    expect(await queuedWaves(t.shiftId, 2)).toBe(1);
  });

  it("first come, first served: a crash mid-wave never overfills it (5 for one place), and the next wave is queued once (P4.3)", async () => {
    const t = await waveFirm(8, { allocation_mode: "first_come_first_served" });
    const slow = slowTransport(0);
    const deps = depsFor(slow.transport);
    await expect(runOfferWave(payload(t.f, t.shiftId), crashAfterClaim(5), deps)).rejects.toThrow();
    expect(await queuedWaves(t.shiftId, 2)).toBe(0);
    // The retry finds the wave's 5 taken: nothing sent, the chain goes on.
    expect(await runOfferWave(payload(t.f, t.shiftId), withFirm, deps)).toEqual({
      status: "already_sent",
    });
    expect(await runOfferWave(payload(t.f, t.shiftId), withFirm, deps)).toEqual({
      status: "already_sent",
    });
    expect(slow.sent).toHaveLength(4);
    expect((await offerRows(t.shiftId)).filter((o) => o.wave === 1)).toHaveLength(5);
    expect(await queuedWaves(t.shiftId, 2)).toBe(1);
  });

  it("first come, first served: two copies of a wave, one reading its list after the other's first claim: still its size, each messaged once, one next wave (P4.3)", async () => {
    // 2 per place, one place: a wave of 2, as in the fair-rotation case above.
    const t = await waveFirm(6, { allocation_mode: "first_come_first_served", wave_per_place: 2 });
    const slow = slowTransport(20);
    const deps = depsFor(slow.transport);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const runA: WithFirm = async (firmId, fn) => {
      const value = await withFirm(firmId, fn);
      if ((value as { kind?: unknown } | null)?.kind === "claimed") open();
      return value;
    };
    let callsB = 0;
    const runB: WithFirm = async (firmId, fn) => {
      callsB += 1;
      if (callsB === 2) await gate;
      return withFirm(firmId, fn);
    };
    await Promise.all([
      runOfferWave(payload(t.f, t.shiftId), runA, deps),
      runOfferWave(payload(t.f, t.shiftId), runB, deps),
    ]);
    expect(slow.sent).toHaveLength(2);
    expect(new Set(slow.sent.map((m) => m.to)).size).toBe(2);
    expect(await offerRows(t.shiftId)).toHaveLength(2);
    expect(await queuedWaves(t.shiftId, 2)).toBe(1);
  });

  it("mid-wave: an office offer, a booking, a suspended licence and offers turned off each keep that worker out of the rest of the wave", async () => {
    // 20 per place: all 20 fit in the wave (P4.3).
    const t = await waveFirm(
      20,
      { allocation_mode: "first_come_first_served", wave_per_place: 20 },
      3,
    );
    // A wave goes to the fewest hours this week first: these 4 have a shift on Thursday, so they
    // come last.
    const late = t.ids.slice(-4);
    const [offered, booked, suspended, quiet] = late as [string, string, string, string];
    for (const id of late) {
      await t.f.booking(id, await t.f.shift({ startsAt: hoursFromNow(72) }));
    }
    const slow = slowTransport(100); // 20 messages: about 2 s
    const wave = runOfferWave(payload(t.f, t.shiftId), withFirm, depsFor(slow.transport));
    await slow.firstSent;

    // The office offers it to one of them ("Offer to someone"), through its own job.
    const office = slowTransport(0);
    expect(
      await runOfficeOffer(
        {
          firmId: t.f.firmId,
          idempotencyKey: `office-offer:${t.shiftId}:${offered}`,
          shiftId: t.shiftId,
          workerId: offered,
          officeUserId: t.officeId,
        },
        withFirm,
        depsFor(office.transport),
      ),
    ).toMatchObject({ status: "sent" });
    // Another takes a place from the board.
    expect(
      (
        await takeShift(
          {
            firm: { id: t.f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
            run: withFirm,
            clock: { now: () => NOW },
          },
          booked,
          t.shiftId,
        )
      ).status,
    ).toBe("booked");
    // A licence suspended, and open-shift messages turned off.
    await su.query(
      "update credentials set status = 'suspended' where worker_id = $1 and type = 'SIA_DS'",
      [suspended],
    );
    await su.query("update workers set offer_alerts = false where id = $1", [quiet]);

    expect(await wave).toEqual({ status: "sent", sent: 16, next: null });
    const waveTo = slow.sent.map((m) => t.byMobile.get(m.to));
    for (const id of late) expect(waveTo).not.toContain(id);
    expect(office.sent).toHaveLength(1);
    // One offer for the office's worker (the office's), none from the wave for the other three.
    const offers = await offerRows(t.shiftId);
    expect(offers.filter((o) => o.worker_id === offered)).toHaveLength(1);
    expect(offers.filter((o) => [booked, suspended, quiet].includes(o.worker_id))).toEqual([]);
  }, 60_000);

  it("the office moves the shift mid-wave: the wave starts again, and the rest hear the new time", async () => {
    // 20 per place: all 10 fit in the wave (P4.3).
    const t = await waveFirm(10, {
      allocation_mode: "first_come_first_served",
      wave_per_place: 20,
    });
    const slow = slowTransport(100);
    const deps = depsFor(slow.transport);
    const wave = runOfferWave(payload(t.f, t.shiftId), withFirm, deps);
    await slow.firstSent;
    // 19:00 to 03:00 becomes 20:00 to 04:00.
    await su.query(
      `update shifts set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
        where id = $1`,
      [t.shiftId],
    );
    const first = (await wave) as Extract<WaveResult, { status: "restarted" }>;
    expect(first.status).toBe("restarted");
    expect(first.sent).toBeGreaterThan(0);
    expect(first.sent).toBeLessThan(10);
    const { rows } = await su.query(
      "select 1 from pgboss.job where name = 'offer-wave' and data ->> 'idempotencyKey' = $1",
      [`offer-wave:${t.shiftId}:1:changed`],
    );
    expect(rows).toHaveLength(1);
    const before = slow.sent.length;
    // The queued job runs: the rest, with the new time.
    expect(await runOfferWave(payload(t.f, t.shiftId), withFirm, deps)).toEqual({
      status: "sent",
      sent: 10 - before,
      next: null,
    });
    const bodies = slow.sent.map((m) => ("body" in m ? m.body : ""));
    expect(bodies.slice(0, before).every((b) => b.includes("19:00"))).toBe(true);
    expect(bodies.slice(before).every((b) => b.includes("20:00") && !b.includes("19:00"))).toBe(
      true,
    );
    expect(new Set(slow.sent.map((m) => m.to)).size).toBe(10);
  }, 30_000);

  it("a wave retried in quiet hours is held until they end, even after part of it went", async () => {
    const quiet = { quiet_hours: { start: "22:00", end: "07:00", urgent_override: false } };
    const t = await waveFirm(4, { allocation_mode: "first_come_first_served", ...quiet }, 1, 30);
    const slow = slowTransport(0);
    await expect(
      runOfferWave(payload(t.f, t.shiftId), crashAfterClaim(2), depsFor(slow.transport)),
    ).rejects.toThrow();
    expect(slow.sent).toHaveLength(1);
    // pg-boss retries it at 23:00 that night: held until 07:00.
    const night = hoursFromNow(14);
    expect(
      await runOfferWave(payload(t.f, t.shiftId), withFirm, depsFor(slow.transport, night)),
    ).toEqual({
      status: "held",
      until: hoursFromNow(22),
    });
    expect(slow.sent).toHaveLength(1);
    // At 07:00 the rest go (not the worker claimed just before the crash).
    expect(
      await runOfferWave(
        payload(t.f, t.shiftId),
        withFirm,
        depsFor(slow.transport, hoursFromNow(22)),
      ),
    ).toEqual({ status: "sent", sent: 2, next: null });
    expect(slow.sent).toHaveLength(3);
  });
});

describe("escalation", () => {
  it("emails the office with the shift unlocked; one failed address doesn't stop the rest", async () => {
    const t = await waveFirm(1, {}, 2);
    await t.f.office("admin"); // with the resourcer: 3 office users to email
    const other = await t.f.office("resourcer");
    const { rows } = await su.query<{ email: string }>(
      "select email from office_users where id = $1",
      [other],
    );
    const failing = rows[0]?.email ?? "";
    const slow = slowTransport(1_000, [failing]); // 3 office users: about 3 s of sending
    const deps = depsFor(slow.transport, hoursFromNow(7));
    const escalation = runEscalation(
      { firmId: t.f.firmId, idempotencyKey: `escalate-shift:${t.shiftId}`, shiftId: t.shiftId },
      withFirm,
      deps,
    );
    await slow.firstSent;
    const take = await timed(() =>
      takeShift(
        {
          firm: { id: t.f.firmId, timezone: "Europe/London", signOff: "Test Shift Team" },
          run: withFirm,
          clock: { now: () => hoursFromNow(7) },
        },
        t.ids[0] ?? "",
        t.shiftId,
      ),
    );
    expect(take.value.status).toBe("booked");
    expect(take.ms).toBeLessThan(BOUND_MS);
    expect(await escalation).toEqual({ status: "escalated", notified: 2 });
    expect(slow.sent.map((m) => m.to)).not.toContain(failing);
    const { rows: logged } = await su.query<{ action: string; data: Record<string, unknown> }>(
      `select action, data from events where entity_id = $1 and action like 'shift.escalat%'`,
      [t.shiftId],
    );
    const of = (action: string) => logged.filter((e) => e.action === action).map((e) => e.data);
    expect(of("shift.escalated")).toEqual([expect.objectContaining({ notified: 3 })]);
    expect(of("shift.escalation_emailed")).toHaveLength(3);
    expect(of("shift.escalation_failed")).toEqual([{ officeUserId: other, code: "Error" }]);
    // A place is still free: run again, everyone was claimed, nothing more.
    expect(
      await runEscalation(
        { firmId: t.f.firmId, idempotencyKey: `escalate-shift:${t.shiftId}`, shiftId: t.shiftId },
        withFirm,
        deps,
      ),
    ).toEqual({ status: "already" });
    expect(slow.sent).toHaveLength(2);
  }, 30_000);

  it("a crash after one office user's claim: the retry emails the rest, nobody twice", async () => {
    const t = await waveFirm(1, {});
    await t.f.office("admin");
    await t.f.office("resourcer"); // 3 office users
    const slow = slowTransport(0);
    const deps = depsFor(slow.transport, hoursFromNow(7));
    const job = {
      firmId: t.f.firmId,
      idempotencyKey: `escalate-shift:${t.shiftId}`,
      shiftId: t.shiftId,
    };
    let claims = 0;
    const crashing: WithFirm = async (firmId, fn) => {
      const value = await withFirm(firmId, fn);
      if (value === true && ++claims === 2) throw new Error("worker process died");
      return value;
    };
    await expect(runEscalation(job, crashing, deps)).rejects.toThrow("worker process died");
    expect(slow.sent).toHaveLength(1);
    expect(await runEscalation(job, withFirm, deps)).toEqual({ status: "escalated", notified: 1 });
    expect(await runEscalation(job, withFirm, deps)).toEqual({ status: "already" });
    // The first was emailed, the second may have been (claimed just before the crash), the third
    // after the retry: 2 emails, to 2 different people.
    expect(slow.sent).toHaveLength(2);
    expect(new Set(slow.sent.map((m) => m.to)).size).toBe(2);
  });
});

describe("wiring", () => {
  it("the worker runs the real offer-wave and escalate-shift tasks", async () => {
    // A shift a day and a half from the real clock (the worker's tasks use it), with one worker and
    // one resourcer.
    const f = await bookingFirm(su, withFirm, {});
    const workerId = await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: new Date(Date.now() + 36 * 60 * MINUTE) });
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    await f.office("resourcer");

    const handlers = new Map<string, WorkHandler<unknown>>();
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string, _options: unknown, handler: WorkHandler<unknown>) => {
        handlers.set(name, handler);
        return `worker-${name}`;
      },
      schedule: async () => undefined,
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(boss);

    const run = (queue: string, data: Record<string, unknown>) => {
      const handler = handlers.get(queue);
      if (!handler) throw new Error(`no handler for ${queue}`);
      return handler([{ id: `job-${queue}`, name: queue, data } as never]);
    };
    expect(
      await run(OFFER_WAVE_QUEUE, { firmId: f.firmId, idempotencyKey: "w:1", shiftId, wave: 1 }),
    ).toEqual([
      {
        id: `job-${OFFER_WAVE_QUEUE}`,
        status: "completed",
        output: { status: "sent", sent: 1, next: null },
      },
    ]);
    const { rows } = await su.query("select 1 from offers where shift_id = $1 and worker_id = $2", [
      shiftId,
      workerId,
    ]);
    expect(rows).toHaveLength(1);
    expect(
      await run(ESCALATE_SHIFT_QUEUE, { firmId: f.firmId, idempotencyKey: "e:1", shiftId }),
    ).toEqual([
      {
        id: `job-${ESCALATE_SHIFT_QUEUE}`,
        status: "completed",
        output: { status: "escalated", notified: 1 },
      },
    ]);
  });
});
