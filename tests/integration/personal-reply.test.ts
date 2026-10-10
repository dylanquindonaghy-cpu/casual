import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noAi } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { passesLogCheck } from "@/lib/events/record";
import { cancelReply, shiftsReply, AUTOMATIC } from "@/lib/inbound/personal-reply";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import { receiveWhatsApp } from "@/lib/inbound/receive";
import { runInboundMessage } from "@/lib/inbound/reply";
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

async function replyFirm() {
  const f = await bookingFirm(su, withFirm);
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

const reasonsOf = (checks: Awaited<ReturnType<typeof shiftsReply>>["checks"], shiftId: string) =>
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
    expect(r.checks.offered.map((o) => o.shiftId)).toEqual([ok]);
    expect(reasonsOf(r.checks, missing)).toEqual(["credential_missing"]);
    expect(r.checks.notOffered.find((n) => n.shiftId === missing)?.reasons).toEqual([
      { code: "credential_missing", type: "FIRST_AID" },
    ]);
    expect(reasonsOf(r.checks, expired)).toEqual(["credential_expired"]);
    expect(reasonsOf(r.checks, midSession)).toEqual(["credential_expired"]);
    expect(reasonsOf(r.checks, clash)).toEqual(["overlap"]);
    expect(r.checks.notOffered.find((n) => n.shiftId === clash)?.reasons[0]).toMatchObject({
      from: hoursFromNow(168).toISOString(),
      to: hoursFromNow(176).toISOString(),
    });
    expect(reasonsOf(r.checks, rest)).toEqual(["rest"]);
    expect(reasonsOf(r.checks, weekly)).toEqual(["weekly_hours"]);
    expect(reasonsOf(r.checks, dayOff)).toEqual(["unavailable"]);
    expect(reasonsOf(r.checks, blocked)).toEqual(["blocked_site"]);
    expect(reasonsOf(r.checks, hiddenSession)).toEqual(["hidden"]);
    expect(reasonsOf(r.checks, hiddenEvent)).toEqual(["hidden"]);
    expect(reasonsOf(r.checks, far)).toEqual(["outside_area"]);
    expect(r.checks.notOfferedMore).toBe(0);

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
    expect(r.checks.offered[0]).toMatchObject({ car: 20, publicTransport: null });
    expect(r.checks.offered[0]?.checks.map((c) => c.code)).toEqual([
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
    expect(passesLogCheck({ ...r.checks })).toBe(true);
  });

  it("CSAS sessions only to holders; a holder's line says so", async () => {
    const t = await replyFirm();
    const holder = await t.casual({ first: "Hana", csas: true });
    const other = await t.casual({ first: "Noor" });
    const patrol = await t.session(30, { role: "csas_officer", post: "town centre patrol" });
    const forHolder = await t.reply(holder);
    expect(forHolder.checks.offered.map((o) => o.shiftId)).toEqual([patrol]);
    expect(forHolder.whatsapp).toContain("CSAS officer · Fixture event, Acme Test Arena");
    expect(forHolder.whatsapp).toContain("town centre patrol · you hold CSAS");
    const forOther = await t.reply(other);
    expect(forOther.checks.offered).toEqual([]);
    expect(forOther.checks.notOffered.find((n) => n.shiftId === patrol)?.reasons).toEqual([
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
    expect(r.checks.days).toEqual(["2026-11-07", "2026-11-08"]);
    expect(r.checks.offered.map((o) => o.shiftId)).toEqual([saturday]);
    expect(r.whatsapp.split("\n")[0]).toBe(
      "Hi Zoe, you're booked on Sun 8 Nov (Door supervisor · Fixture event · 10:00–18:00). For the weekend you can take:",
    );
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
    expect(r.checks).toMatchObject({ template: "cancel_booking", bookings: [soon.assignmentId] });
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
    const send = async (body: string) => {
      const messageSid = `SM${randomBytes(16).toString("hex")}`;
      await receiveWhatsApp(
        t.f.firmId,
        { messageSid, from: mobile, to: line, body },
        { run: withFirm },
      );
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
        { transport: capture.transport, ai: noAi, baseDomain: "shiftdesk.test", clock },
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
