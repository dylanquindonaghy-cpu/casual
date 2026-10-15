import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { eraseWorker, workerDataSummary } from "@/lib/gdpr/worker-erase";
import { exportWorkerData, findWorkers } from "@/lib/gdpr/worker-export";
import { runFirmTask } from "@/lib/jobs/firm-job";
import type { OutboundMessage } from "@/lib/messaging/transport";
import {
  createFirmChangeNoticeTask,
  FIRM_CHANGE_NOTICE_QUEUE,
  type NoticeDeps,
} from "@/lib/notices/firm-change";
import { createRequestUpdateTask } from "@/lib/notices/request-update";
import { lockReachableWorkers } from "@/lib/offers/reachable";
import { cancelBookingByOffice } from "@/lib/office/quick-actions";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { createTenant } from "../helpers/tenant-rows";

// GDPR for one worker (docs/runbooks.md "GDPR requests"): the export holds everything about them
// and nobody else; erasure removes their personal details and keeps the anonymous evidence.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool();
  withFirm = createWithFirm(app);
});

afterAll(async () => {
  await app.end();
  await su.end();
});

const clock = { now: () => NOW };
const smId = () => `SM${randomBytes(16).toString("hex")}`;
const hash = () => randomBytes(32);

async function one(text: string, values: unknown[]): Promise<string> {
  const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = rows[0]?.id;
  if (!id) throw new Error(`insert returned no id: ${text}`);
  return id;
}

async function count(table: string, where: string, values: unknown[]): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
    values,
  );
  return rows[0]?.n ?? -1;
}

