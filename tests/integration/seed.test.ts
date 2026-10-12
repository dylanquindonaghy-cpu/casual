import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "@/lib/db/admin/seed";
import { seedId } from "@/lib/db/admin/seed-data";
import { resolveFirmBySlug } from "@/lib/db/directory";
import { withFirm } from "@/lib/db/scoped";
import { superuserPool, urls } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";
import { seedFirms } from "@/lib/db/admin/seed-data";
import { acmeStory } from "@/lib/db/admin/seed-story";

// The demo seed (docs/testing.md): Acme Events and Northline Rail Labour, fake data only.

const ACME = seedId("firm/acme");
const NORTHLINE = seedId("firm/northline");
const run = () => seed({ adminUrl: urls.admin, appUrl: urls.app, nodeEnv: "test" });
// The demo story's own rows (seed-story.ts, 12I.1; its ids are fixed and undated): the tests of the
// Saturday and the walkthrough's other states leave them out, and the story has tests of its own.
const STORY = acmeStory(seedFirms().find((f) => f.slug === "acme") ?? seedFirms()[0]!, new Date());
const STORY_SHIFTS = STORY.sessions.map((x) => x.id);
const STORY_PAY = STORY.payQueries.map((x) => x.id);

let su: Pool;
let other: Tenant;

async function snapshot() {
  const { rows } = await su.query<{ table: string; ids: string[] }>(
    `select 'workers' as table, array_agg(id::text order by id) as ids from workers where firm_id = any($1)
     union all select 'credentials', array_agg(id::text order by id) from credentials where firm_id = any($1)
     union all select 'sites', array_agg(id::text order by id) from sites where firm_id = any($1)
     union all select 'office_users', array_agg(id::text order by id) from office_users where firm_id = any($1)
     union all select 'credential_types', array_agg(id::text order by id) from credential_types where firm_id = any($1)
     union all select 'credential_rules', array_agg(id::text order by id) from credential_rules where firm_id = any($1)
     union all select 'pack_events', array_agg(id::text order by id) from events
       where firm_id = any($1) and action = 'credential_pack.applied'
     union all select 'shifts', array_agg(id::text order by id) from shifts where firm_id = any($1)
     union all select 'assignments', array_agg(id::text order by id) from assignments where firm_id = any($1)
     union all select 'requests', array_agg(id::text order by id) from requests where firm_id = any($1)
     union all select 'pay_records', array_agg(id::text order by id) from pay_records where firm_id = any($1)
     union all select 'pay_queries', array_agg(id::text order by id) from pay_queries where firm_id = any($1)
     union all select 'roster_events', array_agg(id::text order by id) from events
       where firm_id = any($1)
         and action in ('shift.created', 'shift.assigned', 'shift.cancelled', 'request.created',
                        'shift.marked_urgent', 'pay_query.created')`,
    [[ACME, NORTHLINE]],
  );
  return rows;
}

beforeAll(async () => {
  su = superuserPool();
  other = await createTenant(su); // a firm the seed must never touch
  await run();
});
afterAll(async () => {
  await su.end();
});

