import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noAi } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { passesLogCheck } from "@/lib/events/record";
import {
  cancelReply,
  shiftsReply,
  AUTOMATIC,
  type EnquiryChecks,
} from "@/lib/inbound/personal-reply";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import { receiveSms, receiveWhatsApp } from "@/lib/inbound/receive";
import { runInboundMessage } from "@/lib/inbound/reply";
import { ChannelRefusedError, type MessagingTransport } from "@/lib/messaging/transport";
import { loadEnquiry } from "@/lib/office/enquiries";
import { saveMyTravel } from "@/lib/portal/travel";
import { fakeGeocoder, fakePoint } from "@/lib/travel/geocoder";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The shifts line's personal replies (docs/office-v2.md 3.6, 5.7; 12D.2) on the real database as
// the app role: the shifts reply lists exactly what the casual app's Open shifts would (the rules,
// the showing switches, her travel area), and every session she's considered for but not offered
// says why; each line's fields; CSAS only to holders; the cancel reply; and, through the shifts
// line's job, the reply sent and `enquiry.checks` logged for the office's Enquiries page. NOW is
// Monday 2 November 2026, 09:00 London (GMT). Numbers: 07700 900200-900399 for the lines here.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const clock = { now: () => NOW };
const HOME = "ZZ2 2BB";
const PORTAL = "http://shiftdesk.test";
const voice = (name: string) => ({ name, signOff: `${name} Shift Team` });

let nextLine = Math.floor(Math.random() * 200);
async function freshLine(): Promise<string> {
  nextLine = (nextLine + 1) % 200;
  const line = `+447700900${200 + nextLine}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  return line;
}

// Travel areas on (13.4: a firm's are off until its owner switches them on).
async function replyFirm() {
  const f = await bookingFirm(su, withFirm, { settings: { travel: { enabled: true } } });
  const { rows: firmRows } = await su.query<{ name: string }>(
    "select name from firms where id = $1",
    [f.firmId],
  );
  const firmName = firmRows[0]?.name ?? "";
  const site = async (name: string) => {
    const p = fakePoint("ZZ1 1AA");
    const { rows } = await su.query<{ id: string }>(
      `insert into sites (firm_id, name, postcode, lat, lng) values ($1, $2, 'ZZ1 1AA', $3, $4)
       returning id::text as id`,
      [f.firmId, name, p?.lat, p?.lng],
    );
    return rows[0]?.id ?? "";
  };
  const arena = await site("Acme Test Arena");
  // Zoe: door supervisor, steward and CSAS officer, with her travel area (car, 45 minutes).
  const casual = async (o: { first?: string; csas?: boolean } = {}) => {
    const id = await f.worker({
      first: o.first ?? "Zoe",
      roles: ["door_supervisor", "steward", "csas_officer"],
    });
    if (o.csas) {
      await su.query(
        "insert into credentials (firm_id, worker_id, type, status, expires_on) values ($1, $2, 'CSAS', 'valid', '2028-06-09')",
        [f.firmId, id],
      );
    }
    const saved = await saveMyTravel(
      { firm: { id: f.firmId }, run: withFirm, clock, geocoder: fakeGeocoder },
      id,
      { postcode: HOME, modes: "car", maxMinutes: 45 },
    );
    expect(saved).toEqual({ status: "saved" });
    return id;
  };
  // A session `h` hours from now, at the arena unless said.
  const session = async (
    h: number,
    o: {
      role?: string;
      hours?: number;
      siteId?: string;
      extra?: string[];
      showing?: boolean;
      eventId?: string;
      pay?: number;
      post?: string;
    } = {},
  ) => {
    const id = await f.shift({
      startsAt: hoursFromNow(h),
      role: o.role,
      hours: o.hours,
      eventId: o.eventId,
    });
    await su.query(
      `update shifts set site_id = $2, required_credentials = $3, showing_to_casuals = $4,
              pay_rate_pence = $5, post = $6
        where id = $1`,
      [id, o.siteId ?? arena, o.extra ?? [], o.showing ?? true, o.pay ?? null, o.post ?? null],
    );
    return id;
  };
  // Both ways, as the travel job saves them: by car in `minutes`, and no public transport in time.
  const estimate = async (shiftId: string, minutes: number) => {
    await su.query(
      `insert into travel_estimates (firm_id, origin_postcode, site_id, mode, arrive_by, minutes,
                                     metres, provider, computed_at, expires_at)
       select s.firm_id, $2, s.site_id, m.mode, s.starts_at - interval '30 minutes',
              case when m.mode = 'car' then $3::int end,
              case when m.mode = 'car' then $3::int * 400 end,
              'fake', now(), s.ends_at + interval '7 days'
         from shifts s cross join (values ('car'), ('public_transport')) as m(mode)
        where s.id = $1`,
      [shiftId, HOME, minutes],
    );
  };
  const credential = (workerId: string, type: string, expiresOn: string | null) =>
    su.query(
      "insert into credentials (firm_id, worker_id, type, status, expires_on) values ($1, $2, $3, 'valid', $4)",
      [f.firmId, workerId, type, expiresOn],
    );
  // Her booking, as she'd have made it (the booking code logs who did: "worker").
  const booked = async (
    workerId: string,
    h: number,
    hours = 8,
    by: "worker" | "firm" = "worker",
  ) => {
    const shiftId = await f.shift({ startsAt: hoursFromNow(h), hours });
    await su.query("update shifts set site_id = $2 where id = $1", [shiftId, arena]);
    const assignmentId = await f.booking(workerId, shiftId, "confirmed");
    await su.query(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data)
       values ($1, 'worker', $2, 'shift.assigned', 'assignment', $3, $4)`,
      [f.firmId, workerId, assignmentId, JSON.stringify({ by, shiftId, workerId })],
    );
    return { shiftId, assignmentId };
  };
  const reply = (workerId: string, text: string | null = "any shifts?") =>
    shiftsReply(withFirm, {
      firmId: f.firmId,
      workerId,
      text,
      now: NOW,
      firm: voice(firmName),
      portal: PORTAL,
    });
  return { f, firmName, site, arena, casual, session, estimate, credential, booked, reply };
}