// A worker with a row in every table that can be about them, and a colleague and a stranger whose
// rows must never be touched or exported.
async function everything() {
  const b = await bookingFirm(su, withFirm);
  const admin = await b.office("admin");
  const resourcer = await b.office("resourcer");
  const payroll = await b.office("payroll");
  const worker = await b.worker({ first: "Ann" });
  const colleague = await b.worker({ first: "Cara" });
  const mobileOf = async (id: string) =>
    (await su.query<{ m: string }>("select mobile_e164 as m from workers where id = $1", [id]))
      .rows[0]?.m ?? "";
  const mobile = await mobileOf(worker);
  const colleagueMobile = await mobileOf(colleague);
  await su.query(
    "update workers set email = 'ann.booker@example.com', external_ref = 'STAFF-1' where id = $1",
    [worker],
  );
  await su.query("update credentials set number = '1234-5678-9012' where worker_id = $1", [worker]);

  const past = await b.shift({ startsAt: hoursFromNow(-72) });
  const pastCancelled = await b.shift({ startsAt: hoursFromNow(-30) });
  const booking = await b.booking(worker, past, "completed");
  // The office placed them despite a rule, with its own words about them (Phase 10: kept on the
  // booking, not in the log); and our copy of the rota sheet's names holds their staff id.
  await su.query("update assignments set override_reason = $2 where id = $1", [
    booking,
    "Rang in for Priya, she's ill",
  ]);
  await su.query("update shifts set synced_holders = array['STAFF-9', 'STAFF-1'] where id = $1", [
    past,
  ]);
  const cancelled = await b.booking(worker, pastCancelled, "cancelled_worker");
  // Their own words on the cancellation, and a booking the office cancelled with its fixed words.
  await su.query("update assignments set cancel_reason = $2 where id = $1", [
    cancelled,
    "Something else: chemo moved to Friday",
  ]);
  const pastFirmCancelled = await b.shift({ startsAt: hoursFromNow(-20) });
  const firmCancelled = await b.booking(worker, pastFirmCancelled, "cancelled_worker");
  await su.query(
    "update assignments set status = 'cancelled_firm', cancel_reason = $2 where id = $1",
    [firmCancelled, "The client needs fewer staff"],
  );
  const offer = await one(
    `insert into offers (firm_id, shift_id, worker_id, wave, channel, response, responded_at)
     values ($1, $2, $3, 1, 'whatsapp', 'accepted', $4)`,
    [b.firmId, past, worker, hoursFromNow(-80)],
  );
  const reminder = await one(
    `insert into shift_reminders (firm_id, assignment_id, kind, starts_at, status, channel)
     values ($1, $2, '24h', $3, 'sent', 'whatsapp')`,
    [b.firmId, booking, hoursFromNow(-72)],
  );
  const question = await one(
    `insert into requests (firm_id, worker_id, type, payload, status, resolved_by, resolved_at, resolution_note)
     values ($1, $2, 'general', $3, 'approved', $4, $5, 'Yes Ann, that is fine')`,
    [
      b.firmId,
      worker,
      JSON.stringify({ note: "Can I swap Saturday with Cara?", via: "whatsapp" }),
      admin,
      hoursFromNow(-10),
    ],
  );
  const timeChange = await one(
    `insert into requests (firm_id, worker_id, shift_id, type, payload)
     values ($1, $2, $3, 'time_change', $4)`,
    [b.firmId, worker, past, JSON.stringify({ start: "10:00", end: "18:00", note: "School run" })],
  );
  const swap = await one(
    `insert into requests (firm_id, worker_id, shift_id, type, payload)
     values ($1, $2, $3, 'swap', $4)`,
    [b.firmId, worker, past, JSON.stringify({ swapWith: "Cara Booker", note: "" })],
  );
  const payRecord = await one(
    `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
     values ($1, $2, '2026-10-26', '2026-11-01', 8, 1250)`,
    [b.firmId, worker],
  );
  const payQuery = await one(
    `insert into pay_queries (firm_id, worker_id, work_date, issue_type, details, status,
                              resolved_by, resolved_at, resolution_note)
     values ($1, $2, '2026-10-31', 'missing_hours', 'Missing 2 hours on Saturday', 'resolved',
             $3, $4, 'Added to next pay')`,
    [b.firmId, worker, payroll, hoursFromNow(-5)],
  );
  const line = "+447700900999";
  const inbound = await one(
    `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, from_e164, to_e164, body)
     values ($1, 'in', 'whatsapp', $2, $3, $4, $5, '=HYPERLINK("http://x.invalid")')`,
    [b.firmId, smId(), worker, mobile, line],
  );
  const reply = await one(
    `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, from_e164, to_e164, body, reply_to)
     values ($1, 'out', 'whatsapp', $2, $3, $4, $5, 'Your shifts: ...', $6)`,
    [b.firmId, smId(), worker, line, mobile, inbound],
  );
  // Sent before their number was known (no worker set), and the reply to it.
  const early = await one(
    `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164, body)
     values ($1, 'in', 'whatsapp', $2, $3, $4, 'Is this the shifts line?')`,
    [b.firmId, smId(), mobile, line],
  );
  const earlyReply = await one(
    `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164, body, reply_to)
     values ($1, 'out', 'whatsapp', $2, $3, $4, 'Reply with your full name', $5)`,
    [b.firmId, smId(), line, mobile, early],
  );
  const colleagueMessage = await one(
    `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, from_e164, to_e164, body)
     values ($1, 'in', 'whatsapp', $2, $3, $4, $5, 'Colleague words')`,
    [b.firmId, smId(), colleague, colleagueMobile, line],
  );
  const strangerMessage = await one(
    `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164, body)
     values ($1, 'in', 'sms', $2, '+447700900555', $3, 'Stranger words')`,
    [b.firmId, smId(), line],
  );
  const session = await one(
    `insert into sessions (firm_id, kind, worker_id, token_hash, expires_at, rotated_at)
     values ($1, 'worker', $2, $3, $4, now())`,
    [b.firmId, worker, hash(), hoursFromNow(24 * 30)],
  );
  await one(
    "insert into otp_codes (firm_id, session_id, code_hash, expires_at) values ($1, $2, $3, $4)",
    [b.firmId, session, hash(), hoursFromNow(1)],
  );
  await one(
    `insert into magic_links (firm_id, kind, worker_id, token_hash, request_id, expires_at)
     values ($1, 'worker', $2, $3, $4, $5)`,
    [b.firmId, worker, hash(), randomUUID(), hoursFromNow(1)],
  );
  await one(
    `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
     values ($1, $2, $3, 'secret-p256dh', 'secret-auth')`,
    [b.firmId, worker, `https://push.example.test/${randomUUID()}`],
  );
  await one("insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, $3)", [
    b.firmId,
    worker,
    "2026-12-25",
  ]);
  // A site the office kept them off (Phase 10).
  const barredFrom = await one("insert into sites (firm_id, name) values ($1, 'Riverside Arena')", [
    b.firmId,
  ]);
  await one(
    "insert into worker_site_blocks (firm_id, worker_id, site_id, reason) values ($1, $2, $3, 'incident')",
    [b.firmId, worker, barredFrom],
  );
  // Their travel area (12G.1).
  await one(
    `insert into worker_travel (firm_id, worker_id, start_postcode, lat, lng, modes, max_minutes,
                                privacy_notice_version, updated_at)
     values ($1, $2, 'ZZ4 4DD', 53.932, -1.478, 'car', 60, 'travel-v1', now())`,
    [b.firmId, worker],
  );
  const events = {
    added: await one(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id)
       values ($1, 'office', 'worker.added', 'worker', $2)`,
      [b.firmId, worker],
    ),
    assigned: await one(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'worker', 'shift.assigned', 'assignment', $2, $3)`,
      [b.firmId, booking, JSON.stringify({ workerId: worker, shiftId: past })],
    ),
    login: await one(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type)
       values ($1, 'worker', $2, 'auth.login', 'session')`,
      [b.firmId, worker],
    ),
    colleague: await one(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type)
       values ($1, 'worker', $2, 'auth.login', 'session')`,
      [b.firmId, colleague],
    ),
    // About them without naming them: the office answering their request, a credential warning.
    answered: await one(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data)
       values ($1, 'office', $2, 'request.approved', 'request', $3, $4)`,
      [b.firmId, admin, question, JSON.stringify({ type: "general", withNote: true })],
    ),
    warned: await one(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       select $1, 'system', 'credential.expiry_warning', 'credential', c.id, '{"days": 30}'
         from credentials c where c.worker_id = $2 order by c.id limit 1`,
      [b.firmId, worker],
    ),
  };
  return {
    b,
    admin,
    resourcer,
    payroll,
    worker,
    colleague,
    mobile,
    ids: {
      booking,
      cancelled,
      offer,
      reminder,
      question,
      timeChange,
      swap,
      firmCancelled,
      payRecord,
      payQuery,
      inbound,
      reply,
      early,
      earlyReply,
      colleagueMessage,
      strangerMessage,
    },
    events,
  };
}