describe("the demo seed", () => {
  it("running it again changes nothing: same ids, same counts, other firms untouched", async () => {
    const before = await snapshot();
    const otherBefore = await su.query(
      "select count(*)::int as n from workers where firm_id = $1",
      [other.firmId],
    );
    const summary = await run();
    expect(await snapshot()).toEqual(before);
    expect(summary.firms.map((f) => [f.slug, f.workers, f.sites])).toEqual([
      ["acme", 60, 3],
      ["northline", 30, 2],
    ]);
    const otherAfter = await su.query("select count(*)::int as n from workers where firm_id = $1", [
      other.firmId,
    ]);
    expect(otherAfter.rows).toEqual(otherBefore.rows);
  });

  it("Acme Events: 60 workers and the story's 8 (5 with an expired SIA licence, 3 applied), 3 sites and the story's 4, 3 office roles", async () => {
    const { rows } = await su.query(
      `select
         (select count(*)::int from workers where firm_id = $1) as workers,
         (select count(*)::int from sites where firm_id = $1) as sites,
         (select array_agg(role order by role) from office_users where firm_id = $1) as roles,
         (select count(distinct worker_id)::int from credentials where firm_id = $1
            and type like 'SIA%' and status = 'expired' and expires_on < current_date) as expired_sia,
         (select count(distinct worker_id)::int from credentials where firm_id = $1
            and type like 'SIA%' and status = 'applied' and expires_on is null) as applied_sia`,
      [ACME],
    );
    expect(rows[0]).toEqual({
      workers: 68,
      sites: 7,
      roles: ["admin", "payroll", "resourcer"],
      // The generated workers' 5, and the story's Kieran.
      expired_sia: 6,
      applied_sia: 3,
    });
  });

  it("Northline Rail Labour: 30 workers, each with PTS, Sentinel and a drugs and alcohol test", async () => {
    const { rows } = await su.query(
      `select count(*)::int as workers,
              count(*) filter (where (select array_agg(c.type::text order by c.type) from credentials c
                                       where c.worker_id = w.id) = array['PTS', 'RAIL_DA', 'SENTINEL'])::int as fully_ticketed
         from workers w where w.firm_id = $1`,
      [NORTHLINE],
    );
    expect(rows[0]).toEqual({ workers: 30, fully_ticketed: 30 });
  });

  it("is fake data only: drama-range numbers, example.com emails, TEST- credential numbers", async () => {
    const { rows } = await su.query(
      `select
         (select count(*)::int from workers where firm_id = any($1) and mobile_e164 !~ '^[+]447700900[0-9]{3}$') as real_phones,
         (select count(*)::int from workers where firm_id = any($1) and email is not null and email !~ '@example[.]com$') as worker_emails,
         (select count(*)::int from office_users where firm_id = any($1) and email !~ '@example[.]com$') as office_emails,
         (select count(*)::int from credentials where firm_id = any($1) and number is not null and number !~ '^TEST-') as real_numbers,
         (select count(*)::int from firms where id = any($1) and shifts_line_e164 !~ '^[+]447700900[0-9]{3}$') as real_lines`,
      [[ACME, NORTHLINE]],
    );
    expect(rows[0]).toEqual({
      real_phones: 0,
      worker_emails: 0,
      office_emails: 0,
      real_numbers: 0,
      real_lines: 0,
    });
  });

  it("each firm's data is visible only inside that firm, with its own sign-off", async () => {
    const acme = await withFirm(ACME, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from workers`),
    );
    const northline = await withFirm(NORTHLINE, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from workers`),
    );
    expect([acme.rows[0]?.n, northline.rows[0]?.n]).toEqual([68, 30]);
    expect((await resolveFirmBySlug("acme"))?.signOff).toBe("Acme Events Shift Team");
    expect((await resolveFirmBySlug("northline"))?.signOff).toBe(
      "Northline Rail Labour Shift Team",
    );
  });

  it.each([
    ["NODE_ENV=production", "production", "postgres://x:y@localhost:5432/shiftdesk", /production/],
    [
      "a remote host",
      "development",
      "postgres://x:y@db.example.com:5432/shiftdesk",
      /this machine/,
    ],
    [
      "a remote host hidden in ?host= (pg connects there, not to localhost)",
      "development",
      "postgres://x:y@localhost:5432/shiftdesk?host=db.example.com",
      /this machine/,
    ],
    [
      "a remote host after a local one in repeated ?host= (pg uses the last)",
      "development",
      "postgres://x:y@localhost:5432/shiftdesk?host=localhost&host=db.example.com",
      /this machine/,
    ],
  ])("refuses %s before connecting", async (_label, nodeEnv, url, message) => {
    await expect(seed({ adminUrl: url, appUrl: url, nodeEnv })).rejects.toThrow(message);
  });

  it("uses invented places and no repeated names", async () => {
    const { rows } = await su.query<{ names: number; people: number; sites: string[] }>(
      `select count(distinct (w.first_name, w.last_name))::int as names, count(*)::int as people,
              (select array_agg(s.name order by s.name) from sites s where s.firm_id = w.firm_id) as sites
         from workers w where w.firm_id = any($1) group by w.firm_id order by w.firm_id`,
      [[ACME, NORTHLINE]],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.names).toBe(r.people);
      expect(r.sites.every((name) => name.includes(" Demo "))).toBe(true);
    }
  });

  it("puts a seeded worker back as seeded when run again", async () => {
    const id = seedId("acme/worker/0");
    await su.query("update workers set status = 'blocked' where id = $1", [id]);
    await run();
    const { rows } = await su.query("select status from workers where id = $1", [id]);
    expect(rows[0]).toEqual({ status: "active" });
  });
});