const reasonsOf = (checks: EnquiryChecks, shiftId: string) =>
  checks.notOffered.find((n) => n.shiftId === shiftId)?.reasons.map((r) => r.code);

describe("the shifts reply lists exactly what she could take", () => {
  it("only eligible, showing sessions inside her area; every other one says why", async () => {
    const t = await replyFirm();
    const zoe = await t.casual();
    const ok = await t.session(48, { pay: 1550, post: "Gate A" }); // Wed 4 Nov 09:00
    await t.estimate(ok, 20);
    // A qualification the session needs that she hasn't got; one out of date; one that runs out
    // during the session (a night shift into Sunday).
    const missing = await t.session(72, { extra: ["FIRST_AID"] });
    await t.credential(zoe, "MANUAL_HANDLING", "2026-11-01");
    const expired = await t.session(96, { extra: ["MANUAL_HANDLING"] });
    await t.credential(zoe, "CSAS", "2026-11-07");
    const midSession = await t.session(133, { role: "csas_officer" }); // Sat 22:00 to Sun 06:00
    // A clash with a booking; under the rest gap after another; over the weekly hours.
    await t.booked(zoe, 168); // Mon 9 Nov 09:00-17:00
    const clash = await t.session(170);
    await t.booked(zoe, 192); // Tue 10 Nov 09:00-17:00
    const rest = await t.session(206); // Tue 23:00: 6 hours after
    for (const [h, hours] of [
      [335, 10],
      [359, 10],
      [383, 10],
      [407, 11],
    ] as const) {
      await t.booked(zoe, h, hours); // 41 hours, Mon 16 to Thu 19 Nov
    }
    const weekly = await t.session(456); // Sat 21 Nov: 49 hours
    // A day off; a site she's blocked from; a hidden session; a hidden event; outside her area.
    const dayOff = await t.session(552); // Wed 25 Nov
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-25')",
      [t.f.firmId, zoe],
    );
    const elsewhere = await t.site("Blocked Hall");
    const blocked = await t.session(576, { siteId: elsewhere });
    await su.query(
      "insert into worker_site_blocks (firm_id, worker_id, site_id, reason) values ($1, $2, $3, 'client_asked')",
      [t.f.firmId, zoe, elsewhere],
    );
    const hiddenSession = await t.session(600, { showing: false });
    const hiddenEvent = await t.session(624, { eventId: await t.f.event({ showing: false }) });
    const far = await t.session(648);
    await t.estimate(far, 80);

    const r = await t.reply(zoe);
    expect(r.checks.whatsapp.offered.map((o) => o.shiftId)).toEqual([ok]);
    expect(reasonsOf(r.checks.whatsapp, missing)).toEqual(["credential_missing"]);
    expect(r.checks.whatsapp.notOffered.find((n) => n.shiftId === missing)?.reasons).toEqual([
      { code: "credential_missing", type: "FIRST_AID" },
    ]);
    expect(reasonsOf(r.checks.whatsapp, expired)).toEqual(["credential_expired"]);
    expect(reasonsOf(r.checks.whatsapp, midSession)).toEqual(["credential_expired"]);
    expect(reasonsOf(r.checks.whatsapp, clash)).toEqual(["overlap"]);
    expect(r.checks.whatsapp.notOffered.find((n) => n.shiftId === clash)?.reasons[0]).toMatchObject(
      {
        from: hoursFromNow(168).toISOString(),
        to: hoursFromNow(176).toISOString(),
      },
    );
    expect(reasonsOf(r.checks.whatsapp, rest)).toEqual(["rest"]);
    expect(reasonsOf(r.checks.whatsapp, weekly)).toEqual(["weekly_hours"]);
    expect(reasonsOf(r.checks.whatsapp, dayOff)).toEqual(["unavailable"]);
    expect(reasonsOf(r.checks.whatsapp, blocked)).toEqual(["blocked_site"]);
    expect(reasonsOf(r.checks.whatsapp, hiddenSession)).toEqual(["hidden"]);
    expect(reasonsOf(r.checks.whatsapp, hiddenEvent)).toEqual(["hidden"]);
    expect(reasonsOf(r.checks.whatsapp, far)).toEqual(["outside_area"]);
    expect(r.checks.whatsapp.notOfferedMore).toBe(0);

    // The listed one's line: role · event, site · date and times · £/h · post, then travel.
    expect(r.whatsapp).toContain(
      "1. Door supervisor · Fixture event, Acme Test Arena · Wed 4 Nov 09:00–17:00 · £15.50/h · Gate A\n   ",
    );
    expect(r.whatsapp).toMatch(
      /\n {3}\d+\.\d miles · 20 min by car · no public transport by 08:30\n/,
    );
    expect(r.whatsapp).not.toContain("ZZ"); // never a postcode
    expect(r.whatsapp).toContain(`Take one here: ${PORTAL}/shifts/open\n${AUTOMATIC}`);
    // Every check the rules ran for it, with the travel minutes.
    expect(r.checks.whatsapp.offered[0]).toMatchObject({ car: 20, publicTransport: null });
    expect(r.checks.whatsapp.offered[0]?.checks.map((c) => c.code)).toEqual([
      "started",
      "active",
      "role",
      "qualification",
      "overlap",
      "rest",
      "weekly_hours",
      "days_off",
      "site",
    ]);
    expect(passesLogCheck({ ...r.checks.whatsapp })).toBe(true);
    expect(passesLogCheck({ ...r.checks.sms })).toBe(true);
  });

  it("CSAS sessions only to holders; a holder's line says so", async () => {
    const t = await replyFirm();
    const holder = await t.casual({ first: "Hana", csas: true });
    const other = await t.casual({ first: "Noor" });
    const patrol = await t.session(30, { role: "csas_officer", post: "town centre patrol" });
    const forHolder = await t.reply(holder);
    expect(forHolder.checks.whatsapp.offered.map((o) => o.shiftId)).toEqual([patrol]);
    expect(forHolder.whatsapp).toContain("CSAS officer · Fixture event, Acme Test Arena");
    expect(forHolder.whatsapp).toContain("town centre patrol · you hold CSAS");
    const forOther = await t.reply(other);
    expect(forOther.checks.whatsapp.offered).toEqual([]);
    expect(forOther.checks.whatsapp.notOffered.find((n) => n.shiftId === patrol)?.reasons).toEqual([
      { code: "credential_missing", type: "CSAS" },
    ]);
    expect(forOther.whatsapp).toMatch(/^Hi Noor, there's nothing you can take within 45 minutes/);
  });

  it("the days she names: only those days, with her booking that day", async () => {
    const t = await replyFirm();
    const zoe = await t.casual();
    const saturday = await t.session(121); // Sat 7 Nov 10:00
    await t.session(48); // Wed: not asked about
    await t.booked(zoe, 145); // Sun 8 Nov 10:00-18:00
    const r = await t.reply(zoe, "anything this weekend?");
    expect(r.checks.whatsapp.days).toEqual(["2026-11-07", "2026-11-08"]);
    expect(r.checks.whatsapp.offered.map((o) => o.shiftId)).toEqual([saturday]);
    expect(r.whatsapp.split("\n")[0]).toBe(
      "Hi Zoe, you're booked on Sun 8 Nov (Door supervisor · Fixture event · 10:00–18:00). For the weekend you can take:",
    );
  });

  it("an automatic event isn't named (it only repeats the site and day), as in the app", async () => {
    const t = await replyFirm();
    const zoe = await t.casual();
    // The events made for sessions that come without one, named after the site and the day.
    const automatic = async (day: string, label: string) => {
      const { rows } = await su.query<{ id: string }>(
        `insert into shift_events (firm_id, name, planner_ref) values ($1, $2, $3)
         returning id::text as id`,
        [t.f.firmId, `Acme Test Arena · ${label}`, `auto:${t.arena}:${day}`],
      );
      return rows[0]?.id ?? "";
    };
    const open = await t.session(48, { eventId: await automatic("2026-11-04", "Wed 4 Nov") });
    await t.estimate(open, 20);
    const friday = await t.f.shift({
      startsAt: hoursFromNow(96), // Fri 6 Nov 09:00-17:00
      eventId: await automatic("2026-11-06", "Fri 6 Nov"),
    });
    await su.query("update shifts set site_id = $2 where id = $1", [friday, t.arena]);
    await t.f.booking(zoe, friday, "confirmed");

    const list = await t.reply(zoe);
    expect(list.checks.whatsapp.offered.map((o) => o.shiftId)).toEqual([open]);
    expect(list.whatsapp).toContain("1. Door supervisor · Acme Test Arena · Wed 4 Nov 09:00–17:00");
    expect(list.whatsapp).not.toContain("Wed 4 Nov, Acme Test Arena");
    const day = await t.reply(zoe, "anything on friday?");
    expect(day.whatsapp).toMatch(
      /^Hi Zoe, you're booked on Fri 6 Nov \(Door supervisor · 09:00–17:00\)\. /,
    );
    const cancel = await cancelReply(withFirm, {
      firmId: t.f.firmId,
      workerId: zoe,
      now: NOW,
      firm: voice(t.firmName),
      portal: PORTAL,
    });
    expect(cancel.whatsapp).toContain(
      "you're booked on Door supervisor · Acme Test Arena · Fri 6 Nov 09:00–17:00.",
    );
  });
});