const ctx = (b: BookingFirm, officeUserId: string) => ({
  firm: { id: b.firmId },
  officeUserId,
  run: withFirm,
  clock,
});

type Everything = Awaited<ReturnType<typeof everything>>;

async function exported(t: Everything, format: "json" | "csv" = "json") {
  const result = await exportWorkerData(ctx(t.b, t.admin), t.worker, format);
  if (result.status !== "ok") throw new Error(`export: ${result.status}`);
  return result;
}

const idsIn = (rows: unknown) => (rows as { id?: unknown }[]).map((r) => String(r.id));

describe("a worker's data export", () => {
  it("holds every row about them, and nobody else's", async () => {
    const t = await everything();
    const result = await exported(t);
    expect(result.contentType).toBe("application/json; charset=utf-8");
    expect(result.fileName).toBe(`worker-${t.worker.slice(0, 8)}-data-2026-11-02.json`);
    expect(result.fileName).not.toMatch(/ann/i);
    const data = JSON.parse(result.body) as {
      firm: string;
      worker: Record<string, unknown>;
      sections: Record<string, Record<string, unknown>[]>;
    };
    expect(data.worker).toMatchObject({
      id: t.worker,
      firstName: "Ann",
      lastName: "Booker",
      mobileE164: t.mobile,
      email: "ann.booker@example.com",
      externalRef: "STAFF-1",
    });
    const s = data.sections;
    expect(s.credentials?.map((c) => c.number)).toContain("1234-5678-9012");
    expect(s.credentials).toHaveLength(2);
    expect(s.daysUnavailable?.map((d) => d.day)).toEqual(["2026-12-25"]);
    expect(s.siteBlocks).toEqual([
      { site: "Riverside Arena", reason: "incident", createdAt: expect.any(String) },
    ]);
    // Their travel area, in full: it's theirs (12G.1).
    expect(s.travelArea).toEqual([
      expect.objectContaining({
        startPostcode: "ZZ4 4DD",
        lat: "53.932000",
        lng: "-1.478000",
        modes: "car",
        maxMinutes: 60,
        privacyNoticeVersion: "travel-v1",
      }),
    ]);
    expect(idsIn(s.bookings).sort()).toEqual(
      [t.ids.booking, t.ids.cancelled, t.ids.firmCancelled].sort(),
    );
    expect(s.bookings?.find((r) => r.id === t.ids.cancelled)).toMatchObject({
      cancelReason: "Something else: chemo moved to Friday",
      noticeHours: "20.00",
    });
    expect(idsIn(s.offers)).toEqual([t.ids.offer]);
    expect(idsIn(s.shiftReminders)).toEqual([t.ids.reminder]);
    expect(idsIn(s.requests).sort()).toEqual([t.ids.question, t.ids.timeChange, t.ids.swap].sort());
    expect(idsIn(s.payRecords)).toEqual([t.ids.payRecord]);
    expect(s.payQueries?.[0]).toMatchObject({
      id: t.ids.payQuery,
      details: "Missing 2 hours on Saturday",
      resolutionNote: "Added to next pay",
    });
    expect(idsIn(s.messages).sort()).toEqual(
      [t.ids.inbound, t.ids.reply, t.ids.early, t.ids.earlyReply].sort(),
    );
    // Every row the action log's Worker filter finds, those not naming them included: the same
    // events, by what each says, numbered within the file (1, 2, 3… as they happened), never by the
    // counter every firm shares (the reviews of Phase 10 task 19).
    const { rows: logged } = await su.query<{ action: string; entity: string | null }>(
      "select action, entity_id::text as entity from events where id = any($1::bigint[]) order by id",
      [[t.events.added, t.events.assigned, t.events.login, t.events.answered, t.events.warned]],
    );
    const log = s.actionLog as { id: unknown; action: string; entityId: string | null }[];
    expect(log.map((r) => [r.action, r.entityId])).toEqual(logged.map((e) => [e.action, e.entity]));
    expect(idsIn(s.actionLog)).toEqual(logged.map((_, i) => String(i + 1)));
    expect(s.logins).toHaveLength(1);
    expect(s.loginLinks).toHaveLength(1);
    expect(s.phoneNotifications).toHaveLength(1);
    expect(s.shifts?.map((r) => r.id)).toHaveLength(3);

    // Nobody else's rows, and no firm ids or login secrets.
    expect(result.body).not.toContain("Colleague words");
    expect(result.body).not.toContain("Stranger words");
    expect(result.body).not.toContain(t.colleague);
    expect(result.body).not.toContain(t.b.firmId);
    for (const secret of ["tokenHash", "codeHash", "p256dh", "secret-auth", "endpoint"]) {
      expect(result.body).not.toContain(secret);
    }
  });

  it("as CSV: one value per line, nested fields dotted, formulas made inert", async () => {
    const t = await everything();
    const result = await exported(t, "csv");
    expect(result.contentType).toBe("text/csv; charset=utf-8");
    expect(result.body.startsWith("\uFEFF")).toBe(true);
    const lines = result.body.slice(1).split("\r\n");
    expect(lines[0]).toBe("Section,Record,Field,Value");
    expect(lines).toContain("worker,1,firstName,Ann");
    // A leading + could start a formula: the quote makes Excel show it as text.
    expect(lines).toContain(`worker,1,mobileE164,'${t.mobile}`);
    expect(
      lines.some((l) => /^requests,\d,payload\.note,Can I swap Saturday with Cara\?$/.test(l)),
    ).toBe(true);
    // The worker's WhatsApp starting "=" can't run as a formula in a spreadsheet.
    expect(lines.some((l) => l.includes(`"'=HYPERLINK(""http://x.invalid"")"`))).toBe(true);
    expect(lines.some((l) => l.includes(",=HYPERLINK"))).toBe(false);
  });

  it("is logged, with the format and no personal data", async () => {
    const t = await everything();
    await exported(t, "csv");
    const { rows } = await su.query(
      `select actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action = 'worker.data_exported'`,
      [t.b.firmId],
    );
    expect(rows).toEqual([
      {
        actor_type: "office",
        actor_id: t.admin,
        entity_id: t.worker,
        data: { workerId: t.worker, format: "csv" },
      },
    ]);
  });

  it("admins only; a worker of another firm, or no worker, is not found", async () => {
    const t = await everything();
    for (const who of [t.resourcer, t.payroll]) {
      expect(await exportWorkerData(ctx(t.b, who), t.worker, "json")).toEqual({
        status: "not_allowed",
      });
    }
    const other = await createTenant(su);
    expect(await exportWorkerData(ctx(t.b, t.admin), other.workerId, "json")).toEqual({
      status: "not_found",
    });
    expect(await exportWorkerData(ctx(t.b, t.admin), "not-a-uuid", "json")).toEqual({
      status: "not_found",
    });
    expect(await exportWorkerData(ctx(t.b, t.admin), t.worker, "xml")).toEqual({
      status: "not_found",
    });
    expect(
      await count("events", "firm_id = $1 and action = 'worker.data_exported'", [t.b.firmId]),
    ).toBe(0);
  });
});