describe("the demo seed's credential packs", () => {
  it("Acme gets the security pack and Northline the rail pack, covering every role their workers have", async () => {
    const rules = async (firmId: string) =>
      (
        await su.query<{ role: string; required_types: string[] }>(
          "select role, required_types from credential_rules where firm_id = $1 order by role",
          [firmId],
        )
      ).rows;
    const workerRoles = async (firmId: string) =>
      (
        await su.query<{ role: string }>(
          "select distinct unnest(roles) as role from workers where firm_id = $1 order by 1",
          [firmId],
        )
      ).rows.map((r) => r.role);
    for (const [firmId, sector] of [
      [ACME, "security"],
      [NORTHLINE, "rail"],
    ] as const) {
      const byRole = new Map((await rules(firmId)).map((r) => [r.role, r.required_types]));
      for (const role of await workerRoles(firmId)) expect(byRole.has(role)).toBe(true);
      const { rows } = await su.query<{ sector: string }>(
        "select distinct sector from credential_types where firm_id = $1 order by 1",
        [firmId],
      );
      expect(rows.map((r) => r.sector)).toEqual(["any", sector]);
    }
    expect((await rules(ACME)).find((r) => r.role === "door_supervisor")?.required_types).toEqual([
      "SIA_DS",
    ]);
    expect(
      (await rules(NORTHLINE)).find((r) => r.role === "track_operative")?.required_types,
    ).toEqual(["PTS", "SENTINEL", "RAIL_DA"]);
  });
});

