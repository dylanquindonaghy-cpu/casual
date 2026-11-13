import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { attentionOf, needsCount } from "@/lib/office/dashboard";
import { loadOfficeFrame } from "@/lib/office/frame";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office frame (Phase 25.3, P4's "the layout's 5 reads in one transaction"): every office
// page's counts (the menu's badges, Needs attention's count, the top bar's sessions), read in one
// transaction for the office user as they are now, each only for the roles that see it. On the real
// database, as the app role.

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

const clock = { now: () => NOW };

// A firm with something for each count: a pay query waiting, an upload to check, a message that
// needs a person, an urgent place, and a booked session that ended unmarked.
async function frameFirm() {
  const f = await bookingFirm(su, withFirm);
  const ann = await f.worker({ first: "Ann" });
  await su.query(
    `insert into pay_queries (firm_id, worker_id, work_date, issue_type)
     values ($1, $2, '2026-10-26', 'missing_hours')`,
    [f.firmId, ann],
  );
  await su.query(
    `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data)
     values ($1, $2, 'photo', 'image/jpeg', 3, $3, '\\xffd8ff'::bytea)`,
    [f.firmId, ann, randomBytes(32).toString("hex")],
  );
  await su.query(
    `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                           body, worker_id, handled_at, handled_as, intent, created_at)
     values ($1, 'in', 'whatsapp', $2, '+447700900931', '+447700900932', 'hello', $3, $4,
             'office', 'office', $4)`,
    [f.firmId, `SM${randomBytes(16).toString("hex")}`, ann, new Date(NOW.getTime() - 3_600_000)],
  );
  const urgent = await f.shift({ startsAt: hoursFromNow(5) });
  await su.query("update shifts set is_urgent = true where id = $1", [urgent]);
  await f.booking(ann, await f.shift({ startsAt: hoursFromNow(-30) }), "confirmed");
  // Counts each transaction the frame opens.
  let transactions = 0;
  const counted: WithFirm = (firmId, fn) => {
    transactions += 1;
    return withFirm(firmId, fn);
  };
  const frame = async (officeUserId: string, firmId = f.firmId) => {
    transactions = 0;
    const read = await loadOfficeFrame({ firm: { id: firmId }, officeUserId, run: counted, clock });
    return { read, transactions };
  };
  return { f, frame };
}

describe("the office frame", () => {
  it("an admin's: all five counts, in one transaction", async () => {
    const t = await frameFirm();
    const { read, transactions } = await t.frame(await t.f.office("admin"));
    expect(transactions).toBe(1);
    expect(read.payQueries).toEqual({ ok: true, data: 1 });
    expect(read.uploads).toEqual({ ok: true, data: 1 });
    expect(read.needPerson).toEqual({ ok: true, data: 1 });
    expect(read.appRequests).toEqual({ ok: true, data: 0 });
    expect(read.shell).toMatchObject({ ok: true, data: { urgent: 1 } });
    if (!read.needs?.needs.ok) throw new Error("Needs attention didn't load");
    expect(read.needs.timeZone).toBe("Europe/London");
    expect(read.needs.today).toBe("2026-11-02");
    // The upload and the strikes team's address not set (sessions to mark are the dashboard's
    // since Phase 26.4, upd-6).
    expect(needsCount(read.needs.needs.data)).toBe(1 + 1);
    // The bell (Phase 26.4): Updates' new count and the pop-up's cancellations, in the same read.
    expect(read.updates).toMatchObject({ ok: true, data: { timeZone: "Europe/London" } });
  });

  it("each role sees its own: a resourcer no pay queries, payroll only those", async () => {
    const t = await frameFirm();
    const resourcer = (await t.frame(await t.f.office("resourcer"))).read;
    expect(resourcer.payQueries).toBeNull();
    expect([resourcer.uploads, resourcer.needPerson, resourcer.shell].map((p) => p?.ok)).toEqual([
      true,
      true,
      true,
    ]);
    expect(resourcer.needs?.needs.ok).toBe(true);
    const payroll = (await t.frame(await t.f.office("payroll"))).read;
    expect(payroll).toEqual({
      payQueries: { ok: true, data: 1 },
      uploads: null,
      needPerson: null,
      appRequests: null, // Wave 1 (w1-07): with Enquiries, admins and resourcers
      needs: null,
      shell: null,
      updates: null,
      clientRequests: null, // Phase 36.4: client requests are for admins and resourcers
    });
    expect(resourcer.clientRequests).toEqual({
      ok: true,
      data: { waiting: 0, urgent: 0, plannerToDo: 0 },
    });
  });

  it("nothing for a switched-off account, or one from another firm", async () => {
    const t = await frameFirm();
    const other = await frameFirm();
    const none = {
      payQueries: null,
      uploads: null,
      needPerson: null,
      appRequests: null, // Wave 1 (w1-07): with Enquiries, admins and resourcers
      needs: null,
      shell: null,
      updates: null,
      clientRequests: null,
    };
    expect((await t.frame(await t.f.office("admin", "disabled"))).read).toEqual(none);
    // Another firm's admin, asking under this firm: not one of its users.
    expect((await t.frame(await other.f.office("admin"), t.f.firmId)).read).toEqual(none);
  });

  // Wave 1 (w1-07): the requests casuals made in the app, waiting for an answer, are counted in the
  // frame (the top bar's Needs attention and the Enquiries badge), by the same rule as Enquiries'
  // "{n} requests to answer"; a shifts-line question still with its message is counted once, as
  // an enquiry that needs a person.
  it("the requests from the app waiting for an answer, never counted twice", async () => {
    const t = await frameFirm();
    const other = await frameFirm();
    const ben = await t.f.worker({ first: "Ben" });
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(48) });
    await t.f.booking(ben, shiftId);
    const by = await t.f.office("admin");
    const request = async (
      firmId: string,
      workerId: string,
      type: string,
      status: string,
      messageId: string | null = null,
    ) =>
      su.query(
        `insert into requests (firm_id, worker_id, shift_id, type, payload, status, message_id,
                               created_at, resolved_at, resolved_by)
         values ($1, $2, $3, $4, '{}'::jsonb, $5, $6, $7,
                 case when $5 in ('open', 'escalated') then null else $7::timestamptz end,
                 case when $5 in ('approved', 'declined') then $8::uuid end)`,
        [firmId, workerId, type === "general" ? null : shiftId, type, status, messageId, NOW, by],
      );
    // Two waiting: an open time change and an escalated swap, both made in the app.
    await request(t.f.firmId, ben, "time_change", "open");
    await request(t.f.firmId, ben, "swap", "escalated");
    // Not waiting: declined, taken back.
    await request(t.f.firmId, ben, "time_change", "declined");
    await request(t.f.firmId, ben, "swap", "withdrawn");
    // A shifts-line question still with its open message: the message needs a person, once.
    const { rows } = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, worker_id, handled_at, handled_as, intent, created_at)
       values ($1, 'in', 'whatsapp', $2, '+447700900941', '+447700900932', 'is parking free?', $3,
               $4, 'office', 'office', $4)
       returning id::text as id`,
      [t.f.firmId, `SM${randomBytes(16).toString("hex")}`, ben, NOW],
    );
    await request(t.f.firmId, ben, "general", "open", rows[0]?.id ?? null);
    // Another firm's waiting request: never this firm's.
    const theirs = await other.f.worker({ first: "Cal" });
    await su.query(
      `insert into requests (firm_id, worker_id, type, payload, status, created_at)
       values ($1, $2, 'availability', '{}'::jsonb, 'open', $3)`,
      [other.f.firmId, theirs, NOW],
    );
    for (const role of ["admin", "resourcer"] as const) {
      const { read } = await t.frame(await t.f.office(role));
      expect(read.appRequests).toEqual({ ok: true, data: 2 });
      // The frame's message and the question's: 2, the question not in appRequests.
      expect(read.needPerson).toEqual({ ok: true, data: 2 });
    }
    expect((await other.frame(await other.f.office("admin"))).read.appRequests).toEqual({
      ok: true,
      data: 1,
    });
  });

  // Wave 1 (w1-04): a message the shifts line never sorted needs a person 10 minutes after it came
  // in: the menu's Enquiries badge and Needs attention count it.
  it("a message the shifts line never sorted, 15 minutes old, needs a person", async () => {
    const t = await frameFirm();
    const admin = await t.f.office("admin");
    const before = (await t.frame(admin)).read;
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, created_at)
       values ($1, 'in', 'whatsapp', $2, '+447700900951', '+447700900932', 'anyone there?', $3)`,
      [t.f.firmId, `SM${randomBytes(16).toString("hex")}`, new Date(NOW.getTime() - 15 * 60_000)],
    );
    const { read } = await t.frame(admin);
    expect(before.needPerson).toEqual({ ok: true, data: 1 });
    expect(read.needPerson).toEqual({ ok: true, data: 2 });
    if (!read.needs || !before.needs) throw new Error("Needs attention didn't load");
    const count = (r: typeof read) =>
      r.needs ? attentionOf(r.needs.needs, r.needPerson, r.appRequests)?.count : null;
    expect(count(read)).toBe((count(before) ?? 0) + 1);
  });

  it("only this firm's rows in its counts", async () => {
    const t = await frameFirm();
    const other = await frameFirm();
    const mine = (await t.frame(await t.f.office("admin"))).read;
    const theirs = (await other.frame(await other.f.office("admin"))).read;
    // Each firm has one of each: neither counts the other's.
    for (const read of [mine, theirs]) {
      expect(read.payQueries).toEqual({ ok: true, data: 1 });
      expect(read.uploads).toEqual({ ok: true, data: 1 });
      expect(read.needPerson).toEqual({ ok: true, data: 1 });
      expect(read.shell).toMatchObject({ ok: true, data: { urgent: 1 } });
    }
  });
});