describe("finding the worker a request is about", () => {
  it("by part of a name, or a mobile written any UK way; admins only", async () => {
    const t = await everything();
    const find = (q: string, who = t.admin) => findWorkers(ctx(t.b, who), q);
    expect((await find("ann"))?.map((m) => m.id)).toEqual([t.worker]);
    expect((await find("booker"))?.map((m) => m.id).sort()).toEqual([t.worker, t.colleague].sort());
    const national = `0${t.mobile.slice(3)}`;
    expect((await find(national))?.map((m) => m.id)).toEqual([t.worker]);
    // A % or _ is a letter here, not a wildcard.
    expect(await find("%")).toEqual([]);
    expect(await find("   ")).toEqual([]);
    expect(await find("ann", t.resourcer)).toBeNull();
  });
});

describe("erasing a worker", () => {
  it("is refused while they are booked on a shift that hasn't ended; nothing changes", async () => {
    const t = await everything();
    const next = await t.b.shift({ startsAt: hoursFromNow(-2), hours: 8 }); // on now
    await t.b.booking(t.worker, next, "confirmed");
    expect(await eraseWorker(ctx(t.b, t.admin), t.worker)).toEqual({
      status: "booked",
      name: "Ann Booker",
      upcoming: 1,
    });
    expect(await workerDataSummary(ctx(t.b, t.admin), t.worker)).toMatchObject({
      name: "Ann Booker",
      upcoming: 1,
      erasedAt: null,
    });
    expect(await count("credentials", "worker_id = $1", [t.worker])).toBe(2);
    expect(await count("events", "firm_id = $1 and action = 'worker.erased'", [t.b.firmId])).toBe(
      0,
    );
  });

  it("removes their personal details and keeps the anonymous evidence", async () => {
    const t = await everything();
    // A shift still ahead whose sheet names they were taken off (the sheet hasn't caught up yet):
    // its merge base keeps the id, so the next sync still writes the sheet back (the reviews).
    const ahead = await t.b.shift({ startsAt: hoursFromNow(72) });
    await su.query("update shifts set synced_holders = array['STAFF-1'] where id = $1", [ahead]);
    // Their staff photo (12F.2): three bytes stand in for the image.
    await su.query(
      `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data)
       values ($1, $2, 'photo', 'image/jpeg', 3, encode(sha256('\\xffd8ff'::bytea), 'hex'),
               '\\xffd8ff'::bytea)`,
      [t.b.firmId, t.worker],
    );
    const result = await eraseWorker(ctx(t.b, t.admin), t.worker);
    const counts = {
      licences: 2,
      loginLinks: 1,
      sessions: 1,
      devices: 1,
      daysUnavailable: 1,
      siteBlocks: 1,
      travelArea: 1,
      messages: 4,
      requests: 3,
      payQueries: 1,
      cancelReasons: 1,
      overrideReasons: 1,
      sheetMentions: 1,
      withdrawalReasons: 0, // no strike withdrawn (12C.5: tests/integration/strikes.page.test.ts)
      images: 1, // their staff photo (12F.2)
    };
    expect(result).toEqual({ status: "erased", name: "Ann Booker", counts });
    expect(
      (await su.query("select 1 from uploads where worker_id = $1", [t.worker])).rowCount,
    ).toBe(0);
    // The office's words about them are replaced; the booking still says there was a reason. Their
    // staff id is out of our copy of the sheet's names (audit L30, L85, L86).
    const { rows: placed } = await su.query(
      `select a.override_reason, s.synced_holders from assignments a
         join shifts s on s.id = a.shift_id where a.id = $1`,
      [t.ids.booking],
    );
    expect(placed).toEqual([
      { override_reason: "Reason deleted with the worker's details", synced_holders: ["STAFF-9"] },
    ]);
    const { rows: stillAhead } = await su.query("select synced_holders from shifts where id = $1", [
      ahead,
    ]);
    expect(stillAhead).toEqual([{ synced_holders: ["STAFF-1"] }]);

    const { rows: w } = await su.query(
      `select first_name, last_name, mobile_e164, email, external_ref, roles, status,
              sms_opted_out_at, erased_at from workers where id = $1`,
      [t.worker],
    );
    expect(w[0]).toEqual({
      first_name: "Deleted",
      last_name: "worker",
      mobile_e164: null,
      email: null,
      external_ref: null,
      roles: [],
      status: "inactive",
      sms_opted_out_at: null,
      erased_at: expect.any(Date),
    });
    for (const table of [
      "credentials",
      "magic_links",
      "sessions",
      "push_subscriptions",
      "worker_unavailable_days",
      "worker_site_blocks",
      "worker_travel",
    ]) {
      expect(await count(table, "worker_id = $1", [t.worker]), table).toBe(0);
    }
    expect(await count("otp_codes", "firm_id = $1", [t.b.firmId])).toBe(0);
    const left = await su.query<{ id: string }>(
      "select id::text from messages where firm_id = $1 order by id",
      [t.b.firmId],
    );
    expect(left.rows.map((r) => r.id).sort()).toEqual(
      [t.ids.colleagueMessage, t.ids.strangerMessage].sort(),
    );

    // The free text is gone; the requests and queries themselves stay.
    const { rows: reqs } = await su.query<{ id: string; payload: unknown; note: string | null }>(
      "select id::text, payload, resolution_note as note from requests where worker_id = $1",
      [t.worker],
    );
    expect(Object.fromEntries(reqs.map((r) => [r.id, [r.payload, r.note]]))).toEqual({
      [t.ids.question]: [{ via: "whatsapp" }, null],
      [t.ids.timeChange]: [{ start: "10:00", end: "18:00" }, null],
      [t.ids.swap]: [{}, null],
    });
    const { rows: pq } = await su.query(
      "select details, resolution_note, status from pay_queries where id = $1",
      [t.ids.payQuery],
    );
    expect(pq[0]).toEqual({ details: null, resolution_note: null, status: "resolved" });

    // The evidence stays, pointing at the anonymous row.
    const { rows: evidence } = await su.query(
      `select (select count(*)::int from assignments where worker_id = $1) as bookings,
              (select cancel_reason from assignments where id = $2) as reason,
              (select cancel_reason from assignments where id = $6) as firm_reason,
              (select notice_hours::text from assignments where id = $2) as notice,
              (select count(*)::int from offers where worker_id = $1) as offers,
              (select count(*)::int from shift_reminders where id = $3) as reminders,
              (select count(*)::int from pay_records where worker_id = $1) as pay,
              (select count(*)::int from events where firm_id = $4
                 and id = any($5::bigint[])) as events`,
      [
        t.worker,
        t.ids.cancelled,
        t.ids.reminder,
        t.b.firmId,
        [t.events.added, t.events.assigned, t.events.login, t.events.answered, t.events.warned],
        t.ids.firmCancelled,
      ],
    );
    // Their typed reason is gone (the kind of reason stays); the office's fixed words stay.
    expect(evidence[0]).toEqual({
      bookings: 3,
      reason: "Something else",
      firm_reason: "The client needs fewer staff",
      notice: "20.00",
      offers: 1,
      reminders: 1,
      pay: 1,
      events: 5,
    });

    // The colleague is untouched.
    expect(await count("credentials", "worker_id = $1", [t.colleague])).toBe(2);
    expect(await count("workers", "id = $1 and first_name = 'Cara'", [t.colleague])).toBe(1);

    // Logged with the counts only.
    const { rows: logged } = await su.query(
      `select actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action = 'worker.erased'`,
      [t.b.firmId],
    );
    expect(logged).toEqual([
      {
        actor_type: "office",
        actor_id: t.admin,
        entity_id: t.worker,
        data: { workerId: t.worker, ...counts },
      },
    ]);
  });

  it("a second time says already; their export then holds nothing personal", async () => {
    const t = await everything();
    await eraseWorker(ctx(t.b, t.admin), t.worker);
    expect(await eraseWorker(ctx(t.b, t.admin), t.worker)).toEqual({ status: "already" });
    const after = await exported(t);
    for (const gone of [
      "Ann",
      t.mobile,
      "ann.booker@example.com",
      "STAFF-1",
      "1234-5678-9012",
      "Can I swap",
      "School run",
      "chemo",
      "Cara",
      "Missing 2 hours",
      "HYPERLINK",
      "shifts line?",
    ]) {
      expect(after.body, gone).not.toContain(gone);
    }
    expect(await workerDataSummary(ctx(t.b, t.admin), t.worker)).toMatchObject({
      name: "Deleted worker",
      mobile: null,
      erasedAt: expect.any(Date),
    });
  });

  it("admins only; another firm's worker is not found", async () => {
    const t = await everything();
    for (const who of [t.resourcer, t.payroll]) {
      expect(await eraseWorker(ctx(t.b, who), t.worker)).toEqual({ status: "not_allowed" });
    }
    const other = await createTenant(su);
    expect(await eraseWorker(ctx(t.b, t.admin), other.workerId)).toEqual({
      status: "not_found",
    });
    expect(await count("workers", "id = $1 and erased_at is null", [other.workerId])).toBe(1);
    expect(await count("workers", "id = $1 and erased_at is null", [t.worker])).toBe(1);
  });

  it("an answer queued for them before the deletion is never sent", async () => {
    const t = await everything();
    await eraseWorker(ctx(t.b, t.admin), t.worker);
    const sent: OutboundMessage[] = [];
    const task = createRequestUpdateTask(() => ({
      transport: {
        name: "capture",
        async send(m) {
          sent.push(m);
          return { providerMessageId: `id-${sent.length}` };
        },
      },
      push: {
        name: "none",
        async send() {
          return { status: "skipped" as const };
        },
      },
      clock,
    }));
    const outcome = await runFirmTask(
      task,
      {
        id: "job",
        data: {
          firmId: t.b.firmId,
          idempotencyKey: `request-update:${t.ids.question}`,
          requestId: t.ids.question,
        },
      },
      withFirm,
    );
    expect(outcome).toMatchObject({ status: "completed" });
    expect(sent).toEqual([]);
  });
});

