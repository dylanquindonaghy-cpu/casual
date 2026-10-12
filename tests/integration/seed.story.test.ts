import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { qualificationsFor } from "@/lib/credentials/qualifications";
import { noAi } from "@/lib/ai/client";
import { seed } from "@/lib/db/admin/seed";
import { acmePastEvent, acmePayQueries } from "@/lib/db/admin/seed-extras";
import { seedFirms, seedId, STRIKES_TEAM } from "@/lib/db/admin/seed-data";
import { acmeStory } from "@/lib/db/admin/seed-story";
import { createWithFirm, withFirm } from "@/lib/db/scoped";
import { runInboundMessage } from "@/lib/inbound/reply";
import type { MessagingTransport } from "@/lib/messaging/transport";
import { previewBooking } from "@/lib/roster/book";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { confirmedStrikesEmail } from "@/lib/strikes/team-email";
import { travelLineText } from "@/lib/travel/line-copy";
import { appRolePool, superuserPool, urls } from "../helpers/db";

// The demo's made-up story (src/lib/db/admin/seed-story.ts; docs/office-v2.md §9 "Demo seed";
// 12I.1), on the real database after `seed()`: each part the mock-up shows has its rows, read the
// way the app reads them, and a second run changes nothing.

const ACME = seedId("firm/acme");
const run = () => seed({ adminUrl: urls.admin, appUrl: urls.app, nodeEnv: "test" });
const acmeFirm = () => {
  const firm = seedFirms().find((f) => f.slug === "acme");
  if (!firm) throw new Error("no acme");
  return firm;
};
const STORY = acmeStory(acmeFirm(), new Date());
const who = (key: string) => {
  const w = STORY.workers.find((x) => x.key === key);
  if (!w) throw new Error(`no story worker ${key}`);
  return w.id;
};
const ctx = { firm: { id: ACME, timezone: "Europe/London", signOff: "Acme Events Shift Team" } };

let su: Pool;

// Every story row by table, and the story's log entries, to compare across runs.
async function storyRows() {
  const { rows } = await su.query<{ table: string; n: number; ids: string[] | null }>(
    `select 'shift_events' as table, count(*)::int as n, array_agg(id::text order by id) as ids
       from shift_events where firm_id = $1
     union all select 'strikes', count(*)::int, array_agg(id::text order by id) from strikes where firm_id = $1
     union all select 'messages', count(*)::int, array_agg(id::text order by id) from messages where firm_id = $1
     union all select 'uploads', count(*)::int, array_agg(id::text order by id) from uploads where firm_id = $1
     union all select 'worker_travel', count(*)::int, array_agg(worker_id::text order by worker_id) from worker_travel where firm_id = $1
     union all select 'travel_estimates', count(*)::int, null from travel_estimates where firm_id = $1
     union all select 'requests', count(*)::int, array_agg(id::text order by id) from requests where firm_id = $1
     union all select 'events', count(*)::int, null from events where firm_id = $1
       and action in ('strike.issued', 'strike.withdrawn', 'message.received', 'message.replied',
                      'enquiry.checks', 'pay_query.resolved', 'shift.marked_urgent')`,
    [ACME],
  );
  return rows;
}

beforeAll(async () => {
  su = superuserPool();
  await run();
});
afterAll(async () => {
  await su.end();
});