describe("counts and edges", () => {
  it("past the sessions read: an exact not-offered count, and the rest counted as not checked", async () => {
    const t = await replyFirm();
    const zoe = await t.casual();
    const ok = await t.session(20);
    // 85 sessions needing first aid (she has none), every 3 hours from +30.
    const first = await t.session(30, { extra: ["FIRST_AID"] });
    await su.query(
      `insert into shifts (firm_id, event_id, site_id, role, starts_at, ends_at, headcount, status,
                           source, required_credentials)
       select firm_id, event_id, site_id, role, starts_at + make_interval(hours => g * 3),
              ends_at + make_interval(hours => g * 3), 1, 'open', 'native', required_credentials
         from shifts, generate_series(1, 84) g
        where id = $1`,
      [first],
    );
    const r = await t.reply(zoe);
    expect(r.checks.whatsapp.offered.map((o) => o.shiftId)).toEqual([ok]);
    // 80 read (the listed one among them): 79 not offered, 50 shown and 29 more; 6 not read.
    expect(r.checks.whatsapp.notOffered).toHaveLength(50);
    expect(r.checks.whatsapp.notOfferedMore).toBe(29);
    expect(r.checks.whatsapp.notChecked).toBe(6);
    expect(passesLogCheck({ ...r.checks.whatsapp })).toBe(true);
  });

  it("a booking on a cancelled session isn't named as hers", async () => {
    const t = await replyFirm();
    const zoe = await t.casual();
    await t.session(121); // Sat 7 Nov
    const gone = await t.booked(zoe, 145); // Sun 8 Nov
    await su.query("update shifts set status = 'cancelled' where id = $1", [gone.shiftId]);
    const r = await t.reply(zoe, "anything this weekend?");
    expect(r.whatsapp.split("\n")[0]).toBe("Hi Zoe, for the weekend you can take:");
  });

  it('an application counted within the allowance: offered, logged as applied, never "you hold CSAS"', async () => {
    const t = await replyFirm();
    await su.query(
      "update credential_types set applied_allowed = true where firm_id = $1 and code = 'CSAS'",
      [t.f.firmId],
    );
    await su.query(
      `update firms set settings = settings || '{"credential_applied_allowance_pct": 100}'
        where id = $1`,
      [t.f.firmId],
    );
    const hana = await t.casual({ first: "Hana" });
    await su.query(
      "insert into credentials (firm_id, worker_id, type, status) values ($1, $2, 'CSAS', 'applied')",
      [t.f.firmId, hana],
    );
    const patrol = await t.session(30, { role: "csas_officer" });
    const r = await t.reply(hana);
    expect(r.checks.whatsapp.offered.map((o) => o.shiftId)).toEqual([patrol]);
    expect(
      r.checks.whatsapp.offered[0]?.checks.find((c) => c.code === "qualification"),
    ).toMatchObject({ passed: true, type: "CSAS", held: "applied" });
    expect(r.whatsapp).toContain("CSAS officer · Fixture event");
    expect(r.whatsapp).not.toContain("you hold CSAS");
  });
});