describe("offers written after the list was read", () => {
  it("skip anyone erased or made inactive since (lockReachableWorkers)", async () => {
    const t = await everything();
    const idle = await t.b.worker({ first: "Ida", status: "inactive" });
    await eraseWorker(ctx(t.b, t.admin), t.worker);
    const reachable = await withFirm(t.b.firmId, (tx) =>
      lockReachableWorkers(tx, [t.worker, t.colleague, idle]),
    );
    expect([...reachable]).toEqual([t.colleague]);
  });
});

describe("a change notice queued before an erasure", () => {
  it("is skipped and logged as erased; nothing is sent", async () => {
    const t = await everything();
    // Two places: "fewer staff" can't take a shift's last place (Phase 10 task 19).
    const soon = await t.b.shift({ startsAt: hoursFromNow(30), headcount: 2 });
    await t.b.booking(t.worker, soon, "confirmed");
    expect(
      await cancelBookingByOffice(ctx(t.b, t.admin), soon, t.worker, "fewer_staff"),
    ).toMatchObject({ status: "cancelled" });
    expect(await eraseWorker(ctx(t.b, t.admin), t.worker)).toMatchObject({ status: "erased" });
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [FIRM_CHANGE_NOTICE_QUEUE, t.b.firmId],
    );
    expect(rows).toHaveLength(1);
    const sent: OutboundMessage[] = [];
    const deps = (): NoticeDeps => ({
      transport: {
        name: "capture",
        async send(m) {
          sent.push(m);
          return { providerMessageId: `id-${sent.length}` };
        },
      },
      push: {
        name: "none",
        async send() {
          return { status: "skipped" as const };
        },
      },
      baseDomain: "localhost:3000",
      clock,
    });
    await runFirmTask(
      createFirmChangeNoticeTask(deps),
      { id: "job", data: rows[0]?.data ?? {} },
      withFirm,
    );
    expect(sent).toEqual([]);
    const { rows: logged } = await su.query(
      `select data ->> 'reason' as reason from events
        where firm_id = $1 and action = 'shift.change_notice_skipped'`,
      [t.b.firmId],
    );
    expect(logged).toEqual([{ reason: "erased" }]);
  });
});