describe("the demo story", () => {
  it("running the seed again changes nothing in the story", async () => {
    const before = await storyRows();
    await run();
    expect(await storyRows()).toEqual(before);
  });

  it("Acme's strikes team is strikes@acme-events.example, already confirmed", async () => {
    const { rows } = await su.query<{ settings: Record<string, unknown> }>(
      "select settings from firms where id = $1",
      [ACME],
    );
    expect(confirmedStrikesEmail(rows[0]?.settings ?? {})).toBe(STRIKES_TEAM);
  });

  it("has the six events, Hillside Christmas Market switched off, every session with its pay, post, meeting point and uniform", async () => {
    const { rows: events } = await su.query<{ name: string; showing: boolean; site: string }>(
      `select e.name, e.showing_to_casuals as showing, si.name as site from shift_events e
         join sites si on si.id = e.site_id
        where e.firm_id = $1 and e.id = any($2::uuid[]) order by e.name`,
      [ACME, STORY.events.map((e) => e.id)],
    );
    expect(events).toEqual([
      { name: "Hillside Christmas Market", showing: false, site: "Hillside Demo Square" },
      { name: "Night patrols", showing: true, site: "Northgate Demo Town Centre" },
      { name: "Northern Lights Live", showing: true, site: "Acme Demo Arena" },
      { name: "Northgate Charity 10K", showing: true, site: "Northgate Demo Common" },
      { name: "Raceday", showing: true, site: "Acme Demo Racecourse" },
      { name: "Riverside Food Festival", showing: true, site: "Riverside Demo Park" },
    ]);
    const { rows: missing } = await su.query<{ n: number }>(
      `select count(*)::int as n from shifts where id = any($1::uuid[])
          and (pay_rate_pence is null or post is null or meeting_point is null or uniform is null)`,
      [STORY.sessions.map((x) => x.id)],
    );
    expect(missing).toEqual([{ n: 0 }]);
    // Northern Lights Live: the door supervisors urgent at 3 of 4, the steward, and the response
    // team lead needing first aid; the night patrols urgent at 3 of 4.
    const { rows: sessions } = await su.query<{
      role: string;
      headcount: number;
      booked: number;
      urgent: boolean;
      needs: string[];
    }>(
      `select s.role, s.headcount, s.is_urgent as urgent, s.required_credentials as needs,
              (select count(*)::int from assignments a where a.shift_id = s.id
                 and a.status = 'confirmed') as booked
         from shifts s join shift_events e on e.id = s.event_id
        where s.firm_id = $1 and e.name in ('Northern Lights Live', 'Night patrols')
          and s.starts_at < now() + interval '3 days'
        order by s.role`,
      [ACME],
    );
    expect(sessions).toEqual([
      { role: "csas_officer", headcount: 4, booked: 3, urgent: true, needs: [] },
      {
        role: "door_supervisor",
        headcount: 4,
        booked: 3,
        urgent: true,
        needs: ["MANUAL_HANDLING"],
      },
      { role: "response_team_lead", headcount: 1, booked: 0, urgent: false, needs: ["FIRST_AID"] },
      { role: "steward", headcount: 2, booked: 2, urgent: false, needs: [] },
    ]);
  });

  it("has the eight casuals with their qualifications, photos and travel areas, and at least 4 CSAS holders", async () => {
    const people = await withFirm(ACME, (tx) =>
      qualificationsFor(
        tx,
        STORY.workers.map((w) => w.id),
        { now: new Date(), timeZone: "Europe/London" },
      ),
    );
    const status = (key: string, type: string) =>
      people.get(who(key))?.qualifications.find((q) => q.type === type)?.status;
    expect(status("zoe", "SIA_DS")).toBe("valid");
    expect(status("zoe", "CSAS")).toBe("valid");
    expect(people.get(who("zoe"))?.photo.status).toBe("due_soon");
    expect(status("kieran", "SIA_DS")).toBe("expired");
    expect(people.get(who("ben"))?.photo.status).toBe("waiting");
    expect(status("leah", "SIA_DS")).toBe("expiring_soon");
    expect(people.get(who("leah"))?.photo.status).toBe("missing");
    // Leah's new licence is waiting for the office.
    expect(
      people.get(who("leah"))?.qualifications.find((q) => q.type === "SIA_DS")?.waiting,
    ).not.toBeNull();
    // Zoe's manual handling expires in 22 days (no role of hers needs it, so it's a record only).
    const { rows: mh } = await su.query<{ days: number }>(
      `select (expires_on - (now() at time zone 'Europe/London')::date)::int as days
         from credentials where worker_id = $1 and type = 'MANUAL_HANDLING'`,
      [who("zoe")],
    );
    expect(mh).toEqual([{ days: 22 }]);
    const { rows: csas } = await su.query<{ n: number }>(
      `select count(distinct worker_id)::int as n from credentials
        where firm_id = $1 and type = 'CSAS' and status = 'valid' and expires_on > now()`,
      [ACME],
    );
    expect(csas[0]?.n).toBeGreaterThanOrEqual(4);
    const { rows: areas } = await su.query<{ n: number }>(
      "select count(*)::int as n from worker_travel where worker_id = any($1::uuid[])",
      [STORY.workers.map((w) => w.id)],
    );
    expect(areas).toEqual([{ n: 8 }]);
  });

  it("Zoe's Home: the Arena and Northgate urgent, three to apply for, two further than she travels", async () => {
    const list = await openShiftsFor(ctx, who("zoe"));
    const ofStory = (id: string) => STORY.sessions.find((x) => x.id === id);
    // Urgent first, the nearest first: the story's Arena door supervisors (12 min) and Northgate's
    // night patrols (21 min). (She could take the walkthrough's Saturday dropout too: it has no
    // fixed travel time, so it comes after them.)
    const urgent = list.shifts.filter((s) => s.isUrgent);
    expect(urgent.slice(0, 2).map((s) => [s.role, s.site?.name, s.casualEvent])).toEqual([
      ["door_supervisor", "Acme Demo Arena", "Northern Lights Live"],
      ["csas_officer", "Northgate Demo Town Centre", "Night patrols"],
    ]);
    expect(travelLineText(urgent[0]!.travel, "Europe/London")).toBe(
      "3.1 miles · 12 min by car · 24 min by public transport",
    );
    expect(travelLineText(urgent[1]!.travel, "Europe/London")).toBe(
      "8.4 miles · 21 min by car · 38 min by public transport",
    );
    // Home's top 3 to apply for: the story's, nearest first.
    const apply = list.shifts.filter((s) => !s.isUrgent).slice(0, 3);
    expect(apply.every((s) => ofStory(s.shiftId))).toBe(true);
    expect(apply.map((s) => s.casualEvent)).toEqual([
      "Northern Lights Live",
      "Riverside Food Festival",
      "Night patrols",
    ]);
    // Raceday and the Charity 10K: further than she travels.
    expect(list.further).toEqual({ count: 2, atLeast: false });
    expect(list.shifts.map((s) => s.casualEvent)).not.toContain("Hillside Christmas Market");
  });

  it("none of the 60 generated workers (the walkthrough's) sees any of the story's open places", async () => {
    for (let i = 0; i < 60; i += 1) {
      const list = await openShiftsFor(ctx, seedId(`acme/worker/${i}`));
      const ids = new Set(list.shifts.map((s) => s.shiftId));
      expect(STORY.sessions.filter((x) => ids.has(x.id))).toEqual([]);
    }
  });

  it("the cancellations and strikes: Kieran's two, Priya's flagged, Mo's withdrawn, and the office's cancellation of Tom", async () => {
    const { rows } = await su.query<{
      worker: string;
      status: string;
      review: boolean;
      reasons: string[];
      withdrawn_reason: string | null;
      evidence: string | null;
      to: string | null;
      inside_90_days: boolean;
    }>(
      `select w.first_name as worker, s.status, s.review_needed as review, s.review_reasons as reasons,
              s.withdrawn_reason, s.evidence_email_status as evidence, s.evidence_email_to as to,
              s.issued_at > now() - interval '90 days' as inside_90_days
         from strikes s join workers w on w.id = s.worker_id
        where s.id = any($1::uuid[]) order by w.first_name, s.issued_at`,
      [STORY.strikes.map((x) => x.id)],
    );
    expect(rows.map((r) => [r.worker, r.status, r.review, r.reasons])).toEqual([
      ["Kieran", "live", false, []],
      ["Kieran", "live", false, []],
      ["Mo", "withdrawn", false, []],
      ["Priya", "live", true, ["unwell"]],
    ]);
    expect(rows.find((r) => r.worker === "Mo")?.withdrawn_reason).toMatch(/car broke down/);
    for (const r of rows) {
      expect([r.evidence, r.to, r.inside_90_days]).toEqual(["sent", STRIKES_TEAM, true]);
    }
    const { rows: office } = await su.query<{ via: string; reason: string; status: string }>(
      `select cancel_via as via, cancel_reason as reason, status from assignments
        where worker_id = $1 and status = 'cancelled_firm'`,
      [who("tom")],
    );
    expect(office).toEqual([
      { via: "office", reason: "Weather or safety", status: "cancelled_firm" },
    ]);
    // Each cancellation logged as the app logs it.
    const { rows: logged } = await su.query<{ by: string; strike: string }>(
      `select data ->> 'by' as by, data ->> 'strike' as strike from events
        where firm_id = $1 and action = 'shift.cancelled' and entity_id = any($2::uuid[])
        order by 1, 2`,
      [ACME, STORY.bookings.map((b) => b.id)],
    );
    expect(logged).toEqual([
      { by: "firm", strike: "by_firm" },
      { by: "worker", strike: "issued" },
      { by: "worker", strike: "issued" },
      { by: "worker", strike: "issued" },
      { by: "worker", strike: "issued" },
    ]);
  });

  it("the enquiries: Zoe's list, Ben's pay question and Kieran's cancel, queued for the shifts line's own job, which answers them", async () => {
    const ids = STORY.messages.map((x) => x.id);
    // Stored as the webhook stores them, each with its job queued (nothing answered by the seed).
    const { rows: queued } = await su.query<{ n: number }>(
      `select count(*)::int as n from pgboss.job
        where name = 'inbound-message' and data ->> 'messageId' = any($1::text[])`,
      [ids],
    );
    expect(queued).toEqual([{ n: 3 }]);
    // The job worker's part: the real job, with a sender that records instead of sending.
    const app = appRolePool(2);
    const sent: string[] = [];
    const transport: MessagingTransport = {
      name: "test",
      async send(m) {
        sent.push(m.body);
        return { providerMessageId: `test-${sent.length}` };
      },
    };
    try {
      for (const messageId of ids) {
        await runInboundMessage(
          { firmId: ACME, messageId, idempotencyKey: `inbound-message:${messageId}` },
          createWithFirm(app),
          { transport, ai: noAi, baseDomain: "localhost:3000" },
        );
      }
    } finally {
      await app.end();
    }
    const { rows } = await su.query<{
      who: string;
      intent: string;
      handled: string;
      reply: string;
    }>(
      `select w.first_name as who, m.intent, m.handled_as as handled, r.body as reply
         from messages m join workers w on w.id = m.worker_id
         join messages r on r.reply_to = m.id
        where m.id = any($1::uuid[]) order by w.first_name`,
      [ids],
    );
    expect(rows.map((r) => [r.who, r.intent, r.handled])).toEqual([
      ["Ben", "pay", "keyword"],
      ["Kieran", "cancel", "keyword"],
      ["Zoe", "shifts", "keyword"],
    ]);
    // Zoe's personal list names her shifts; every reply is the app's, signed by the firm.
    expect(rows.find((r) => r.who === "Zoe")?.reply).toContain("Acme Demo Arena");
    for (const r of rows) expect(r.reply).toContain("Acme Events Shift Team");
    const { rows: logged } = await su.query<{ action: string }>(
      `select distinct action from events
        where firm_id = $1 and action in ('message.received', 'message.replied', 'enquiry.checks')
          and (entity_id = any($2::uuid[]) or data ->> 'messageId' = any($3::text[]))
        order by action`,
      [ACME, ids, ids],
    );
    expect(logged.map((l) => l.action)).toEqual([
      "enquiry.checks",
      "message.received",
      "message.replied",
    ]);
  });

  it("pay: the two groups payroll has sorted, each with its note; the 10 open queries as they were", async () => {
    const { rows } = await su.query<{ key: string; n: number; note: string }>(
      `select group_key as key, count(*)::int as n, min(resolution_note) as note from pay_queries
        where firm_id = $1 and status = 'resolved' group by group_key order by group_key`,
      [ACME],
    );
    expect(rows.map((r) => r.n)).toEqual([2, 2]);
    expect(rows.every((r) => r.note.length > 0)).toBe(true);
    // The walkthrough's 10 for this run's day (another file's run for a later day adds its own).
    const firm = acmeFirm();
    const now = new Date();
    const today = acmePayQueries(
      firm.workers,
      acmePastEvent(firm.workers, firm.sites, now),
      now,
    ).map((q) => q.id);
    const { rows: open } = await su.query<{ n: number }>(
      "select count(*)::int as n from pay_queries where id = any($1::uuid[]) and status = 'open'",
      [today],
    );
    expect(open).toEqual([{ n: 10 }]);
  });

  it("uploads waiting for the office: Ben's photo and Leah's new licence", async () => {
    const { rows } = await su.query<{ who: string; kind: string }>(
      `select w.first_name as who, u.kind from uploads u join workers w on w.id = u.worker_id
        where u.firm_id = $1 and u.status = 'waiting' order by w.first_name`,
      [ACME],
    );
    expect(rows).toEqual([
      { who: "Ben", kind: "photo" },
      { who: "Leah", kind: "certificate" },
    ]);
  });
  it("every story booking is one the rules allowed when it was made", async () => {
    for (const b of STORY.bookings) {
      const verdict = await withFirm(ACME, (tx) =>
        previewBooking(tx, { shiftId: b.shiftId, workerId: b.workerId, now: b.confirmedAt }),
      );
      expect({ booking: b.id, reasons: verdict?.reasons }).toEqual({ booking: b.id, reasons: [] });
    }
  });

  it("urgent as the app marks it: the office's two, and the system's after each dropout inside the window", async () => {
    const { rows } = await su.query<{ actor: string; cause: string; n: number }>(
      `select actor_type as actor, data ->> 'cause' as cause, count(*)::int as n from events
        where firm_id = $1 and action = 'shift.marked_urgent' and entity_id = any($2::uuid[])
        group by 1, 2 order by 1, 2`,
      [ACME, STORY.sessions.map((x) => x.id)],
    );
    expect(rows).toEqual([
      { actor: "office", cause: "office", n: 2 },
      { actor: "system", cause: "dropout", n: 3 },
    ]);
  });

  it("no casual's own words reach the log: cancel reasons, the review reason and the withdrawal reason stay on their rows", async () => {
    const { rows } = await su.query<{ n: number }>(
      `select count(*)::int as n from events
        where firm_id = $1 and (data::text ilike '%unwell%' or data::text ilike '%overslept%'
          or data::text ilike '%broke down%' or data::text ilike '%travel problem%')`,
      [ACME],
    );
    expect(rows).toEqual([{ n: 0 }]);
  });
});
