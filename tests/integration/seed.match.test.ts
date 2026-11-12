import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientEvents } from "@/lib/client/reads";
import { officeClientRequests } from "@/lib/client/queue";
import { urgentWhy } from "@/lib/client/urgency";
import { seed } from "@/lib/db/admin/seed";
import { seedFirms, seedId } from "@/lib/db/admin/seed-data";
import {
  acmeMatchDay,
  CHAPTER_8,
  INDUCTION,
  MATCH_CLIENT_CONTACT_ID,
  MATCH_CONTRACT_ID,
  MATCH_NAME,
  MATCH_SITE_ID,
  NEXT_MATCH_NAME,
  PREVIOUS_MATCH_NAME,
} from "@/lib/db/admin/seed-match";
import { acmeStory } from "@/lib/db/admin/seed-story";
import { withFirm } from "@/lib/db/scoped";
import { isMadeUpEmail, isMadeUpMobile } from "@/lib/demo/made-up";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { previewBooking, previewBookings } from "@/lib/roster/book";
import { pairKey } from "@/lib/roster/eligibility-input";
import { localDateOf, wallTimeOf } from "@/lib/time/zoned";
import { superuserPool, urls } from "../helpers/db";

// The match day to play with (Phase 36.5; src/lib/db/admin/seed-match.ts), on the real database
// after `seed()`: each post's places and bookings, kick-off, the cancellations and strikes, the
// offers, the pay query, the client contract, its login and requests, read the way the app reads
// them; made-up data only (golden rule 7); a second run changes nothing.

const ACME = seedId("firm/acme");
const TZ = "Europe/London";
const run = () => seed({ adminUrl: urls.admin, appUrl: urls.app, nodeEnv: "test" });
const acme = () => seedFirms().find((f) => f.slug === "acme")!;
// Its ids are fixed and undated: the builder's ids are the stored ones whenever it's built.
const MATCH = acmeMatchDay(acme(), new Date());
const SESSIONS = MATCH.sessions.map((s) => s.id);
const ctx = { firm: { id: ACME, timezone: TZ, signOff: "Acme Events Shift Team" } };

let su: Pool;

beforeAll(async () => {
  su = superuserPool();
  await run();
});
afterAll(async () => {
  await su.end();
});

// Every match row by table, and its log entries, to compare across runs.
async function matchRows() {
  const { rows } = await su.query(
    `select 'shifts' as t, array_agg(id::text order by id) as ids from shifts where id = any($1::uuid[])
     union all select 'assignments', array_agg(id::text order by id) from assignments where shift_id = any($1::uuid[])
     union all select 'offers', array_agg(id::text order by id) from offers where shift_id = any($1::uuid[])
     union all select 'strikes', array_agg(id::text order by id) from strikes where shift_id = any($1::uuid[])
     union all select 'pay_queries', array_agg(id::text order by id) from pay_queries where shift_id = any($1::uuid[])
     union all select 'client_requests', array_agg(id::text order by id) from client_requests where contract_id = $2
     union all select 'client_contacts', array_agg(id::text order by id) from client_contacts where contract_id = $2
     union all select 'events', array_agg(id::text order by id) from events where firm_id = $3
       and (entity_id = any($1::uuid[]) or data ->> 'shiftId' = any($4::text[])
            or data ->> 'contractId' = $5::text)`,
    [SESSIONS, MATCH_CONTRACT_ID, ACME, SESSIONS, MATCH_CONTRACT_ID],
  );
  return rows;
}