describe("the database holds an erased row to exactly that", () => {
  it("no mobile only when erased; erased only with everything personal gone", async () => {
    const t = await everything();
    await expect(
      su.query("update workers set mobile_e164 = null where id = $1", [t.worker]),
    ).rejects.toThrow(/workers_erased/);
    await expect(
      su.query("update workers set erased_at = now() where id = $1", [t.worker]),
    ).rejects.toThrow(/workers_erased/);
    await expect(
      su.query(
        `update workers set erased_at = now(), mobile_e164 = null, email = null, external_ref = null,
                first_name = 'Ann', last_name = 'worker', status = 'inactive', roles = '{}'
          where id = $1`,
        [t.worker],
      ),
    ).rejects.toThrow(/workers_erased/);
    await eraseWorker(ctx(t.b, t.admin), t.worker);
    await expect(
      su.query("update workers set status = 'active' where id = $1", [t.worker]),
    ).rejects.toThrow(/workers_erased/);
  });
});

describe("app_erase_worker, the owner-run half of an erasure", () => {
  it("takes only a worker (the number is the one their row held); refuses no firm, another firm's worker, and a second go", async () => {
    const t = await everything();
    const viaApp = async (firmId: string | null, worker: string) => {
      const client = await app.connect();
      try {
        await client.query("begin");
        if (firmId)
          await client.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
        const { rows } = await client.query<{ n: number }>(
          "select app_erase_worker($1::uuid) as n",
          [worker],
        );
        await client.query("commit");
        return rows[0]?.n;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    };
    const { rows: args } = await su.query<{ args: string }>(
      "select pg_get_function_arguments('app_erase_worker(uuid)'::regprocedure) as args",
    );
    expect(args[0]?.args).toBe("p_worker uuid");
    await expect(viaApp(null, t.worker)).rejects.toThrow(/needs a firm/);
    // From another firm, the worker is invisible.
    const other = await createTenant(su);
    await expect(viaApp(other.firmId, t.worker)).rejects.toThrow(/no worker to erase/);
    expect(await count("messages", "firm_id = $1", [t.b.firmId])).toBe(6);
    // In their own firm: their four messages go, the colleague's and the stranger's stay.
    expect(await viaApp(t.b.firmId, t.worker)).toBe(4);
    expect(await count("messages", "firm_id = $1", [t.b.firmId])).toBe(2);
    await expect(viaApp(t.b.firmId, t.worker)).rejects.toThrow(/no worker to erase/);
  });
});