describe("the cancel reply", () => {
  it("names her next booking; a strike sentence inside 48 hours of one she took; her other shifts", async () => {
    const t = await replyFirm();
    const zoe = await t.casual();
    const soon = await t.booked(zoe, 30); // Tue 3 Nov 15:00, taken by her
    await t.booked(zoe, 100);
    const r = await cancelReply(withFirm, {
      firmId: t.f.firmId,
      workerId: zoe,
      now: NOW,
      firm: voice(t.firmName),
      portal: PORTAL,
    });
    expect(r.whatsapp).toBe(
      `Hi Zoe, you're booked on Door supervisor · Fixture event, Acme Test Arena · Tue 3 Nov 15:00–23:00. To cancel, open it and tap Cancel this shift: ${PORTAL}/shifts/${soon.shiftId}. It starts in less than 48 hours, so cancelling now gives you a strike. Your other shifts: ${PORTAL}/ ${AUTOMATIC}\n— ${t.firmName} Shift Team`,
    );
    expect(r.checks.whatsapp).toMatchObject({
      template: "cancel_booking",
      bookings: [soon.assignmentId],
    });
  });

  it("one she took with 48 hours' notice or more: no strike sentence", async () => {
    const t = await replyFirm();
    const zoe = await t.casual();
    await t.booked(zoe, 48); // Wed 4 Nov 09:00: exactly 48 hours ahead
    const r = await cancelReply(withFirm, {
      firmId: t.f.firmId,
      workerId: zoe,
      now: NOW,
      firm: voice(t.firmName),
      portal: PORTAL,
    });
    expect(r.whatsapp).toContain("you're booked on Door supervisor");
    expect(r.whatsapp).not.toContain("strike");
  });

  it("one the office booked: no strike sentence; only one booking: no other shifts", async () => {
    const t = await replyFirm();
    const zoe = await t.casual();
    await t.booked(zoe, 30, 8, "firm");
    const r = await cancelReply(withFirm, {
      firmId: t.f.firmId,
      workerId: zoe,
      now: NOW,
      firm: voice(t.firmName),
      portal: PORTAL,
    });
    expect(r.whatsapp).not.toContain("strike");
    expect(r.whatsapp).not.toContain("Your other shifts");
    expect(r.sms.endsWith(` - ${t.firmName} Shift Team`)).toBe(true);
  });
});