describe("Acme's Saturday event day", () => {
  // The Saturday's shifts are the ones still ahead (the seed's last event is in the past:
  // seed-extras.ts, tested below).
  const acmeRows = async <T extends Record<string, unknown>>(text: string) =>
    (await su.query<T>(text, [ACME])).rows;
  // The same, with the story's sessions as $2 (each query leaves them out).
  const saturdayRows = async <T extends Record<string, unknown>>(text: string) =>
    (await su.query<T>(text, [ACME, STORY_SHIFTS])).rows;

  it("is the next Saturday, with 40 shifts across the three sites, 32 booked and 8 open", async () => {
    const [counts] = await saturdayRows<{
      shifts: number;
      days: string[];
      sites: number;
      filled: number;
      open: number;
      urgent: number;
      no_instructions: number;
    }>(
      `select count(*)::int as shifts,
              array_agg(distinct to_char(starts_at at time zone 'Europe/London', 'YYYY-MM-DD Dy')) as days,
              count(distinct site_id)::int as sites,
              count(*) filter (where status = 'filled')::int as filled,
              count(*) filter (where status = 'open')::int as open,
              count(*) filter (where is_urgent)::int as urgent,
              count(*) filter (where instructions is null)::int as no_instructions
         from shifts where firm_id = $1 and starts_at > now() and id <> all($2::uuid[])`,
    );
    expect(counts).toMatchObject({
      shifts: 40,
      sites: 3,
      filled: 32,
      open: 8,
      urgent: 1,
      no_instructions: 0,
    });
    expect(counts?.days).toHaveLength(1);
    expect(counts?.days[0]).toMatch(/ Sat$/);
    const saturday = counts?.days[0]?.slice(0, 10) ?? "";
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    expect(saturday > today).toBe(true);
    expect(
      new Date(`${saturday}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime(),
    ).toBeLessThanOrEqual(7 * 86_400_000);
    // A filled shift has its booking, and every booking is confirmed on a filled shift.
    const [consistent] = await saturdayRows<{ bad: number }>(
      `select count(*)::int as bad from shifts s
        where s.firm_id = $1 and s.starts_at > now() and s.id <> all($2::uuid[])
          and (s.status = 'filled') <> exists (
          select 1 from assignments a where a.shift_id = s.id and a.status = 'confirmed')`,
    );
    expect(consistent).toEqual({ bad: 0 });
  });

  it("has the urgent dropout: booked, then cancelled at 6am with a reason and the notice given", async () => {
    const rows = await saturdayRows<{
      role: string;
      starts: string;
      status: string;
      is_urgent: boolean;
      cancel_reason: string;
      notice_hours: string;
      worker_id: string;
      cancelled_before_start: boolean;
      notice_matches: boolean;
      another_booking: boolean;
    }>(
      `select s.role, to_char(s.starts_at at time zone 'Europe/London', 'HH24:MI') as starts,
              s.status, s.is_urgent, a.cancel_reason, a.notice_hours::text, a.worker_id::text,
              a.cancelled_at < s.starts_at as cancelled_before_start,
              round(extract(epoch from (s.starts_at - a.cancelled_at)) / 3600, 2) = a.notice_hours as notice_matches,
              exists (select 1 from assignments b where b.shift_id = s.id and b.status = 'confirmed') as another_booking
         from assignments a join shifts s on s.id = a.shift_id
        where a.firm_id = $1 and a.status = 'cancelled_worker' and s.id <> all($2::uuid[])`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      role: "door_supervisor",
      starts: "08:00",
      status: "open",
      is_urgent: true,
      cancel_reason: "I'm unwell",
      cancelled_before_start: true,
      notice_matches: true,
      another_booking: false,
      worker_id: seedId("acme/worker/37"),
    });
    expect(Number(rows[0]?.notice_hours)).toBeGreaterThan(0);
  });

  it("books only workers the rules allow, and never the five kept free for demo logins", async () => {
    const booked = await saturdayRows<{ shift_id: string; worker_id: string }>(
      `select a.shift_id::text, a.worker_id::text from assignments a join shifts s on s.id = a.shift_id
        where a.firm_id = $1 and a.status = 'confirmed' and s.starts_at > now()
          and s.id <> all($2::uuid[])`,
    );
    expect(booked).toHaveLength(32);
    const { previewBooking } = await import("@/lib/roster/book");
    const { withFirm: run } = await import("@/lib/db/scoped");
    for (const b of booked) {
      const verdict = await run(ACME, (tx) =>
        previewBooking(tx, { shiftId: b.shift_id, workerId: b.worker_id, now: new Date() }),
      );
      expect({ ...b, reasons: verdict?.reasons }).toEqual({ ...b, reasons: [] });
    }
    // The dropout's worker could have worked it too (the rules would still allow it).
    const [dropout] = await saturdayRows<{ shift_id: string; worker_id: string }>(
      "select shift_id::text, worker_id::text from assignments where firm_id = $1 and status = 'cancelled_worker' and shift_id <> all($2::uuid[])",
    );
    const again = await run(ACME, (tx) =>
      previewBooking(tx, {
        shiftId: dropout?.shift_id ?? "",
        workerId: dropout?.worker_id ?? "",
        now: new Date(),
      }),
    );
    expect(again?.reasons).toEqual([]);
    const free = [0, 1, 2, 3, 4].map((i) => seedId(`acme/worker/${i}`));
    const [held] = await acmeRows<{ n: number }>(
      `select count(*)::int as n from assignments where firm_id = $1 and worker_id = any('{${free.join(",")}}'::uuid[])`,
    );
    expect(held).toEqual({ n: 0 });
  });

  it("has two open requests from booked workers: a time change and a swap", async () => {
    const rows = await acmeRows<{
      type: string;
      status: string;
      payload: Record<string, string>;
      booked: boolean;
    }>(
      `select r.type, r.status, r.payload,
              exists (select 1 from assignments a where a.shift_id = r.shift_id and a.worker_id = r.worker_id
                        and a.status = 'confirmed') as booked
         from requests r where r.firm_id = $1 order by r.type`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.type, r.status, r.booked])).toEqual([
      ["swap", "open", true],
      ["time_change", "open", true],
    ]);
    expect(rows[1]?.payload).toEqual({
      start: "13:00",
      end: "18:30",
      note: "My train gets in at 12:40.",
    });
  });

  it("gives every Acme worker pay lines for the last 8 complete weeks, as payroll would", async () => {
    const [pay] = await acmeRows<{
      workers_paid: number;
      most: number;
      least: number;
      bad_gross: number;
      bad_dates: number;
      oldest_days: number;
    }>(
      `select count(distinct worker_id)::int as workers_paid,
              max(n)::int as most, min(n)::int as least,
              (select count(*)::int from pay_records where firm_id = $1 and gross_pence <> round(hours * rate_pence)) as bad_gross,
              (select count(*)::int from pay_records where firm_id = $1
                 and (period_end <> period_start + 6 or pay_date <> period_end + 5 or extract(isodow from period_start) <> 1
                      or period_end >= (now() at time zone 'Europe/London')::date)) as bad_dates,
              (select ((now() at time zone 'Europe/London')::date - min(period_start))::int
                 from pay_records where firm_id = $1) as oldest_days
         from (select worker_id, count(*) as n from pay_records where firm_id = $1 group by worker_id) per`,
    );
    expect(pay).toMatchObject({ workers_paid: 60, bad_gross: 0, bad_dates: 0 });
    expect(pay?.least).toBeGreaterThanOrEqual(1);
    expect(pay?.most).toBeLessThanOrEqual(8);
    expect(pay?.oldest_days).toBeLessThanOrEqual(8 * 7 + 6);
  });

  it("logs the day as the app would: each booking, the cancellation with its notice, each request", async () => {
    const rows = await saturdayRows<{ action: string; n: number }>(
      `select action, count(*)::int as n from events
        where firm_id = $1
          and action in ('shift.created', 'shift.assigned', 'shift.cancelled', 'request.created',
                         'shift.marked_urgent')
          and coalesce(data ->> 'shiftId', entity_id::text) in (
                select id::text from shifts where firm_id = $1 and starts_at > now()
                   and id <> all($2::uuid[]))
        group by action order by action`,
    );
    expect(rows).toEqual([
      { action: "request.created", n: 2 },
      { action: "shift.assigned", n: 33 }, // 32 bookings and the dropout's original booking
      { action: "shift.cancelled", n: 1 },
      { action: "shift.created", n: 40 },
      { action: "shift.marked_urgent", n: 1 },
    ]);
    // The dropout is always more than 24 hours before the start (06:00 on the seed day, the
    // Saturday at 08:00, at least a day later), outside Acme's urgent window: the system wouldn't
    // mark it, so the log says Acme's resourcer marked it by hand.
    const [gap] = await saturdayRows<{ hours: string }>(
      "select notice_hours::text as hours from assignments where firm_id = $1 and status = 'cancelled_worker' and shift_id <> all($2::uuid[])",
    );
    expect(Number(gap?.hours)).toBeGreaterThan(24);
    const [marked] = await saturdayRows<{
      actor_type: string;
      actor_id: string;
      data: Record<string, unknown>;
    }>(
      "select actor_type, actor_id::text, data from events where firm_id = $1 and action = 'shift.marked_urgent' and entity_id <> all($2::uuid[])",
    );
    expect(marked).toMatchObject({
      actor_type: "office",
      actor_id: seedId("acme/office/resourcer"),
      data: { by: "firm", cause: "office" },
    });
    expect(Number(marked?.data.hoursToStart)).toBeGreaterThan(0);
    const [cancelled] = await saturdayRows<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'shift.cancelled' and (data ->> 'shiftId')::uuid <> all($2::uuid[])",
    );
    expect(cancelled?.data).toMatchObject({ by: "worker", workerId: seedId("acme/worker/37") });
    // The same notice as the booking's row records.
    const [row] = await saturdayRows<{ notice_hours: string }>(
      "select notice_hours::text from assignments where firm_id = $1 and status = 'cancelled_worker' and shift_id <> all($2::uuid[])",
    );
    expect(cancelled?.data.noticeHours).toBe(Number(row?.notice_hours));
    // Every seeded shift was there before anyone booked it.
    const [order] = await acmeRows<{ bad: number }>(
      `select count(*)::int as bad from assignments a join shifts s on s.id = a.shift_id
        where a.firm_id = $1 and a.confirmed_at <= s.created_at`,
    ); // every seeded booking, the last event's included
    expect(order).toEqual({ bad: 0 });
    expect(JSON.stringify(cancelled?.data)).not.toContain("unwell");
  });

  it("a free worker can see and take one of the open shifts", async () => {
    const { openShiftsFor } = await import("@/lib/portal/open-shifts");
    const { takeShift } = await import("@/lib/portal/take-shift");
    const firm = { id: ACME, timezone: "Europe/London", signOff: "Acme Events Shift Team" };
    const ruth = seedId("acme/worker/0"); // a steward, kept free
    const list = await openShiftsFor({ firm }, ruth);
    expect(list.shifts.map((s) => s.role)).toEqual(["steward", "steward", "steward", "steward"]);
    const first = list.shifts[0];
    expect(first?.opensAt).toBeNull();
    const booked = await takeShift({ firm }, ruth, first?.shiftId ?? "");
    expect(booked.status).toBe("booked");
    // Running the seed again leaves the demo's booking alone.
    await run();
    const [still] = await acmeRows<{ n: number }>(
      `select count(*)::int as n from assignments where firm_id = $1 and worker_id = '${ruth}' and status = 'confirmed'`,
    );
    expect(still).toEqual({ n: 1 });
  });
});

// The walkthrough's other states (src/lib/db/admin/seed-extras.ts, Phase 10 task 20).
describe("the demo's past event, pay queries and Northline's night", () => {
  const rowsOf = async <T extends Record<string, unknown>>(firmId: string, text: string) =>
    (await su.query<T>(text, [firmId])).rows;
  // With the story's sessions ($2) and pay queries ($3), which these leave out.
  const extrasOf = async <T extends Record<string, unknown>>(text: string) =>
    (await su.query<T>(text, [ACME, STORY_SHIFTS, STORY_PAY])).rows;
  const london = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });

  it("Acme's last event: yesterday, 3 stewards at the racecourse and 2 officers at the centre, booked, nobody marked yet", async () => {
    const rows = await extrasOf<{
      day: string;
      site: string;
      role: string;
      status: string;
      booking: string;
      worker: string;
    }>(
      `select (s.starts_at at time zone 'Europe/London')::date::text as day, si.name as site,
              s.role, s.status, a.status as booking, a.worker_id::text as worker
         from shifts s join sites si on si.id = s.site_id
         join assignments a on a.shift_id = s.id
        where s.firm_id = $1 and s.ends_at < now() and s.id <> all($2::uuid[])
          and $3::uuid[] is not null
        order by s.role, a.worker_id`,
    );
    expect(rows).toHaveLength(5);
    const yesterday = london(new Date(Date.now() - 86_400_000));
    for (const r of rows) {
      expect(r.day).toBe(yesterday);
      expect([r.status, r.booking]).toEqual(["filled", "confirmed"]);
    }
    expect(rows.map((r) => [r.role, r.site])).toEqual(
      [
        ...[1, 2, 3].map(() => ["steward", "Acme Demo Racecourse"]),
        ...[1, 2].map(() => ["security_officer", "Acme Demo Shopping Centre"]),
      ].sort(),
    );
    // Logged as the app would: each shift's creation and each booking.
    const [logged] = await extrasOf<{ created: number; assigned: number }>(
      `select count(*) filter (where action = 'shift.created')::int as created,
              count(*) filter (where action = 'shift.assigned')::int as assigned
         from events where firm_id = $1 and $3::uuid[] is not null
          and coalesce(data ->> 'shiftId', entity_id::text) in (
                select id::text from shifts where firm_id = $1 and ends_at < now()
                   and id <> all($2::uuid[]))`,
    );
    expect(logged).toEqual({ created: 5, assigned: 5 });
  });

  it("Acme's pay queries: 10 open, 7 about one week's steward rate, 2 hours missing at the centre, 1 something else, each logged", async () => {
    const groups = await extrasOf<{ key: string; n: number; status: string[] }>(
      `select group_key as key, count(*)::int as n, array_agg(distinct status) as status
         from pay_queries where firm_id = $1 and id <> all($3::uuid[]) and $2::uuid[] is not null
        group by group_key order by count(*) desc`,
    );
    expect(groups.map((g) => g.n)).toEqual([7, 2, 1]);
    expect(groups.every((g) => g.status.join() === "open")).toBe(true);
    // The rate group: the stewards' £13.00, as their pay lines that week say.
    expect(groups[0]?.key).toMatch(/^pay1:wrong_rate:\d{4}-\d{2}-\d{2}:rate:1300$/);
    expect(groups[1]?.key).toMatch(
      new RegExp(`^pay1:missing_hours:\\d{4}-\\d{2}-\\d{2}:site:${seedId("acme/site/centre")}$`),
    );
    // Not "paid late": a browser test raises one, and two such groups (different weeks) would both
    // match its search for its own (the adversarial review).
    expect(groups[2]?.key).toMatch(/^pay1:other:\d{4}-\d{2}-\d{2}$/);
    const [logged] = await extrasOf<{ n: number }>(
      `select count(*)::int as n from events e join pay_queries q on q.id = e.entity_id
        where e.firm_id = $1 and e.action = 'pay_query.created' and e.data ->> 'groupKey' = q.group_key
          and q.id <> all($3::uuid[]) and $2::uuid[] is not null`,
    );
    expect(logged).toEqual({ n: 10 });
  });

  it("Northline's night: 3 track operatives booked tomorrow at 23:00; one cancelled by the office at short notice, logged with the reason and the notice", async () => {
    const rows = await rowsOf<{
      day: string;
      starts: string;
      site: string;
      status: string;
      booking: string;
      reason: string | null;
      notice: string | null;
    }>(
      NORTHLINE,
      `select (s.starts_at at time zone 'Europe/London')::date::text as day,
              to_char(s.starts_at at time zone 'Europe/London', 'HH24:MI') as starts, si.name as site,
              s.status, a.status as booking, a.cancel_reason as reason, a.notice_hours::text as notice
         from shifts s join sites si on si.id = s.site_id join assignments a on a.shift_id = s.id
        where s.firm_id = $1 order by a.status, a.worker_id`,
    );
    const tomorrow = london(new Date(Date.now() + 86_400_000));
    expect(rows.map((r) => [r.day, r.starts, r.site])).toEqual(
      [1, 2, 3].map(() => [tomorrow, "23:00", "Northline Demo Junction"]),
    );
    expect(rows.map((r) => [r.booking, r.status])).toEqual([
      ["cancelled_firm", "open"],
      ["confirmed", "filled"],
      ["confirmed", "filled"],
    ]);
    expect(rows[0]?.reason).toBe("Weather or safety");
    const notice = Number(rows[0]?.notice);
    expect(notice).toBeGreaterThan(0);
    expect(notice).toBeLessThan(48); // Northline's short-notice threshold
    const [cancelled] = await rowsOf<{
      actor_type: string;
      actor_id: string;
      data: Record<string, unknown>;
    }>(
      NORTHLINE,
      "select actor_type, actor_id::text, data from events where firm_id = $1 and action = 'shift.cancelled'",
    );
    expect(cancelled).toMatchObject({
      actor_type: "office",
      actor_id: seedId("northline/office/resourcer"),
      data: { by: "firm", reason: "Weather or safety", noticeHours: notice },
    });
  });

  it("the notice report shows Northline's short-notice firm cancellation (audit L25)", async () => {
    const { loadNoticeReport, parseNoticeQuery } = await import("@/lib/office/notice-report");
    const report = await withFirm(NORTHLINE, (tx) =>
      loadNoticeReport(tx, parseNoticeQuery({}), new Date()),
    );
    const cancellations = report.rows.filter((r) => r.kind === "cancelled");
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0]).toMatchObject({
      initiator: "office",
      shortNotice: true,
      reason: "Weather or safety",
    });
  });
});

// The guardrails review of Phase 10 task 20: a re-run a week later makes this week's Saturday the
// "last event", whose workers it books are on that Saturday already. Each seeded booking is one the
// rules would allow: nobody holds two live bookings that overlap.
describe("the seed run again a week later", () => {
  it("adds next week's Saturday and last event, and never double-books anyone", async () => {
    await seed({
      adminUrl: urls.admin,
      appUrl: urls.app,
      nodeEnv: "test",
      today: new Date(Date.now() + 7 * 86_400_000),
    });
    const { rows: overlaps } = await su.query<{ worker_id: string; a: string; b: string }>(
      `select a1.worker_id::text, a1.id::text as a, a2.id::text as b
         from assignments a1 join shifts s1 on s1.id = a1.shift_id
         join assignments a2 on a2.worker_id = a1.worker_id and a2.id > a1.id
         join shifts s2 on s2.id = a2.shift_id
        where a1.firm_id = any($1) and a2.firm_id = a1.firm_id
          and a1.status not in ('cancelled_worker', 'cancelled_firm')
          and a2.status not in ('cancelled_worker', 'cancelled_firm')
          and s1.starts_at < s2.ends_at and s2.starts_at < s1.ends_at`,
      [[ACME, NORTHLINE]],
    );
    expect(overlaps).toEqual([]);
    // Every shift's status still says whether its places are held: filled exactly when every
    // place has someone (a session of several places stays open while one is free; a cancelled
    // booking's open row is a free place).
    const { rows: wrong } = await su.query<{ n: number }>(
      `select count(*)::int as n from shifts s
        where s.firm_id = any($1) and s.status in ('open', 'filled')
          and (s.status = 'filled') <> ((
            select count(*) from assignments a where a.shift_id = s.id and a.worker_id is not null
              and a.status not in ('cancelled_worker', 'cancelled_firm')) >= s.headcount)`,
      [[ACME, NORTHLINE]],
    );
    expect(wrong).toEqual([{ n: 0 }]);
  });
});
