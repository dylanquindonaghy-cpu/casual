import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  loadBookingsToCheck,
  loadEvidence,
  loadSheetIssues,
  loadToMark,
  loadUrgentOffers,
} from "@/lib/office/today";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office's to-do queries (src/lib/office/today.ts), read by the dashboard (12E.1), on the
// real database as the app role. Who may see them, and which sessions count as urgent gaps, are
// tested in tests/integration/office.dashboard.test.ts. Each part has its own tests too: bookings
// to check (office.workers), from your rota sheet (sheets.sync), who worked? (office.attendance),
// strike evidence (strikes.evidence). Until 12E.1 they made the Today page, with its gaps,
// cancellations, requests, unknown numbers and expiring credentials: those moved to Events &
// sessions, Cancellations, Enquiries and Casuals, each tested there. NOW is Monday 2 November
// 2026, 09:00 London (GMT).

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

async function todayFirm() {
  const f = await bookingFirm(su, withFirm);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });

  // An urgent shift at 19:00: wave 1 to Ann and Ben (Ben's failed), then the office offered Cal;
  // the waves stopped for want of people, and the office was emailed.
  const urgent = await f.shift({ startsAt: hoursFromNow(10) });
  await su.query("update shifts set is_urgent = true where id = $1", [urgent]);
  const cal = await f.worker({ first: "Cal" });
  const resourcer = await f.office("resourcer");
  const offer = (worker: string, wave: number | null, response: string | null, at: Date) =>
    su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, offered_by, channel, sent_at,
                           response, responded_at)
       values ($1, $2, $3, $4, $5, 'whatsapp', $6, $7, case when $7::text is null then null else $6::timestamptz end)`,
      [f.firmId, urgent, worker, wave, wave === null ? resourcer : null, at, response],
    );
  await offer(ann, 1, null, hoursFromNow(-1));
  await offer(ben, 1, "failed", hoursFromNow(-1));
  await offer(cal, null, null, hoursFromNow(-0.5));
  const event = (action: string, data: Record<string, unknown>) =>
    su.query(
      "insert into events (firm_id, actor_type, action, entity_type, entity_id, data) values ($1, 'system', $2, 'shift', $3, $4)",
      [f.firmId, action, urgent, JSON.stringify(data)],
    );
  await event("offer.waves_stopped", { reason: "no_candidates", wave: 2 });
  await event("shift.escalated", { notified: 1 });

  // A to-do in every other part: Ann made inactive while booked tomorrow (bookings to check); a
  // shift that ended yesterday with Ben not marked (who worked?); a sheet issue; no strikes-team
  // address (strike evidence).
  const tomorrow = await f.shift({ startsAt: hoursFromNow(20) });
  await f.booking(ann, tomorrow);
  await su.query("update workers set status = 'inactive' where id = $1", [ann]);
  const ended = await f.shift({ startsAt: hoursFromNow(-30) });
  await f.booking(ben, ended);
  const sheetShift = await f.shift({ startsAt: hoursFromNow(40) });
  const dee = await f.worker({ first: "Dee" });
  await su.query("update shifts set sheet_issues = $2 where id = $1", [
    sheetShift,
    JSON.stringify({ names: [{ workerId: dee, codes: ["credential_missing"] }] }),
  ]);

  return { f, urgent, tomorrow, ended, sheetShift };
}

describe("loadUrgentOffers", () => {
  it("each session's offers, why they stopped, and the email", async () => {
    const t = await todayFirm();
    const plain = await t.f.shift({ startsAt: hoursFromNow(12) });
    const offers = await withFirm(t.f.firmId, (tx) => loadUrgentOffers(tx, [t.urgent, plain]));
    expect(offers.get(t.urgent)).toEqual({
      wave: 1,
      offered: 2, // Ann's and the office's to Cal (Ben's failed)
      byOffice: 1,
      accepted: 0,
      waiting: 2, // Ann's and Cal's: no answer yet
      declined: 0,
      failed: 1,
      stopped: "no_candidates",
      escalated: true,
    });
    // None sent yet: every number 0.
    expect(offers.get(plain)).toEqual({
      wave: null,
      offered: 0,
      byOffice: 0,
      accepted: 0,
      waiting: 0,
      declined: 0,
      failed: 0,
      stopped: null,
      escalated: false,
    });
    expect(await withFirm(t.f.firmId, (tx) => loadUrgentOffers(tx, []))).toEqual(new Map());
  });

  it("an old stop isn't shown once a later offer went (a second dropout restarted the waves)", async () => {
    const t = await todayFirm();
    const zed = await t.f.worker({ first: "Zed" });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
       values ($1, $2, $3, 3, 'sms', $4)`,
      [t.f.firmId, t.urgent, zed, NOW],
    );
    const offers = await withFirm(t.f.firmId, (tx) => loadUrgentOffers(tx, [t.urgent]));
    expect(offers.get(t.urgent)).toMatchObject({ wave: 3, offered: 3, stopped: null });
  });
});

