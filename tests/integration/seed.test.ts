import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSaturday, loadWeekOffers, seed } from "@/lib/db/admin/seed";
import { seedId } from "@/lib/db/admin/seed-data";
import { resolveFirmBySlug } from "@/lib/db/directory";
import { withFirm, type FirmTx } from "@/lib/db/scoped";
import { superuserPool, urls } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";
import { seedFirms, weekOffers } from "@/lib/db/admin/seed-data";
import { acmeSaturday } from "@/lib/db/admin/seed-saturday";
import { acmeStory } from "@/lib/db/admin/seed-story";
import { DAILY_OFFER_CAP } from "@/lib/rules/offer-cap";
import { mayMessageNow, quietHours, quietUntil } from "@/lib/rules/quiet-hours";
import { localDateOf, mondayOf, startOfDay } from "@/lib/time/zoned";

// The demo seed (docs/testing.md): Acme Events and Northline Rail Labour, fake data only.

const ACME = seedId("firm/acme");
const NORTHLINE = seedId("firm/northline");
const run = () => seed({ adminUrl: urls.admin, appUrl: urls.app, nodeEnv: "test" });
// The demo story's own rows (seed-story.ts, 12I.1; its ids are fixed and undated): the tests of the
// Saturday and the walkthrough's other states leave them out, and the story has tests of its own.
const STORY = acmeStory(seedFirms().find((f) => f.slug === "acme") ?? seedFirms()[0]!, new Date());
const STORY_SHIFTS = STORY.sessions.map((x) => x.id);
const STORY_PAY = STORY.payQueries.map((x) => x.id);
const LONDON = "Europe/London";
// Never offered a shift by the seed: the five kept free for demo logins and the four the
// walkthrough logs in as.
const LEFT_OUT = [0, 1, 2, 3, 4, 10, 22, 29, 39].map((i) => seedId(`acme/worker/${i}`));

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
     union all select 'offers', array_agg(id::text order by id) from offers where firm_id = any($1)
     union all select 'roster_events', array_agg(id::text order by id) from events
       where firm_id = any($1)
         and action in ('shift.created', 'shift.assigned', 'shift.cancelled', 'request.created',
                        'shift.marked_urgent', 'pay_query.created', 'offer.sent')`,
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

  it("Acme Events: 60 workers (5 with an expired SIA licence, 3 applied) and the story's 8, 3 sites and the story's 4, 3 office roles", async () => {
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
      expired_sia: 5,
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

  // This week's offers the seed should have written, worked out from what's stored, by the rules
  // module the app uses (src/lib/rules/quiet-hours.ts): when the seed ran (its Saturday's shifts are
  // dated a week before it ran), Acme's quiet hours, and the Saturday's own bookings.
  const plannedFromStore = async () => {
    const acme = seedFirms().find((f) => f.slug === "acme")!;
    const day = acmeSaturday(acme.workers, acme.sites, new Date());
    const {
      rows: [stored],
    } = await su.query<{ settings: Record<string, unknown>; created_at: Date | null }>(
      `select f.settings,
              (select min(s.created_at) from shifts s
                where s.firm_id = f.id and s.id = any($2::uuid[])) as created_at
         from firms f where f.id = $1`,
      [ACME, day.shifts.map((s) => s.id)],
    );
    if (!stored?.created_at) throw new Error("the seed's Saturday isn't there");
    const seededAt = new Date(stored.created_at.getTime() + 7 * 24 * 3_600_000);
    const quiet = quietHours(stored.settings);
    const allowed = (t: Date) =>
      mayMessageNow({ now: t, timeZone: LONDON, quiet, urgent: false }).ok;
    const monday = startOfDay(mondayOf(localDateOf(seededAt, LONDON)), LONDON).getTime();
    // Waiting: all 10, once quiet hours have first ended this week. A run before then (Monday
    // before 07:00) has no minute yet an offer could have gone, so it plans none.
    const firstOpen = quietUntil(new Date(monday), LONDON, quiet)?.getTime() ?? monday;
    const waiting = firstOpen < seededAt.getTime() ? 10 : 0;
    // Said yes: sent 20 minutes before the booking, or in the last minute before quiet hours
    // began when that is inside them; none before Monday. The 12 latest.
    const sentFor = (confirmedAt: Date): Date | null => {
      let at = confirmedAt.getTime() - 20 * 60_000;
      if (!allowed(new Date(at))) {
        at -= at % 60_000;
        while (at >= monday && !allowed(new Date(at))) at -= 60_000;
      }
      return at >= monday ? new Date(at) : null;
    };
    const { rows: booked } = await su.query<{
      id: string;
      shift_id: string;
      worker_id: string;
      confirmed_at: Date;
    }>(
      `select id::text, shift_id::text, worker_id::text, confirmed_at from assignments
        where firm_id = $1 and id = any($2::uuid[]) and status = 'confirmed'`,
      [ACME, day.bookings.map((b) => b.id)],
    );
    const accepted = booked
      .filter((b) => !LEFT_OUT.includes(b.worker_id) && b.confirmed_at <= seededAt)
      .flatMap((b) => {
        const sentAt = sentFor(b.confirmed_at);
        return sentAt ? [{ ...b, sentAt }] : [];
      })
      .sort(
        (a, b) => b.confirmed_at.getTime() - a.confirmed_at.getTime() || a.id.localeCompare(b.id),
      )
      .slice(0, 12);
    return { day, waiting, accepted, allowed };
  };

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

  it("has this week's made-up offers (Phase 23): waiting on Saturday's open places, said yes for this week's bookings; none said no or failed, none in quiet hours; each logged as sent", async () => {
    const now = new Date();
    const monday = startOfDay(mondayOf(localDateOf(now, "Europe/London")), "Europe/London");
    const expected = await plannedFromStore();
    const rows = await acmeRows<{
      id: string;
      shift_id: string;
      worker_id: string;
      roles: string[];
      role: string;
      response: string | null;
      sent_at: Date;
      responded_at: Date | null;
      wave: number | null;
      offered_by: string | null;
      channel: string;
      shift_status: string;
      starts_at: Date;
      is_urgent: boolean;
      confirmed_at: Date | null;
      logged: number;
    }>(
      `select o.id::text, o.shift_id::text, o.worker_id::text, w.roles, s.role, o.response,
              o.sent_at, o.responded_at, o.wave, o.offered_by::text, o.channel,
              s.status as shift_status, s.starts_at, s.is_urgent,
              (select a.confirmed_at from assignments a
                where a.shift_id = o.shift_id and a.worker_id = o.worker_id
                  and a.status = 'confirmed') as confirmed_at,
              (select count(*)::int from events e
                where e.firm_id = o.firm_id and e.entity_id = o.id and e.action = 'offer.sent'
                  and e.data ->> 'shiftId' = o.shift_id::text
                  and e.data ->> 'workerId' = o.worker_id::text
                  and e.data ->> 'offeredBy' = o.offered_by::text) as logged
         from offers o
         join shifts s on s.id = o.shift_id
         join workers w on w.id = o.worker_id
        where o.firm_id = $1 and o.offered_by = '${seedId("acme/office/resourcer")}'`,
    );
    const said = (r: string | null) => rows.filter((x) => x.response === r);
    // Waiting for a reply: the 10 (none on a seed run on Monday before quiet hours end), each on
    // one of Saturday's open places to come (never the urgent dropout), to a casual of its role not
    // booked on it.
    expect(said(null)).toHaveLength(expected.waiting);
    for (const o of said(null)) {
      expect(o).toMatchObject({ shift_status: "open", is_urgent: false, confirmed_at: null });
      expect(o.starts_at.getTime()).toBeGreaterThan(now.getTime());
    }
    // None said no: the app can't record a "no" yet (PLAN.md's Parking lot), so the seed makes up
    // none.
    expect(said("declined")).toEqual([]);
    // Said yes: exactly the bookings the rule picks from what's stored (none before about 07:20 on
    // Thursday), each the casual's own booking of it, made then: sent 20 minutes before, or in the
    // last minute before quiet hours began.
    expect(said("accepted")).toHaveLength(expected.accepted.length);
    const key = (shiftId: string, workerId: string, sentAt: Date, respondedAt: Date | null) =>
      `${shiftId} ${workerId} ${sentAt.toISOString()} ${respondedAt?.toISOString()}`;
    expect(
      said("accepted")
        .map((o) => key(o.shift_id, o.worker_id, o.sent_at, o.responded_at))
        .sort(),
    ).toEqual(
      expected.accepted.map((b) => key(b.shift_id, b.worker_id, b.sentAt, b.confirmed_at)).sort(),
    );
    for (const o of said("accepted")) {
      expect(o.confirmed_at).not.toBeNull();
      expect(o.responded_at).toEqual(o.confirmed_at);
    }
    // Every one this week, by the office's resourcer, by text, answered after it went; only waiting
    // or said yes; each logged once as sent. None in Acme's quiet hours: the app holds an offer
    // that isn't urgent until they end (mayMessageNow).
    expect(rows.map((r) => r.response).filter((r) => !["accepted", null].includes(r))).toEqual([]);
    for (const o of rows) {
      expect(o.sent_at.getTime()).toBeGreaterThanOrEqual(monday.getTime());
      expect(o.sent_at.getTime()).toBeLessThanOrEqual(now.getTime());
      if (o.responded_at)
        expect(o.responded_at.getTime()).toBeGreaterThanOrEqual(o.sent_at.getTime());
      expect(o).toMatchObject({ wave: null, channel: "sms", logged: 1 });
      expect(o.roles).toContain(o.role);
      expect(expected.allowed(o.sent_at), `${o.id} sent ${o.sent_at.toISOString()}`).toBe(true);
    }
    // Never to the five kept free for demo logins, nor to anyone the walkthrough logs in as.
    expect(rows.filter((r) => LEFT_OUT.includes(r.worker_id))).toEqual([]);
    const { rows: failed } = await su.query(
      "select id from offers where firm_id = $1 and response = 'failed'",
      [ACME],
    );
    expect(failed).toEqual([]);
  });

  // The offer boundary (tests/unit/offers.boundary.test.ts) lets the seed write offers only because
  // of this: "only eligible workers are ever notified". Every seeded offer, waiting or said yes, is
  // to a casual the booking rules allow for that session when the seed ran (the batch the offer
  // candidate list asks, src/lib/offers/candidates.ts), and the seed sends none of them: no message
  // to or from those casuals, and no job that would send one. The seed takes the offer-count lock
  // like every offer writer, but doesn't check the daily offer cap (mayOfferToday,
  // src/lib/rules/offer-cap.ts), so this test counts each casual's offers on each London day
  // against the cap itself.
  it("offers this week's made-up offers only to casuals the booking rules allow, and sends nothing for them", async () => {
    const seeded = await acmeRows<{
      id: string;
      shift_id: string;
      worker_id: string;
      response: string | null;
    }>(
      `select id::text, shift_id::text, worker_id::text, response from offers
        where firm_id = $1 and offered_by = '${seedId("acme/office/resourcer")}'
        order by id`,
    );
    // Waiting once quiet hours have first ended this week; said yes once this week's bookings are
    // in (from about 07:20 on Thursday); never said no.
    const expected = await plannedFromStore();
    expect(seeded.filter((o) => o.response === null)).toHaveLength(expected.waiting);
    expect(seeded.filter((o) => o.response === "accepted")).toHaveLength(expected.accepted.length);
    expect(seeded.filter((o) => o.response === "declined")).toEqual([]);
    expect(seeded.filter((o) => !["accepted", null].includes(o.response))).toEqual([]);

    const { previewBookings } = await import("@/lib/roster/book");
    const { pairKey } = await import("@/lib/roster/eligibility-input");
    const verdicts = await withFirm(ACME, (tx) =>
      previewBookings(tx, {
        shiftIds: [...new Set(seeded.map((o) => o.shift_id))],
        workerIds: [...new Set(seeded.map((o) => o.worker_id))],
        now: new Date(),
      }),
    );
    for (const o of seeded) {
      const verdict = verdicts.get(pairKey(o.shift_id, o.worker_id));
      expect({ ...o, ok: verdict?.ok, reasons: verdict?.reasons }).toEqual({
        ...o,
        ok: true,
        reasons: [],
      });
    }

    // The daily cap, which the seed doesn't check: no casual has more offers sent on one London day
    // than it lets through (every offer of theirs counts except one that failed to send, as the
    // candidate list counts them).
    const workerIds = [...new Set(seeded.map((o) => o.worker_id))];
    const { rows: perDay } = await su.query<{ worker_id: string; day: string; sent: number }>(
      `select o.worker_id::text, (o.sent_at at time zone 'Europe/London')::date::text as day,
              count(*)::int as sent
         from offers o
        where o.firm_id = $1 and o.worker_id = any($2::uuid[])
          and o.response is distinct from 'failed'
        group by 1, 2`,
      [ACME, workerIds],
    );
    // (Something to count whenever the seed wrote offers: none on a run on Monday before quiet
    // hours end.)
    expect(perDay.length > 0).toBe(seeded.length > 0);
    expect(perDay.filter((r) => r.sent > DAILY_OFFER_CAP)).toEqual([]);

    // Nothing sent: no message on the shifts line to or from any of them (by worker or number).
    const { rows: messages } = await su.query(
      `select m.id from messages m
        where m.firm_id = $1
          and (m.worker_id = any($2::uuid[])
               or m.to_e164 in (select w.mobile_e164 from workers w
                                 where w.firm_id = $1 and w.id = any($2::uuid[]))
               or m.from_e164 in (select w.mobile_e164 from workers w
                                   where w.firm_id = $1 and w.id = any($2::uuid[])))`,
      [ACME, workerIds],
    );
    expect(messages).toEqual([]);
    // And no job to send one: none of Acme's in the offer queues, and none of any kind naming one
    // of these offers or casuals.
    const { OFFER_WAVE_QUEUE, ESCALATE_SHIFT_QUEUE } = await import("@/lib/offers/waves");
    const { OFFICE_OFFER_QUEUE } = await import("@/lib/offers/office-offer");
    const ids = [...seeded.map((o) => o.id), ...workerIds];
    const { rows: jobs } = await su.query<{ name: string }>(
      `select j.name from pgboss.job j
        where j.data ->> 'firmId' = $1
          and (j.name = any($2::text[])
               or exists (select 1 from unnest($3::text[]) as x(id) where j.data::text like '%' || x.id || '%'))`,
      [ACME, [OFFER_WAVE_QUEUE, ESCALATE_SHIFT_QUEUE, OFFICE_OFFER_QUEUE], ids],
    );
    expect(jobs).toEqual([]);
  });

  it("the demo's dashboard reads every part of its board: the offers waiting on Offered, places on the chart, pay queries with payroll", async () => {
    const { loadBoard } = await import("@/lib/office/dashboard-board");
    const d = await withFirm(ACME, (tx) => loadBoard(tx, new Date()));
    const parts = [d.planner, d.counts, d.chart, d.gaps, d.overnight, d.toMark];
    expect(parts.map((c) => c.ok)).toEqual(Array(6).fill(true));
    if (!d.gaps.ok || !d.chart.ok) throw new Error("a part failed");
    // Offers waiting, unless the seed ran on Monday before quiet hours ended (it plans none then).
    const { waiting } = await plannedFromStore();
    expect(d.gaps.data.offered.waiting > 0).toBe(waiting > 0);
    expect(d.gaps.data.offered.sessions.length > 0).toBe(waiting > 0);
    // Nobody said no: the app can't record a "no" yet, so the demo shows none.
    const sessions = [...d.gaps.data.toOffer.sessions, ...d.gaps.data.offered.sessions];
    expect(sessions.reduce((n, s) => n + s.offers.saidNo, 0)).toBe(0);
    expect(d.chart.data.days.some((x) => x.toOffer + x.offered > 0)).toBe(true);
    // Pay queries with payroll (the top bar's count for an admin).
    const { officePayQueriesWaiting } = await import("@/lib/office/pay-dashboard");
    expect(await officePayQueriesWaiting({ firm: { id: ACME } }, "admin")).toBeGreaterThan(0);
  });

  it("plans this week's offers from the seed's own day: 10 waiting, none said no, said yes for the bookings made since Monday, none in quiet hours", async () => {
    const acme = seedFirms().find((f) => f.slug === "acme")!;
    const quiet = quietHours(acme.settings);
    const inQuiet = (t: Date) =>
      !mayMessageNow({ now: t, timeZone: LONDON, quiet, urgent: false }).ok;
    const plan = (now: Date) => {
      const day = acmeSaturday(acme.workers, acme.sites, now);
      const bookings = day.bookings.filter((b) => b.status === "confirmed");
      const offers = weekOffers({
        now,
        workers: acme.workers,
        quiet,
        openPlaces: day.shifts
          .filter((x) => x.status === "open" && !x.isUrgent)
          .map((x) => ({ id: x.id, role: x.role })),
        bookings,
      });
      // Each said yes is that casual's own confirmed booking of the session, answered when they
      // booked it; `lead` is 20 minutes before that.
      const yes = offers
        .filter((o) => o.response === "accepted")
        .map((offer) => {
          const booking = bookings.find(
            (b) => b.shiftId === offer.shiftId && b.workerId === offer.workerId,
          );
          expect(booking, offer.id).toBeDefined();
          expect(offer.respondedAt).toEqual(booking?.confirmedAt);
          return { offer, lead: new Date((booking?.confirmedAt.getTime() ?? NaN) - 20 * 60_000) };
        });
      return { offers, yes };
    };
    const workers = (...i: number[]) => i.map((n) => seedId(`acme/worker/${n}`));
    // Thursday 22 Oct 2026, 12:00 BST: Monday's midnight was 23:00 UTC on Sunday 18 Oct.
    const thursday = new Date("2026-10-22T11:00:00Z");
    const monday = new Date("2026-10-18T23:00:00Z");
    const { offers, yes } = plan(thursday);
    const said = (r: string | null) => offers.filter((o) => o.response === r);
    expect([said(null).length, said("declined").length]).toEqual([10, 0]);
    // Only waiting or said yes (the app can't record a "no" yet); the 10 waiting on Saturday's open
    // places, by worker.
    expect(new Set(offers.map((o) => o.response))).toEqual(new Set([null, "accepted"]));
    expect(said(null).map((o) => o.workerId)).toEqual(
      workers(23, 24, 25, 27, 28, 41, 38, 40, 57, 58),
    );
    // Said yes: the bookings made from Monday 07:20 on (each 72 hours or more before the seed ran,
    // one an hour apart), each sent 20 minutes before. An earlier one's offer would have gone in
    // Monday's quiet hours (00:00 to 07:00), and the last minute before them is on Sunday. Never
    // Sam Walsh's (the walkthrough logs in as him).
    expect(yes.map((y) => y.offer.workerId)).toEqual(workers(5, 6, 7, 8, 9));
    expect(said("accepted").map((o) => o.workerId)).not.toContain(seedId("acme/worker/10"));
    for (const { offer, lead } of yes) expect(offer.sentAt).toEqual(lead);
    for (const o of offers) {
      expect(o.sentAt.getTime()).toBeGreaterThanOrEqual(monday.getTime());
      expect(o.sentAt.getTime()).toBeLessThan(thursday.getTime());
    }
    expect(offers.filter((o) => inQuiet(o.sentAt))).toEqual([]);
    expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length);
    expect(new Set(offers.map((o) => `${o.shiftId} ${o.workerId}`)).size).toBe(offers.length);

    // Friday 23 Oct, 12:00 BST: the 12 latest bookings made since Monday, Sam Walsh's left out. The
    // 7 made on Tuesday between midnight and 06:00 had their offer in the last minute before
    // Monday's quiet hours began (21:59), when the app would have sent it; the rest 20 minutes
    // before.
    const friday = plan(new Date("2026-10-23T11:00:00Z"));
    const lastMinute = new Date("2026-10-19T20:59:00Z"); // Monday 21:59 BST
    expect(friday.yes.map((y) => y.offer.workerId)).toEqual(
      workers(5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 30, 31),
    );
    for (const { offer, lead } of friday.yes)
      expect(offer.sentAt).toEqual(inQuiet(lead) ? lastMinute : lead);
    expect(
      friday.yes.filter((y) => y.offer.sentAt.getTime() === lastMinute.getTime()),
    ).toHaveLength(7);
    expect(friday.offers.filter((o) => o.response === null)).toHaveLength(10);
    expect(friday.offers.filter((o) => inQuiet(o.sentAt))).toEqual([]);

    // Run in Monday's quiet hours (00:30), before they first end this week: there's no minute yet
    // an offer could have gone, so none at all.
    expect(plan(new Date("2026-10-18T23:30:00Z")).offers).toEqual([]);
    // Run at 07:30: the 10 waiting, all in the half hour since quiet hours ended; none said yes yet.
    const seven = new Date("2026-10-19T06:00:00Z");
    const half = new Date("2026-10-19T06:30:00Z");
    const early = plan(half).offers;
    expect(early.map((o) => o.response)).toEqual(Array(10).fill(null));
    for (const o of early) {
      expect(o.sentAt.getTime()).toBeGreaterThanOrEqual(seven.getTime());
      expect(o.sentAt.getTime()).toBeLessThan(half.getTime());
    }
  });

  // A demo cancels a booking that said yes to an offer, then the seed runs again: its Saturday is
  // already there, so it adds no offer and logs no offer.sent (only a Saturday it adds gets offers).
  it("running it again after a demo cancels a said-yes booking adds no offer and logs none", async () => {
    const offersNow = async () =>
      (
        await su.query(
          `select o.id::text, o.shift_id::text, o.worker_id::text, o.sent_at, o.response,
                  o.responded_at, o.channel,
                  (select array_agg(e.id order by e.id) from events e
                    where e.firm_id = o.firm_id and e.entity_id = o.id
                      and e.action = 'offer.sent') as logged
             from offers o where o.firm_id = $1 order by o.id`,
          [ACME],
        )
      ).rows;
    const sentLog = async () =>
      (
        await su.query(
          "select count(*)::int as n from events where firm_id = $1 and action = 'offer.sent'",
          [ACME],
        )
      ).rows;
    const { day } = await plannedFromStore();
    // The booking behind a said-yes offer; before there is one (a seed run before about 07:20 on
    // Thursday), the Saturday's latest booking.
    const {
      rows: [booking],
    } = await su.query<{ id: string; shift_id: string }>(
      `select a.id::text, a.shift_id::text from assignments a
        where a.firm_id = $1 and a.id = any($2::uuid[]) and a.status = 'confirmed'
        order by exists (select 1 from offers o
                          where o.firm_id = a.firm_id and o.shift_id = a.shift_id
                            and o.worker_id = a.worker_id and o.response = 'accepted') desc,
                 a.confirmed_at desc
        limit 1`,
      [ACME, day.bookings.map((b) => b.id)],
    );
    if (!booking) throw new Error("no seeded booking on the Saturday");
    const before = await offersNow();
    const logBefore = await sentLog();
    try {
      await su.query(
        `update assignments a set status = 'cancelled_worker', cancelled_at = now(),
                cancel_reason = 'Something came up',
                notice_hours = round(extract(epoch from (s.starts_at - now())) / 3600, 2)
           from shifts s where s.id = a.shift_id and a.id = $1`,
        [booking.id],
      );
      await su.query("update shifts set status = 'open' where id = $1", [booking.shift_id]);
      await run();
      expect(await offersNow()).toEqual(before);
      expect(await sentLog()).toEqual(logBefore);
    } finally {
      // Put the booking back for the tests after this one.
      await su.query(
        `update assignments set status = 'confirmed', cancelled_at = null, cancel_reason = null,
                notice_hours = null where id = $1`,
        [booking.id],
      );
      await su.query("update shifts set status = 'filled' where id = $1", [booking.shift_id]);
    }
  });

  // The same on a fixed day, so it fails on any day of the week if loading again can add an offer:
  // inside a transaction that is rolled back, so the database keeps only the real seed. On that
  // Sunday all of its Saturday's bookings were made that week and more than 12 could have said yes,
  // so planning from every stored booking would bring in the 13th once one is cancelled.
  it("on a fixed Sunday, loading the Saturday again after a said-yes booking is cancelled adds no offer and logs none", async () => {
    class Rollback extends Error {}
    const now = new Date("2026-01-04T12:00:00Z"); // Sunday 4 Jan 2026, 12:00 GMT
    const firm = seedFirms(now).find((f) => f.slug === "acme")!;
    const day = acmeSaturday(firm.workers, firm.sites, now);
    const cancelled = day.bookings.find((b) => b.workerId === seedId("acme/worker/5"));
    if (!cancelled) throw new Error("no booking for worker 5");
    const shiftIds = sql.join(
      day.shifts.map((s) => sql`${s.id}::uuid`),
      sql`, `,
    );
    const offersNow = async (tx: FirmTx) =>
      (
        await tx.execute<{
          id: string;
          worker_id: string;
          response: string | null;
          sent_at: string;
          responded_at: string | null;
          logged: number;
        }>(sql`
          select o.id::text, o.worker_id::text, o.response, o.sent_at::text,
                 o.responded_at::text,
                 (select count(*)::int from events e
                   where e.entity_id = o.id and e.action = 'offer.sent') as logged
            from offers o where o.shift_id in (${shiftIds}) order by o.id
        `)
      ).rows;
    const load = async (tx: FirmTx) =>
      loadWeekOffers(tx, firm, {
        saturday: day,
        fresh: await loadSaturday(tx, firm, day, now),
        now,
      });
    let first: Awaited<ReturnType<typeof offersNow>> = [];
    let again: Awaited<ReturnType<typeof offersNow>> = [];
    await expect(
      withFirm(ACME, async (tx) => {
        await load(tx);
        first = await offersNow(tx);
        // A demo: the casual cancels the booking they said yes to (six days before the start).
        await tx.execute(sql`
          update assignments set status = 'cancelled_worker', cancelled_at = ${now},
                 cancel_reason = 'Something came up', notice_hours = 144
           where id = ${cancelled.id}
        `);
        await tx.execute(sql`update shifts set status = 'open' where id = ${cancelled.shiftId}`);
        // The seed again: its Saturday is there already.
        await load(tx);
        again = await offersNow(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    // The first load: the 10 waiting and the 12 latest said yes, each logged once, the cancelled
    // booking's among them.
    expect(first.filter((o) => o.response === null)).toHaveLength(10);
    const yes = first.filter((o) => o.response === "accepted");
    expect(yes).toHaveLength(12);
    expect(yes.map((o) => o.worker_id)).toContain(cancelled.workerId);
    expect(first.filter((o) => o.logged !== 1)).toEqual([]);
    // The second adds none and logs none.
    expect(again).toEqual(first);
    // And none of it is left behind.
    const { rows: left } = await su.query("select id from shifts where id = any($1::uuid[])", [
      day.shifts.map((s) => s.id),
    ]);
    expect(left).toEqual([]);
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