describe("through the shifts line's job", () => {
  async function lined() {
    const t = await replyFirm();
    const line = await freshLine();
    await su.query("update firms set shifts_line_e164 = $2 where id = $1", [t.f.firmId, line]);
    const zoe = await t.casual();
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [zoe],
    );
    const mobile = rows[0]?.mobile ?? "";
    const capture = captureTransport();
    const send = async (
      body: string,
      channel: "whatsapp" | "sms" = "whatsapp",
      transport: MessagingTransport = capture.transport,
    ) => {
      const messageSid = `SM${randomBytes(16).toString("hex")}`;
      if (channel === "sms") {
        await receiveSms(
          t.f.firmId,
          { messageSid, from: mobile, to: line, body, twilioOptOut: null },
          { run: withFirm },
        );
      } else {
        await receiveWhatsApp(
          t.f.firmId,
          { messageSid, from: mobile, to: line, body },
          { run: withFirm },
        );
      }
      // The job queued for that very message, run as the worker would.
      const { rows: queued } = await su.query<{ data: Record<string, unknown> }>(
        `select j.data from pgboss.job j
           join messages m on m.id::text = j.data ->> 'messageId'
          where j.name = $1 and m.firm_id = $2 and m.provider_message_id = $3`,
        [INBOUND_MESSAGE_QUEUE, t.f.firmId, messageSid],
      );
      const job = queued[0]?.data ?? {};
      const result = await runInboundMessage(
        job as Parameters<typeof runInboundMessage>[0],
        withFirm,
        { transport, ai: noAi, baseDomain: "shiftdesk.test", clock },
      );
      return { messageId: String(job.messageId), result };
    };
    const eventsOf = async (messageId: string, action: string) =>
      (
        await su.query<{ data: Record<string, unknown> }>(
          "select data from events where entity_id = $1 and action = $2 order by id",
          [messageId, action],
        )
      ).rows.map((r) => r.data);
    return { ...t, zoe, mobile, capture, send, eventsOf };
  }

  it("shifts: the personal list goes, and enquiry.checks is logged for the office's page", async () => {
    const t = await lined();
    const ok = await t.session(48, { pay: 1550 });
    await t.estimate(ok, 20);
    const firstAid = await t.session(72, { extra: ["FIRST_AID"] });
    const { messageId, result } = await t.send("any shifts this week?");
    expect(result).toMatchObject({ status: "replied", intent: "shifts", handledAs: "keyword" });
    expect(t.capture.sent.at(-1)?.body).toMatch(
      /^Hi Zoe, shifts you can take:\n1\. Door supervisor/,
    );
    const [checks] = await t.eventsOf(messageId, "enquiry.checks");
    expect(checks).toMatchObject({
      template: "shifts_list",
      sent: true,
      channel: "whatsapp",
      workerId: t.zoe,
      offered: [{ shiftId: ok, car: 20 }],
      notOffered: [
        { shiftId: firstAid, reasons: [{ code: "credential_missing", type: "FIRST_AID" }] },
      ],
    });
    // The office reads it on the message's page: each check, and why the other wasn't offered.
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, messageId, NOW));
    expect(e?.built?.offered[0]).toMatchObject({
      shiftId: ok,
      session: { role: "door_supervisor", siteName: "Acme Test Arena" },
    });
    expect(e?.built?.offered[0]?.checks.find((c) => c.code === "qualification")).toMatchObject({
      passed: true,
      detail: { type: "SIA_DS", expiresOn: "2029-01-01" },
    });
    expect(e?.built?.notOffered[0]).toMatchObject({ shiftId: firstAid });
    expect(e?.built?.names).toMatchObject({ FIRST_AID: "first aid at work certificate" });
    expect(e?.built?.travelOff).toBe(false);
  });

  it("travel areas off for the firm (13.4): the entry says so, and the office's page reads it", async () => {
    const t = await lined();
    const ok = await t.session(48);
    await su.query(
      `update firms set settings = jsonb_set(settings, '{travel,enabled}', 'false') where id = $1`,
      [t.f.firmId],
    );
    const { messageId, result } = await t.send("any shifts this week?");
    expect(result).toMatchObject({ status: "replied", intent: "shifts" });
    expect(t.capture.sent.at(-1)?.body).not.toMatch(/home area|min by car|miles/);
    const [checks] = await t.eventsOf(messageId, "enquiry.checks");
    expect(checks).toMatchObject({ area: null, travelOff: true, offered: [{ shiftId: ok }] });
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, messageId, NOW));
    expect(e?.built).toMatchObject({ area: null, travelOff: true });
  });

  it('by text: three listed and "+ 2 more", and the entry says the same; WhatsApp lists five', async () => {
    const t = await lined();
    const ids: string[] = [];
    for (const h of [30, 54, 78, 102, 126]) {
      const id = await t.session(h);
      await t.estimate(id, 20);
      ids.push(id);
    }
    const text = await t.send("any shifts?", "sms");
    const sent = t.capture.sent.at(-1);
    expect(sent).toMatchObject({ channel: "sms" });
    const body = sent && "body" in sent ? sent.body : "";
    expect(body).toContain(" 3) ");
    expect(body).not.toContain(" 4) ");
    expect(body).toContain("+ 2 more.");
    expect(body.length).toBeLessThanOrEqual(1600);
    const [byText] = await t.eventsOf(text.messageId, "enquiry.checks");
    expect(byText).toMatchObject({ channel: "sms", sent: true, more: 2 });
    expect((byText?.offered as { shiftId: string }[]).map((o) => o.shiftId)).toEqual(
      ids.slice(0, 3),
    );
    const whatsapp = await t.send("any shifts?");
    const [byWhatsApp] = await t.eventsOf(whatsapp.messageId, "enquiry.checks");
    expect(byWhatsApp).toMatchObject({ channel: "whatsapp", more: 0 });
    expect((byWhatsApp?.offered as unknown[]).length).toBe(5);
  });

  it("WhatsApp refuses it: the text version goes, and the text's entry is logged", async () => {
    const t = await lined();
    for (const h of [30, 54, 78, 102, 126]) {
      await t.estimate(await t.session(h), 20);
    }
    const texts: string[] = [];
    const refusing: MessagingTransport = {
      name: "refuses-whatsapp",
      async send(m) {
        if (m.channel === "whatsapp") throw new ChannelRefusedError("whatsapp");
        if ("body" in m) texts.push(m.body);
        return { providerMessageId: `text-${randomBytes(8).toString("hex")}` };
      },
    };
    const { messageId } = await t.send("any shifts?", "whatsapp", refusing);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("+ 2 more.");
    const [entry] = await t.eventsOf(messageId, "enquiry.checks");
    expect(entry).toMatchObject({ channel: "sms", sent: true, more: 2 });
    expect((entry?.offered as unknown[]).length).toBe(3);
  });

  it("cancel: the office's page names the booking the reply named", async () => {
    const t = await lined();
    const soon = await t.booked(t.zoe, 30);
    const { messageId } = await t.send("can I cancel my shift");
    const [checks] = await t.eventsOf(messageId, "enquiry.checks");
    expect(checks).toMatchObject({ template: "cancel_booking", bookings: [soon.assignmentId] });
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, messageId, NOW));
    expect(e?.built?.named).toEqual([
      expect.objectContaining({ shiftId: soon.shiftId, role: "door_supervisor" }),
    ]);
  });

  it("a damaged entry: what can't be read is shown as such, never a page that fails", async () => {
    const t = await lined();
    const ok = await t.session(48);
    const { messageId } = await t.send("any shifts?");
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'system', 'enquiry.checks', 'message', $2, $3)`,
      [
        t.f.firmId,
        messageId,
        JSON.stringify({
          template: "shifts_list",
          offered: [
            {
              shiftId: ok,
              car: 20,
              publicTransport: null,
              checks: [
                { code: "overlap", passed: false, withStart: "bad", withEnd: null },
                { code: "qualification", passed: true, type: "SIA_DS", expiresOn: "2029-02-30" },
                { code: "rest", passed: true, hoursBefore: null, hoursAfter: 12 },
              ],
            },
          ],
          notOffered: [{ shiftId: ok, reasons: [{ code: "overlap", from: "yesterday", to: 5 }] }],
          bookings: ["not-an-id"],
        }),
      ],
    );
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, messageId, NOW));
    expect(e?.built?.offered[0]?.checks.map((c) => c.code)).toEqual([
      "unreadable",
      "unreadable",
      "rest",
    ]);
    expect(e?.built?.notOffered[0]?.reasons).toEqual([{ code: "overlap" }]);
    expect(e?.built?.bookings).toEqual([]);
  });

  it("pay: the link only, never a list; no AI sorting: the reason is logged", async () => {
    const t = await lined();
    await t.session(48);
    const { rows: slugs } = await su.query<{ slug: string }>(
      "select slug from firms where id = $1",
      [t.f.firmId],
    );
    const pay = await t.send("when do I get paid");
    expect(t.capture.sent.at(-1)?.body).toBe(
      `Your hours, rates and pay dates: https://${slugs[0]?.slug}.shiftdesk.test/pay (you'll get a code to log in). ${AUTOMATIC} — ${t.firmName} Shift Team`,
    );
    expect(await t.eventsOf(pay.messageId, "enquiry.checks")).toEqual([]);
    const unsorted = await t.send("is there parking at the venue");
    expect(unsorted.result).toMatchObject({ intent: "office", handledAs: "office" });
    const [received] = await t.eventsOf(unsorted.messageId, "message.received");
    expect(received).toMatchObject({ handledAs: "office", aiFallback: "not_connected" });
  });
});