describe("the to-do parts", () => {
  it("each finds its own firm's item", async () => {
    const t = await todayFirm();
    const got = await withFirm(t.f.firmId, async (tx) => ({
      toCheck: (await loadBookingsToCheck(tx, NOW)).items.map((b) => [b.shiftId, b.cause]),
      fromSheet: (await loadSheetIssues(tx, NOW)).items.map((i) => i.shiftId),
      toMark: (await loadToMark(tx, NOW)).items.map((m) => [m.shiftId, m.unmarked]),
      evidence: await loadEvidence(tx, NOW),
    }));
    expect(got).toEqual({
      toCheck: [[t.tomorrow, "inactive"]],
      fromSheet: [t.sheetShift],
      toMark: [[t.ended, 1]],
      evidence: { addressConfirmed: false, waiting: 0, failed: [], failedMore: false },
    });
  });

  it("never shows another firm's rows", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await todayFirm(); // another firm, with something in every part
    const got = await withFirm(mine.firmId, async (tx) => ({
      // Another firm's shift id gives nothing away: no offers, no stop, no email.
      urgent: (await loadUrgentOffers(tx, [theirs.urgent])).get(theirs.urgent),
      toCheck: await loadBookingsToCheck(tx, NOW),
      fromSheet: await loadSheetIssues(tx, NOW),
      toMark: await loadToMark(tx, NOW),
      failed: (await loadEvidence(tx, NOW)).failed,
    }));
    expect(got).toEqual({
      urgent: {
        wave: null,
        offered: 0,
        byOffice: 0,
        accepted: 0,
        waiting: 0,
        declined: 0,
        failed: 0,
        stopped: null,
        escalated: false,
      },
      toCheck: { items: [], more: false },
      fromSheet: { items: [], more: false },
      toMark: { items: [], more: false },
      failed: [],
    });
  });

  it("says when a list stopped at 50", async () => {
    const f = await bookingFirm(su, withFirm);
    const ben = await f.worker({ first: "Ben" });
    await su.query(
      `with s as (
         insert into shifts (firm_id, event_id, role, starts_at, ends_at, headcount, status, source)
         select $1, $3, 'steward', $2::timestamptz - (n || ' minutes')::interval,
                $2::timestamptz - (n || ' minutes')::interval + interval '8 hours', 1, 'filled', 'native'
           from generate_series(1, 51) as n
         returning id)
       insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
       select $1, s.id, 1, $4, 'confirmed', $2::timestamptz - interval '3 days' from s`,
      [f.firmId, hoursFromNow(-30), await f.event(), ben],
    );
    const toMark = await withFirm(f.firmId, (tx) => loadToMark(tx, NOW));
    expect(toMark.items).toHaveLength(50);
    expect(toMark.more).toBe(true);
  });
});