describe("the match day", () => {
  it("running the seed again changes nothing in it", async () => {
    const before = await matchRows();
    await run();
    expect(await matchRows()).toEqual(before);
  });

  it("is Demo Rovers v Visitors FC at Demo Stadium, kick-off 16:30 on a Saturday still to come, showing to casuals", async () => {
    const { rows } = await su.query<{
      name: string;
      showing: boolean;
      site: string;
      address: string;
      postcode: string;
      lat: string | null;
      contract: string;
    }>(
      `select e.name, e.showing_to_casuals as showing, si.name as site, si.address_line1 as address,
              si.postcode, si.lat::text as lat, k.name as contract
         from shift_events e join sites si on si.id = e.site_id
         join clients k on k.id = si.client_id
        where e.firm_id = $1 and si.id = $2 order by e.name desc`,
      [ACME, MATCH_SITE_ID],
    );
    expect(rows.map((r) => [r.name, r.showing, r.site, r.address, r.postcode, r.contract])).toEqual(
      [
        [MATCH_NAME, true, "Demo Stadium", "1 Demo Road", "ZZ1 9SR", "Demo Stadium Ltd"],
        [PREVIOUS_MATCH_NAME, true, "Demo Stadium", "1 Demo Road", "ZZ1 9SR", "Demo Stadium Ltd"],
      ],
    );
    // On the map: a made-up point near the Arena's.
    expect(rows[0]?.lat).not.toBeNull();
    // Kick-off is 4 hours after North Gate's SIA stewards start, on a Saturday still ahead.
    const { rows: gate } = await su.query<{ starts_at: Date; ends_at: Date }>(
      "select starts_at, ends_at from shifts where id = $1",
      [seedId("acme/match/session/this/north-gate-sia")],
    );
    const kickOff = new Date(gate[0]!.starts_at.getTime() + 4 * 3_600_000);
    const w = wallTimeOf(kickOff, TZ);
    expect([w.hour, w.minute]).toEqual([16, 30]);
    expect(new Date(`${localDateOf(kickOff, TZ)}T12:00:00Z`).getUTCDay()).toBe(6);
    expect(kickOff.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("has each post's places and bookings as the sheet: 83 places, 69 booked, North Gate 3 short and urgent", async () => {
    const { rows } = await su.query<{
      post: string;
      role: string;
      places: number;
      booked: number;
      status: string;
      urgent: boolean;
      needs: string[];
      instructions: string | null;
    }>(
      `select s.post, s.role, s.headcount as places, s.status, s.is_urgent as urgent,
              s.required_credentials as needs, s.instructions,
              (select count(*)::int from assignments a where a.shift_id = s.id
                 and a.status = 'confirmed') as booked
         from shifts s join shift_events e on e.id = s.event_id
        where s.firm_id = $1 and e.name = $2 order by s.post, s.role`,
      [ACME, MATCH_NAME],
    );
    const by = (post: string, role: string) => rows.find((r) => r.post === post && r.role === role);
    expect(rows).toHaveLength(18);
    expect(new Set(rows.map((r) => r.post)).size).toBe(14);
    expect(rows.reduce((n, r) => n + r.places, 0)).toBe(83);
    expect(rows.reduce((n, r) => n + r.booked, 0)).toBe(69);
    expect(by("North Gate", "door_supervisor")).toMatchObject({
      places: 13,
      booked: 10,
      status: "open",
      urgent: true,
    });
    expect(by("Car park North", "steward")).toMatchObject({ places: 8, booked: 4 });
    expect(by("Estate patrol", "csas_officer")).toMatchObject({ places: 3, booked: 2 });
    expect(by("South Bridge", "door_supervisor")).toMatchObject({
      places: 11,
      booked: 11,
      status: "filled",
    });
    expect(by("Station queue (Demo Park station)", "steward")).toMatchObject({
      places: 5,
      booked: 4,
    });
    for (const r of rows) {
      expect(r.needs[0]).toBe(INDUCTION);
      expect(r.needs.includes(CHAPTER_8)).toBe(r.post.startsWith("Car park"));
      expect(r.instructions?.length ?? 0).toBeGreaterThan(0);
      expect(r.status).toBe(r.booked >= r.places ? "filled" : "open");
    }
  });

  it("its qualification types and the supervisor's rule are the firm's own data (golden rule 6)", async () => {
    const { rows } = await su.query<{ code: string; name: string }>(
      "select code, name from credential_types where firm_id = $1 and code = any($2) order by code",
      [ACME, [INDUCTION, CHAPTER_8]],
    );
    expect(rows).toEqual([
      { code: CHAPTER_8, name: "Chapter 8 traffic management certificate" },
      { code: INDUCTION, name: "Demo Stadium ground induction" },
    ]);
    const { rows: rule } = await su.query<{ required_types: string[] }>(
      "select required_types from credential_rules where firm_id = $1 and role = 'supervisor'",
      [ACME],
    );
    expect(rule).toEqual([{ required_types: ["SIA_DS", "STEWARD_L2"] }]);
  });

  it("every booking is one the rules allowed when it was made", async () => {
    for (const b of MATCH.bookings) {
      const verdict = await withFirm(ACME, (tx) =>
        previewBooking(tx, { shiftId: b.shiftId, workerId: b.workerId, now: b.confirmedAt }),
      );
      expect({ booking: b.id, reasons: verdict?.reasons }).toEqual({ booking: b.id, reasons: [] });
    }
  });

  it("the cancellations: a casual's on the South Ramp (the rules' strike decision), the office's with its reason, and the previous match's late one, a strike", async () => {
    const { rows } = await su.query<{
      post: string;
      match: string;
      status: string;
      asked: string;
      via: string;
      reason: string;
      notice: string;
      strike: string;
      reopened: number;
    }>(
      `select s.post, e.name as match, a.status, a.cancel_asked_by as asked, a.cancel_via as via,
              a.cancel_reason as reason, a.notice_hours::text as notice,
              (select l.data ->> 'strike' from events l where l.entity_id = a.id
                  and l.action = 'shift.cancelled') as strike,
              (select count(*)::int from assignments o where o.shift_id = a.shift_id
                  and o.slot = a.slot and o.status = 'open') as reopened
         from assignments a join shifts s on s.id = a.shift_id
         join shift_events e on e.id = s.event_id
        where a.shift_id = any($1::uuid[]) and a.status in ('cancelled_worker', 'cancelled_firm')
        order by a.cancelled_at`,
      [SESSIONS],
    );
    expect(rows).toHaveLength(3);
    const [late, firm, casual] = [
      rows.find((r) => r.match === PREVIOUS_MATCH_NAME)!,
      rows.find((r) => r.status === "cancelled_firm")!,
      rows.find((r) => r.match === MATCH_NAME && r.status === "cancelled_worker")!,
    ];
    expect(late).toMatchObject({
      post: "North Gate",
      asked: "casual",
      via: "app",
      notice: "5.00",
      strike: "issued",
      reopened: 1,
    });
    expect(firm).toMatchObject({
      post: "Station queue (Demo Park station)",
      asked: "firm",
      via: "office",
      reason: "They've left, or can't work here",
      strike: "by_firm",
      reopened: 1,
    });
    // The rules decide: a strike under the firm's 48 hours' notice, none at or over it.
    expect(casual).toMatchObject({ post: "South Ramp", asked: "casual", via: "app", reopened: 1 });
    expect(casual.strike).toBe(Number(casual.notice) < 48 ? "issued" : "enough_notice");
    const { rows: strikes } = await su.query<{ n: number }>(
      "select count(*)::int as n from strikes where shift_id = any($1::uuid[]) and status = 'live'",
      [SESSIONS],
    );
    expect(strikes[0]?.n).toBe(Number(casual.notice) < 48 ? 2 : 1);
    // The office's cancellation: she was told (golden rule 12), logged with ids only.
    const { rows: told } = await su.query<{ n: number }>(
      `select count(*)::int as n from events where firm_id = $1
          and action = 'shift.change_notice_sent' and entity_id = $2`,
      [ACME, seedId("acme/match/booking/this/station-park/5")],
    );
    expect(told[0]?.n).toBe(1);
  });

  it("the previous match's pay query is still open, and nobody is left to mark there", async () => {
    const { rows } = await su.query<{ status: string; issue: string; post: string }>(
      `select q.status, q.issue_type as issue, s.post from pay_queries q
         join shifts s on s.id = q.shift_id where q.id = $1`,
      [MATCH.payQuery.id],
    );
    expect(rows).toEqual([{ status: "open", issue: "missing_hours", post: "Car park North" }]);
    const { rows: unmarked } = await su.query<{ n: number }>(
      `select count(*)::int as n from assignments a join shifts s on s.id = a.shift_id
        where a.shift_id = any($1::uuid[]) and a.status = 'confirmed' and s.ends_at < now()`,
      [SESSIONS],
    );
    expect(unmarked[0]?.n).toBe(0);
  });

  it("offers: two waiting on North Gate (when this week has had a minute outside quiet hours), each to a casual the rules allow; nothing sent", async () => {
    const { rows } = await su.query<{
      id: string;
      shift_id: string;
      worker_id: string;
      response: string | null;
      offered_by: string;
      logged: number;
    }>(
      `select o.id::text, o.shift_id::text, o.worker_id::text, o.response, o.offered_by::text,
              (select count(*)::int from events e where e.entity_id = o.id
                 and e.action = 'offer.sent') as logged
         from offers o where o.shift_id = any($1::uuid[])`,
      [SESSIONS],
    );
    expect(rows).toHaveLength(MATCH.offers.length);
    const gate = MATCH.sessions.find((s) => s.key === "north-gate-sia" && s.match === "this")!;
    for (const o of rows) {
      expect(o).toMatchObject({
        shift_id: gate.id,
        response: null,
        offered_by: seedId("acme/office/admin"),
        logged: 1,
      });
    }
    if (rows.length > 0 && gate.startsAt.getTime() > Date.now()) {
      const verdicts = await withFirm(ACME, (tx) =>
        previewBookings(tx, {
          shiftIds: [gate.id],
          workerIds: rows.map((o) => o.worker_id),
          now: new Date(),
        }),
      );
      for (const o of rows)
        expect(verdicts.get(pairKey(gate.id, o.worker_id))?.reasons).toEqual([]);
    }
    const workers = rows.map((o) => o.worker_id);
    const { rows: messages } = await su.query(
      "select id from messages where firm_id = $1 and worker_id = any($2::uuid[])",
      [ACME, workers],
    );
    expect(messages).toEqual([]);
    const { rows: jobs } = await su.query(
      `select j.name from pgboss.job j where j.data ->> 'firmId' = $1
          and exists (select 1 from unnest($2::text[]) as x(id) where j.data::text like '%' || x.id || '%')`,
      [ACME, [...rows.map((o) => o.id), ...workers, ...MATCH.requests.map((r) => r.id)]],
    );
    expect(jobs).toEqual([]);
  });

  it("only its own casuals see its open places: none of the walkthrough's 60 or the story's 8, and a free squad member does", async () => {
    const story = acmeStory(acme(), new Date());
    const others = [
      ...Array.from({ length: 60 }, (_, i) => seedId(`acme/worker/${i}`)),
      ...story.workers.map((w) => w.id),
    ];
    const ours = new Set(SESSIONS);
    for (const id of others) {
      const list = await openShiftsFor(ctx, id);
      expect(list.shifts.filter((s) => ours.has(s.shiftId))).toEqual([]);
    }
    const gate = MATCH.sessions.find((s) => s.key === "north-gate-sia" && s.match === "this")!;
    if (gate.startsAt.getTime() > Date.now()) {
      const offered = MATCH.workers.find((w) => w.kind === "sia" && w.index === 25)!;
      const list = await openShiftsFor(ctx, offered.id);
      expect(list.shifts.map((s) => s.shiftId)).toContain(gate.id);
    }
  });

  it("the client: Demo Stadium Ltd's login sees the match in numbers, never a casual", async () => {
    const events = await clientEvents({
      firm: { id: ACME },
      clientContactId: MATCH_CLIENT_CONTACT_ID,
    });
    const match = events?.find((e) => e.name === MATCH_NAME);
    expect(match).toMatchObject({ site: "Demo Stadium", places: 83, booked: 69, toFill: 14 });
    expect(match?.sessions).toHaveLength(18);
    const text = JSON.stringify(events);
    for (const w of MATCH.workers.slice(0, 20)) {
      expect(text).not.toContain(w.lastName);
      expect(text).not.toContain(w.id);
    }
  });

  it("its requests: two waiting (4 more SIA stewards at North Gate, a new event two weeks on), one accepted and one declined, each logged", async () => {
    const queue = async (tab: "waiting" | "accepted" | "declined") =>
      officeClientRequests(
        { firm: { id: ACME }, officeUserId: seedId("acme/office/resourcer") },
        { tab, scope: "all", contractId: MATCH_CONTRACT_ID },
      );
    const waiting = await queue("waiting");
    expect(waiting?.requests.map((r) => r.kind).sort()).toEqual(["more_places", "new_event"]);
    expect((await queue("accepted"))?.requests.map((r) => r.kind)).toEqual(["more_places"]);
    expect((await queue("declined"))?.requests.map((r) => r.kind)).toEqual(["other"]);
    const { rows } = await su.query<{
      id: string;
      kind: string;
      status: string;
      urgent: boolean;
      payload: Record<string, unknown>;
      created_at: Date;
      answer: string | null;
      logged: string[];
    }>(
      `select r.id::text, r.kind, r.status, r.urgent, r.payload, r.created_at,
              r.office_answer as answer,
              array(select l.action from events l where l.entity_id = r.id order by l.id) as logged
         from client_requests r where r.contract_id = $1 order by r.created_at`,
      [MATCH_CONTRACT_ID],
    );
    expect(rows).toHaveLength(4);
    const more = rows.find((r) => r.id === seedId("acme/match/request/north-gate-more"))!;
    expect(more).toMatchObject({ kind: "more_places", status: "waiting", payload: { places: 4 } });
    // Urgent as the rules said when it was sent: within 48 hours of the session's start.
    const gate = MATCH.sessions.find((s) => s.key === "north-gate-sia" && s.match === "this")!;
    expect(more.urgent).toBe(
      urgentWhy({
        kind: "more_places",
        now: more.created_at,
        startsAt: gate.startsAt,
        booked: 10,
        free: 3,
        places: 4,
      }) !== null,
    );
    const next = rows.find((r) => r.kind === "new_event")!;
    expect(next).toMatchObject({ status: "waiting", urgent: false });
    expect(next.payload).toMatchObject({ name: NEXT_MATCH_NAME, venue: { siteId: MATCH_SITE_ID } });
    expect(rows.find((r) => r.status === "declined")?.answer).toMatch(/programmes/);
    for (const r of rows) {
      expect(r.logged[0]).toBe("client_request.created");
      if (r.status !== "waiting") expect(r.logged[1]).toBe(`client_request.${r.status}`);
    }
  });

  it("is made up: every number and email of its people, its client's included, and its venue's postcode a ZZ one", async () => {
    const { rows: people } = await su.query<{ mobile: string; email: string | null }>(
      "select mobile_e164 as mobile, email from workers where id = any($1::uuid[])",
      [MATCH.workers.map((w) => w.id)],
    );
    expect(people).toHaveLength(75);
    for (const p of people) {
      expect(isMadeUpMobile(p.mobile), p.mobile).toBe(true);
      if (p.email) expect(isMadeUpEmail(p.email), p.email).toBe(true);
    }
    const { rows: contacts } = await su.query<{ email: string }>(
      "select email from client_contacts where contract_id = $1",
      [MATCH_CONTRACT_ID],
    );
    expect(contacts).toEqual([{ email: "hannah.price@demo-stadium.example" }]);
    for (const c of contacts) expect(isMadeUpEmail(c.email), c.email).toBe(true);
    // Its venue, and every site of its contract (the new event's request names the same one).
    const { rows: sites } = await su.query<{ postcode: string | null }>(
      "select postcode from sites where id = $1 or client_id = $2",
      [MATCH_SITE_ID, MATCH_CONTRACT_ID],
    );
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) expect(s.postcode ?? "").toMatch(/^ZZ\d{1,2} \d[A-Z]{2}$/);
  });
});