describe("travel areas switched off for the firm (13.4)", () => {
  it("lists what she could take wherever it is: no travel lines, no ask for a home area, nothing ruled out by distance; logged as off", async () => {
    const t = await replyFirm();
    const zoe = await t.casual(); // her area saved while they were on
    const near = await t.session(24);
    await t.estimate(near, 20);
    const far = await t.session(48);
    await t.estimate(far, 90); // outside her 45 minutes
    const on = await t.reply(zoe);
    expect(on.checks.whatsapp.offered.map((o) => o.shiftId)).toEqual([near]);
    expect(reasonsOf(on.checks.whatsapp, far)).toEqual(["outside_area"]);

    await su.query(
      `update firms set settings = jsonb_set(settings, '{travel,enabled}', 'false') where id = $1`,
      [t.f.firmId],
    );
    const off = await t.reply(zoe);
    for (const channel of ["whatsapp", "sms"] as const) {
      expect(off.checks[channel]).toMatchObject({ area: null, travelOff: true });
      expect(off.checks[channel].offered.map((o) => [o.shiftId, o.car])).toEqual([
        [near, null],
        [far, null],
      ]);
      expect(reasonsOf(off.checks[channel], far)).toBeUndefined();
    }
    for (const text of [off.whatsapp, off.sms]) {
      expect(text).not.toMatch(/home area|miles|min by car|public transport/i);
    }
  });
});
