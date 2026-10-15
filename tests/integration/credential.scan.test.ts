import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyCredentialPack } from "@/lib/credentials/apply-pack";
import {
  CREDENTIAL_SCAN_CRON,
  CREDENTIAL_SCAN_QUEUE,
  CREDENTIAL_SCAN_TICK_QUEUE,
  CREDENTIAL_SCAN_TZ,
  credentialScanTask,
  runCredentialScanTick,
  scanCredentials,
  type CredentialScanDeps,
} from "@/lib/credentials/scan";
import { createFirmIdLister } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runImport } from "@/lib/imports/import";
import { readTable } from "@/lib/imports/table";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { WEEKLY_LIST_MAX_LINES } from "@/lib/messaging/templates";
import {
  outboundMessageSchema,
  type MessagingTransport,
  type OutboundMessage,
} from "@/lib/messaging/transport";
import { checkEligibility } from "@/lib/rules/eligibility";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { captureTransport } from "../helpers/auth";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";

// The daily credential expiry scan on the real database, as the app role: warnings at 30, 14 and
// 7 days, expiry the day after the date, the office's Monday list, the tick and the wiring.
// Messages go to a capturing transport; nothing is sent anywhere.

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

// 08:00 in London (BST) on Monday 5 October 2026, and the same time on the Tuesday.
const MONDAY = new Date("2026-10-05T07:00:00Z");
const TUESDAY = new Date("2026-10-06T07:00:00Z");
const TUESDAY_DATE = "2026-10-06";
const at = (d: Date) => ({ now: () => d });

async function newFirm(name = "Scan Test") {
  const slug = uniqueSlug("x");
  const { rows } = await su.query<{ id: string }>(
    "insert into firms (name, slug, sector) values ($1, $2, 'security') returning id::text as id",
    [`${name} ${slug}`, slug],
  );
  const firmId = rows[0]?.id ?? "";
  await withFirm(firmId, (tx) => applyCredentialPack(tx, "security", { type: "system" }));
  return { firmId, name: `${name} ${slug}`, slug };
}

let mobiles = 0;
async function addWorker(
  firmId: string,
  opts: {
    first?: string;
    last?: string;
    status?: "active" | "inactive" | "blocked";
    ref?: string;
    roles?: string[];
  } = {},
) {
  mobiles += 1;
  const mobile = `+447700900${String(mobiles).padStart(3, "0")}`;
  const { rows } = await su.query<{ id: string }>(
    `insert into workers (firm_id, first_name, last_name, mobile_e164, status, external_ref, roles)
     values ($1, $2, $3, $4, $5, $6, $7) returning id::text as id`,
    [
      firmId,
      opts.first ?? "Sam",
      opts.last ?? "Carter",
      mobile,
      opts.status ?? "active",
      opts.ref ?? null,
      opts.roles ?? [],
    ],
  );
  return { id: rows[0]?.id ?? "", mobile };
}

async function addCredential(
  firmId: string,
  workerId: string,
  c: {
    type: string;
    expiresOn: string | null;
    status?: string;
    warnedFor?: string;
    warnedDays?: number;
  },
) {
  const { rows } = await su.query<{ id: string }>(
    `insert into credentials (firm_id, worker_id, type, expires_on, status, expiry_warned_for, expiry_warned_days)
     values ($1, $2, $3, $4, $5, $6, $7) returning id::text as id`,
    [
      firmId,
      workerId,
      c.type,
      c.expiresOn,
      c.status ?? "valid",
      c.warnedFor ?? null,
      c.warnedDays ?? null,
    ],
  );
  const id = rows[0]?.id ?? "";
  // Warned already: by an earlier scan, which logged it (the scan sets these columns only with its
  // event; a warning with none is one a stopped run claimed, and is caught up as unconfirmed).
  if (c.warnedFor && c.warnedDays !== undefined) {
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data, created_at)
       values ($1, 'system', 'credential.expiry_warning', 'credential', $2, $3, '2026-09-01T08:00:00Z')`,
      [
        firmId,
        id,
        JSON.stringify({
          type: c.type,
          expiresOn: c.warnedFor,
          days: c.warnedDays,
          channel: "whatsapp",
          providerMessageId: "earlier",
        }),
      ],
    );
  }
  return id;
}

async function addOfficeUser(
  firmId: string,
  email: string,
  role: "admin" | "resourcer" | "payroll",
  status: "active" | "disabled" = "active",
): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into office_users (firm_id, email, name, role, status)
     values ($1, $2, 'Office Person', $3, $4) returning id::text as id`,
    [firmId, email, role, status],
  );
  return rows[0]?.id ?? "";
}

const credentialRow = async (id: string) =>
  (
    await su.query(
      `select status, expires_on::text as "expiresOn", expiry_warned_for::text as "warnedFor",
              expiry_warned_days as "warnedDays"
         from credentials where id = $1`,
      [id],
    )
  ).rows[0];

const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ entity_id: string | null; data: Record<string, unknown> }>(
      "select entity_id::text, data from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows;

// The reminders link to the casual's upload page on the firm's portal (12F.2).
const BASE_DOMAIN = "localhost:3000";
const uploadLink = (f: { slug: string }, type: string) =>
  `http://${f.slug}.${BASE_DOMAIN}/profile/upload/${type}`;

// The scan is for the date in its payload (the firm's local date when the tick ran).
function scanner() {
  const { transport, sent } = captureTransport();
  const deps: CredentialScanDeps = { transport, baseDomain: BASE_DOMAIN };
  const scan = (firmId: string, date: string) =>
    scanCredentials({ firmId, idempotencyKey: `credential-scan:${date}` }, withFirm, deps);
  return { scan, sent };
}

const whatsapp = (sent: OutboundMessage[]) =>
  sent.filter((m) => m.channel === "whatsapp").map((m) => ({ to: m.to, body: m.body }));

describe("credential-scan: warnings", () => {
  it("one only the office records (CSAS) says to send it to the office, with no upload link (12F.2)", async () => {
    const f = await newFirm();
    const cas = await addWorker(f.firmId, { first: "Cas", roles: ["csas_officer"] });
    await addCredential(f.firmId, cas.id, { type: "CSAS", expiresOn: "2026-11-05" }); // 30 days
    const { scan, sent } = scanner();
    expect(await scan(f.firmId, TUESDAY_DATE)).toMatchObject({ warned: 1 });
    expect(whatsapp(sent)).toEqual([
      {
        to: cas.mobile,
        body: `Your CSAS accreditation expires on 5 Nov. Renew it and send the new details to the office so you can keep taking shifts. — ${f.name} Shift Team`,
      },
    ]);
  });

  it("warns active workers once per threshold crossed, and logs each warning", async () => {
    const f = await newFirm();
    // A door supervisor: the security pack's rules need SIA_DS for that role, not first aid, so only
    // the licence's reminder links to her upload page (12F.2).
    const sam = await addWorker(f.firmId, { roles: ["door_supervisor"] });
    const left = await addWorker(f.firmId, { first: "Lee", status: "inactive" });
    const door = await addCredential(f.firmId, sam.id, { type: "SIA_DS", expiresOn: "2026-11-05" }); // 30 days
    const aid = await addCredential(f.firmId, sam.id, {
      type: "FIRST_AID",
      expiresOn: "2026-10-11",
    }); // 5 days: one 7-day warning, not three
    const far = await addCredential(f.firmId, sam.id, { type: "SIA_SG", expiresOn: "2026-11-06" }); // 31 days
    const forever = await addCredential(f.firmId, sam.id, { type: "STEWARD_L2", expiresOn: null });
    const applied = await addCredential(f.firmId, sam.id, {
      type: "SIA_CP",
      expiresOn: "2026-10-12",
      status: "applied",
    });
    const leaver = await addCredential(f.firmId, left.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-13",
    });

    const first = scanner();
    expect(await first.scan(f.firmId, TUESDAY_DATE)).toEqual({
      date: TUESDAY_DATE,
      warned: 2,
      expired: 0,
      failed: 0,
      weeklyList: "not_today",
    });
    const signOff = `${f.name} Shift Team`;
    expect(whatsapp(first.sent)).toEqual([
      {
        to: sam.mobile,
        body: `Your first aid at work certificate expires on 11 Oct. Renew it and send the new details to the office so you can keep taking shifts. — ${signOff}`,
      },
      {
        to: sam.mobile,
        body: `Your SIA door supervisor licence expires on 5 Nov. Upload your renewed card so you can keep taking shifts that need it: ${uploadLink(f, "SIA_DS")} — ${signOff}`,
      },
    ]);
    expect(await credentialRow(door)).toEqual({
      status: "valid",
      expiresOn: "2026-11-05",
      warnedFor: "2026-11-05",
      warnedDays: 30,
    });
    expect(await credentialRow(aid)).toMatchObject({ warnedFor: "2026-10-11", warnedDays: 7 });
    for (const untouched of [far, forever, applied, leaver]) {
      expect(await credentialRow(untouched)).toMatchObject({ warnedFor: null, warnedDays: null });
    }
    // Ids, types, dates and counts only: never a name or a number.
    expect(await eventsOf(f.firmId, "credential.expiry_warning")).toEqual([
      {
        entity_id: aid,
        data: {
          type: "FIRST_AID",
          expiresOn: "2026-10-11",
          days: 7,
          daysLeft: 5,
          channel: "whatsapp",
          providerMessageId: "capture-1",
        },
      },
      {
        entity_id: door,
        data: {
          type: "SIA_DS",
          expiresOn: "2026-11-05",
          days: 30,
          daysLeft: 30,
          channel: "whatsapp",
          providerMessageId: "capture-2",
        },
      },
    ]);

    // Run again the same day (a retry, a second tick): nothing more.
    const again = scanner();
    expect(await again.scan(f.firmId, TUESDAY_DATE)).toMatchObject({ warned: 0, expired: 0 });
    expect(again.sent).toEqual([]);
    expect(await eventsOf(f.firmId, "credential.expiry_warning")).toHaveLength(2);

    // 16 days on (Thursday 22 Oct), the door licence has crossed 14 days: its 14-day warning. The
    // first aid certificate expired on the 11th, and the leaver's licence on the 13th (marked
    // expired too, without a message).
    const later = scanner();
    expect(await later.scan(f.firmId, "2026-10-22")).toMatchObject({ warned: 2, expired: 2 });
    expect(await credentialRow(door)).toMatchObject({ warnedDays: 14 });
    expect(await credentialRow(far)).toMatchObject({ warnedDays: 30 }); // 15 days: its first
    expect(await credentialRow(aid)).toMatchObject({ status: "expired" });
    expect(await credentialRow(leaver)).toMatchObject({ status: "expired", warnedDays: null });
    expect(whatsapp(later.sent).map((m) => m.to)).toEqual([sam.mobile, sam.mobile, sam.mobile]);
  });

  it("starts the warnings again when a credential is renewed with a new expiry date", async () => {
    const f = await newFirm();
    const sam = await addWorker(f.firmId);
    // All three warnings went out for the old date; the office has since recorded a new one.
    const renewed = await addCredential(f.firmId, sam.id, {
      type: "SIA_DS",
      expiresOn: "2026-11-01",
      warnedFor: "2026-09-30",
      warnedDays: 7,
    });
    const { scan, sent } = scanner();
    expect(await scan(f.firmId, TUESDAY_DATE)).toMatchObject({ warned: 1 });
    expect(await credentialRow(renewed)).toMatchObject({
      warnedFor: "2026-11-01",
      warnedDays: 30,
    });
    expect(whatsapp(sent)[0]?.body).toContain("expires on 1 Nov");
  });
});

describe("credential-scan: expiry (block on expiry)", () => {
  const shiftOn = (date: string) => ({
    startsAt: new Date(`${date}T08:00:00Z`),
    endsAt: new Date(`${date}T16:00:00Z`),
  });
  const eligible = (
    now: Date,
    credentials: { type: string; status: string; expiresOn: string | null }[],
    shiftDate: string,
  ) =>
    checkEligibility({
      now,
      timeZone: "Europe/London",
      worker: { id: "w1", status: "active", roles: ["door_supervisor"] },
      credentials: credentials.map((c) => ({
        ...c,
        status: c.status as "valid" | "expired" | "applied" | "suspended",
      })),
      shift: {
        id: "s1",
        role: "door_supervisor",
        siteId: null,
        requiredTypes: ["SIA_DS"],
        extraTypes: [],
        ...shiftOn(shiftDate),
      },
      otherAssignments: [],
      unavailableDates: [],
      settings: {
        minRestHours: 11,
        weeklyHoursCap: 48,
        travelBufferMinutes: 0,
        appliedAllowancePct: 0,
        appliedAllowedTypes: [],
        appliedInUseCount: 0,
        deployedCount: 0,
        blockedSites: [],
      },
    });
  const credsOf = async (workerId: string) =>
    (
      await su.query<{ type: string; status: string; expiresOn: string | null }>(
        `select type, status, expires_on::text as "expiresOn" from credentials where worker_id = $1`,
        [workerId],
      )
    ).rows;

  it("marks a credential expired the day after its date (not on it) and tells the worker", async () => {
    const f = await newFirm();
    const sam = await addWorker(f.firmId, { roles: ["door_supervisor"] });
    const left = await addWorker(f.firmId, { first: "Lee", status: "inactive" });
    // Every warning already sent for each, so only expiry is left to do.
    const warned = (expiresOn: string) => ({ expiresOn, warnedFor: expiresOn, warnedDays: 7 });
    const yesterday = await addCredential(f.firmId, sam.id, {
      type: "SIA_DS",
      ...warned("2026-10-05"),
    });
    const today = await addCredential(f.firmId, sam.id, {
      type: "FIRST_AID",
      ...warned(TUESDAY_DATE),
    });
    const leaversExpired = await addCredential(f.firmId, left.id, {
      type: "SIA_DS",
      ...warned("2026-09-01"),
    });

    // Before the scan runs, the rules engine already refuses the licence by its date: blocking
    // never waits for the job.
    const before = eligible(TUESDAY, await credsOf(sam.id), "2026-10-08");
    expect(before.ok).toBe(false);
    expect(before.codes).toContain("credential_expired");

    const { scan, sent } = scanner();
    expect(await scan(f.firmId, TUESDAY_DATE)).toMatchObject({ warned: 0, expired: 2 });
    expect(await credentialRow(yesterday)).toMatchObject({ status: "expired" });
    expect(await credentialRow(today)).toMatchObject({ status: "valid" }); // in date today
    expect(await credentialRow(leaversExpired)).toMatchObject({ status: "expired" });
    // Only the active worker is messaged.
    expect(whatsapp(sent)).toEqual([
      {
        to: sam.mobile,
        body: `Your SIA door supervisor licence expired on 5 Oct. You can't take shifts that need it until you upload your renewed card and the office checks it: ${uploadLink(f, "SIA_DS")} — ${f.name} Shift Team`,
      },
    ]);
    const logged = await eventsOf(f.firmId, "credential.expired");
    expect(logged).toEqual(
      expect.arrayContaining([
        {
          entity_id: yesterday,
          data: { type: "SIA_DS", expiresOn: "2026-10-05", notified: true },
        },
        {
          entity_id: leaversExpired,
          data: { type: "SIA_DS", expiresOn: "2026-09-01", notified: false },
        },
      ]),
    );
    expect(logged).toHaveLength(2);
    // The message's outcome is its own event (claim → send → record): only for the one told.
    expect(await eventsOf(f.firmId, "credential.expiry_notice_sent")).toEqual([
      {
        entity_id: yesterday,
        data: {
          type: "SIA_DS",
          expiresOn: "2026-10-05",
          channel: "whatsapp",
          providerMessageId: "capture-1",
        },
      },
    ]);

    // After it: still blocked, now by the status too, with no date needed.
    const after = eligible(TUESDAY, await credsOf(sam.id), "2026-10-08");
    expect(after.ok).toBe(false);
    expect(after.codes).toContain("credential_expired");

    // Never twice.
    const again = scanner();
    expect(await again.scan(f.firmId, TUESDAY_DATE)).toMatchObject({ expired: 0 });
    expect(again.sent).toEqual([]);
  });

  it("two scans at once for the same firm send each message once", async () => {
    const f = await newFirm();
    const sam = await addWorker(f.firmId);
    await addCredential(f.firmId, sam.id, { type: "SIA_DS", expiresOn: "2026-10-12" });
    await addCredential(f.firmId, sam.id, {
      type: "FIRST_AID",
      expiresOn: "2026-10-01",
      warnedFor: "2026-10-01",
      warnedDays: 7,
    });
    const a = scanner();
    const b = scanner();
    const results = await Promise.all([
      a.scan(f.firmId, TUESDAY_DATE),
      b.scan(f.firmId, TUESDAY_DATE),
    ]);
    // One scan per firm at a time: one does all the work; the other waits for the firm's lock,
    // then finds everything claimed and logged. (Without the lock they split it, and the later one
    // logs the other's warning, still being sent, as unconfirmed.)
    expect(results.map((r) => r.warned + r.expired).sort()).toEqual([0, 2]);
    expect([a.sent.length, b.sent.length].sort()).toEqual([0, 2]);
    const warnings = await eventsOf(f.firmId, "credential.expiry_warning");
    // This scan's licence warning once (the first aid one is an earlier scan's), and nothing
    // caught up as unconfirmed.
    expect(warnings.filter((e) => e.data.type === "SIA_DS")).toHaveLength(1);
    expect(warnings.filter((e) => e.data.unconfirmed)).toEqual([]);
    expect(await eventsOf(f.firmId, "credential.expired")).toHaveLength(1);
  });
});

describe("credential-scan: the office's Monday list", () => {
  it("emails active admins and resourcers once on Monday, and logs counts only", async () => {
    const f = await newFirm();
    await addOfficeUser(f.firmId, "admin@example.com", "admin");
    await addOfficeUser(f.firmId, "rota@example.com", "resourcer");
    await addOfficeUser(f.firmId, "pay@example.com", "payroll");
    await addOfficeUser(f.firmId, "gone@example.com", "admin", "disabled");
    const sam = await addWorker(f.firmId, { first: "Sam", last: "Carter" });
    const jo = await addWorker(f.firmId, { first: "Jo", last: "Patel" });
    const left = await addWorker(f.firmId, { first: "Lee", last: "Ward", status: "inactive" });
    await addCredential(f.firmId, sam.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-15",
      warnedFor: "2026-10-15",
      warnedDays: 14,
    });
    await addCredential(f.firmId, jo.id, {
      type: "FIRST_AID",
      expiresOn: "2026-10-02",
      status: "expired",
    });
    await addCredential(f.firmId, jo.id, {
      type: "SIA_SG",
      expiresOn: "2026-09-20",
      status: "expired",
    }); // over a week ago: not listed
    await addCredential(f.firmId, jo.id, { type: "SIA_CP", expiresOn: "2026-12-01" }); // too far off
    await addCredential(f.firmId, left.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-10",
      warnedFor: "2026-10-10",
      warnedDays: 7,
    }); // not an active worker

    const monday = scanner();
    expect(await monday.scan(f.firmId, "2026-10-05")).toEqual({
      date: "2026-10-05",
      warned: 0,
      expired: 0,
      failed: 0,
      weeklyList: "sent",
    });
    const emails = monday.sent.filter((m) => m.channel === "email");
    expect(emails.map((m) => m.to)).toEqual(["admin@example.com", "rota@example.com"]);
    expect(emails[0]).toMatchObject({
      subject: `${f.name}: credentials expiring soon`,
      body: [
        "Expiring in the next 30 days:",
        "- Sam Carter: SIA door supervisor licence, expires 15 Oct",
        "",
        "Expired in the last week (these people can't take shifts that need them):",
        "- Jo Patel: first aid at work certificate, expired 2 Oct",
        "",
        "When someone sends you their new details, record the new expiry date so they can take shifts again.",
        "",
        `— ${f.name} Shift Team`,
      ].join("\n"),
    });
    expect((await eventsOf(f.firmId, "credential.weekly_list_sent")).map((e) => e.data)).toEqual([
      { date: "2026-10-05", recipients: 2, skipped: 0, expiring: 1, expired: 1 },
    ]);

    // Once a day: a second Monday run sends nothing. Other days: no list.
    const again = scanner();
    expect(await again.scan(f.firmId, "2026-10-05")).toMatchObject({ weeklyList: "already_sent" });
    expect(again.sent).toEqual([]);
    expect(await scanner().scan(f.firmId, TUESDAY_DATE)).toMatchObject({
      weeklyList: "not_today",
    });
  });

  it("sends nothing when there is nothing to list, or nobody to send it to", async () => {
    const quiet = await newFirm();
    await addOfficeUser(quiet.firmId, "admin@example.com", "admin");
    const sam = await addWorker(quiet.firmId);
    await addCredential(quiet.firmId, sam.id, { type: "SIA_DS", expiresOn: "2027-06-01" });
    const q = scanner();
    expect(await q.scan(quiet.firmId, "2026-10-05")).toMatchObject({
      weeklyList: "nothing_to_list",
    });
    expect(q.sent).toEqual([]);

    const payrollOnly = await newFirm();
    await addOfficeUser(payrollOnly.firmId, "pay@example.com", "payroll");
    const jo = await addWorker(payrollOnly.firmId);
    await addCredential(payrollOnly.firmId, jo.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-15",
      warnedFor: "2026-10-15",
      warnedDays: 14,
    });
    const p = scanner();
    expect(await p.scan(payrollOnly.firmId, "2026-10-05")).toMatchObject({
      weeklyList: "no_recipients",
    });
    expect(p.sent).toEqual([]);
    expect(await eventsOf(payrollOnly.firmId, "credential.weekly_list_sent")).toEqual([]);
  });
});

describe("credential-scan: one firm at a time", () => {
  it("a firm's scan never reads, changes or messages another firm's people", async () => {
    const mine = await newFirm("Mine");
    const theirs = await newFirm("Theirs");
    await addOfficeUser(mine.firmId, "admin@example.com", "admin");
    await addOfficeUser(theirs.firmId, "admin@example.com", "admin");
    const sam = await addWorker(mine.firmId, { first: "Sam" });
    const kit = await addWorker(theirs.firmId, { first: "Kit", last: "Other" });
    await addCredential(mine.firmId, sam.id, { type: "SIA_DS", expiresOn: "2026-10-12" });
    const warnTheirs = await addCredential(theirs.firmId, kit.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-12",
    });
    const expireTheirs = await addCredential(theirs.firmId, kit.id, {
      type: "FIRST_AID",
      expiresOn: "2026-10-01",
    });

    const { scan, sent } = scanner();
    expect(await scan(mine.firmId, "2026-10-05")).toMatchObject({ warned: 1, expired: 0 });
    expect(sent.map((m) => m.to)).toEqual([sam.mobile, "admin@example.com"]);
    const listed = sent.find((m) => m.channel === "email");
    expect(listed?.body).not.toContain("Kit");
    expect(await credentialRow(warnTheirs)).toMatchObject({ warnedDays: null });
    expect(await credentialRow(expireTheirs)).toMatchObject({ status: "valid" });
    const { rows } = await su.query(
      "select count(*)::int as n from events where firm_id = $1 and action like 'credential.%'",
      [theirs.firmId],
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe("credential-scan-tick and the job", () => {
  const queuedFor = async (firmId: string) =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
        [CREDENTIAL_SCAN_QUEUE, firmId],
      )
    ).rows.map((r) => r.data);

  it("queues one scan per firm for its local date, once a day", async () => {
    const a = await newFirm();
    const b = await newFirm();
    const tick = (now: Date) =>
      runCredentialScanTick({
        listFirmIds: createFirmIdLister(app),
        run: withFirm,
        clock: at(now),
      });
    await tick(MONDAY);
    for (const f of [a, b]) {
      expect(await queuedFor(f.firmId)).toEqual([
        { firmId: f.firmId, idempotencyKey: "credential-scan:2026-10-05" },
      ]);
    }
    // A second tick the same day queues nothing new; the next day's does.
    await tick(new Date("2026-10-05T12:00:00Z"));
    expect(await queuedFor(a.firmId)).toHaveLength(1);
    await tick(TUESDAY);
    expect((await queuedFor(a.firmId)).map((d) => d.idempotencyKey).sort()).toEqual([
      "credential-scan:2026-10-05",
      "credential-scan:2026-10-06",
    ]);
  });

  it("runs as a firm job: results are dates and counts, and a bad payload is dead-lettered", async () => {
    const f = await newFirm();
    const sam = await addWorker(f.firmId);
    await addCredential(f.firmId, sam.id, { type: "SIA_DS", expiresOn: "2026-10-12" });
    const { transport, sent } = captureTransport();
    const job = credentialScanTask(() => ({ transport, baseDomain: BASE_DOMAIN }));
    const ok = await runFirmTask(
      job,
      {
        id: "job-1",
        data: { firmId: f.firmId, idempotencyKey: `credential-scan:${TUESDAY_DATE}` },
      },
      withFirm,
    );
    expect(ok).toEqual({
      id: "job-1",
      status: "completed",
      output: { date: TUESDAY_DATE, warned: 1, expired: 0, failed: 0, weeklyList: "not_today" },
    });
    expect(sent).toHaveLength(1);
    const bad = await runFirmTask(
      job,
      { id: "job-2", data: { firmId: f.firmId, idempotencyKey: "free text" } },
      withFirm,
    );
    expect(bad).toMatchObject({ status: "deadletter", output: { error: "invalid_payload" } });
    const notADate = await runFirmTask(
      job,
      { id: "job-3", data: { firmId: f.firmId, idempotencyKey: "credential-scan:2026-02-30" } },
      withFirm,
    );
    expect(notADate).toMatchObject({ status: "deadletter" });
    expect(sent).toHaveLength(1);
  });

  it("the worker works both queues and schedules the tick daily at 08:00 London time", async () => {
    const calls: unknown[][] = [];
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string) => {
        calls.push(["work", name]);
        return "worker-id";
      },
      schedule: async (...args: unknown[]) => {
        calls.push(["schedule", ...args]);
      },
      unschedule: async (name: string) => {
        calls.push(["unschedule", name]);
      },
    } as unknown as PgBoss;
    await registerJobs(boss);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["work", CREDENTIAL_SCAN_QUEUE],
        ["work", CREDENTIAL_SCAN_TICK_QUEUE],
        ["schedule", CREDENTIAL_SCAN_TICK_QUEUE, "0 8 * * *", null, { tz: "Europe/London" }],
      ]),
    );
    expect([CREDENTIAL_SCAN_CRON, CREDENTIAL_SCAN_TZ]).toEqual(["0 8 * * *", "Europe/London"]);
    // A firm queue: the standard policy, so one firm's job never dedupes another's.
    expect(QUEUES.find((q) => q.name === CREDENTIAL_SCAN_QUEUE)?.options).toMatchObject({
      policy: "standard",
    });
  });
});

// From the guardrails review: failures and races that must not lose or repeat anything.
describe("credential-scan: failures and races", () => {
  it("a renewal imported while the scan is expiring the credential ends valid, with the new date", async () => {
    const f = await newFirm();
    const officeId = await addOfficeUser(f.firmId, "rota@example.com", "resourcer");
    const sam = await addWorker(f.firmId, { ref: "S1" });
    const licence = await addCredential(f.firmId, sam.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-05",
      warnedFor: "2026-10-05",
      warnedDays: 7,
    });
    // A transport that holds the scan's message (the row already claimed: marked expired and
    // committed, with no lock held while the message goes).
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered = () => {};
    const inSend = new Promise<void>((resolve) => (entered = resolve));
    const slow: MessagingTransport = {
      name: "slow",
      async send() {
        entered();
        await gate;
        return { providerMessageId: "slow-1" };
      },
    };
    const scan = scanCredentials(
      { firmId: f.firmId, idempotencyKey: `credential-scan:${TUESDAY_DATE}` },
      withFirm,
      { transport: slow, baseDomain: BASE_DOMAIN },
    );
    await inSend;
    const renewal = withFirm(f.firmId, (tx) =>
      runImport(tx, {
        kind: "credentials",
        rows: readTable(
          new TextEncoder().encode("Staff ID,Type,Number,Expires\nS1,SIA_DS,NEW-1,05/10/2029"),
        ),
        dryRun: false,
        actorId: officeId,
        timeZone: "Europe/London",
        now: TUESDAY,
      }),
    );
    // The renewal finishes while the scan's message is still going out: the scan holds no row lock
    // across a message (before Phase 10 the import waited for it), only the firm's scan lock,
    // which an import never takes.
    const timeout = new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 5000));
    expect(await Promise.race([renewal, timeout])).toMatchObject({ updated: 1 });
    release();
    expect(await scan).toMatchObject({ expired: 1 });
    expect(await credentialRow(licence)).toMatchObject({
      status: "valid",
      expiresOn: "2029-10-05",
    });
  });

  it("a list that can't be sent never undoes or repeats the workers' messages, and is logged", async () => {
    const f = await newFirm();
    await addOfficeUser(f.firmId, "admin@example.com", "admin");
    const sam = await addWorker(f.firmId);
    const licence = await addCredential(f.firmId, sam.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-12",
    });
    const whatsappSent: OutboundMessage[] = [];
    const emailDown: MessagingTransport = {
      name: "email-down",
      async send(message) {
        if (message.channel === "email") throw new Error("email is down");
        whatsappSent.push(message);
        return { providerMessageId: `ok-${whatsappSent.length}` };
      },
    };
    const payload = { firmId: f.firmId, idempotencyKey: "credential-scan:2026-10-05" };
    // The list's email fails: logged for that office user, and the scan still completes.
    expect(
      await scanCredentials(payload, withFirm, { transport: emailDown, baseDomain: BASE_DOMAIN }),
    ).toMatchObject({
      warned: 1,
      failed: 0,
      weeklyList: "sent",
    });
    // The worker's warning stands (marked and logged).
    expect(whatsappSent).toHaveLength(1);
    expect(await credentialRow(licence)).toMatchObject({ warnedDays: 7 });
    expect(await eventsOf(f.firmId, "credential.expiry_warning")).toHaveLength(1);
    // The list was claimed before its email (it may have gone): logged as sent, and the failure.
    expect(await eventsOf(f.firmId, "credential.weekly_list_sent")).toHaveLength(1);
    expect(
      (await eventsOf(f.firmId, "credential.weekly_list_failed")).map((e) => e.data.code),
    ).toEqual(["Error"]);

    // A retry sends nothing: neither the warning nor the list again.
    const retry = scanner();
    expect(await retry.scan(f.firmId, "2026-10-05")).toMatchObject({
      warned: 0,
      weeklyList: "already_sent",
    });
    expect(retry.sent).toEqual([]);
  });

  it("skips an office address the email can't go to, and still sends everyone else the list", async () => {
    const f = await newFirm();
    await addOfficeUser(f.firmId, "ops@localhost", "admin"); // the database accepts it; email can't
    await addOfficeUser(f.firmId, "rota@example.com", "resourcer");
    const sam = await addWorker(f.firmId);
    await addCredential(f.firmId, sam.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-15",
      warnedFor: "2026-10-15",
      warnedDays: 14,
    });
    const { scan, sent } = scanner();
    expect(await scan(f.firmId, "2026-10-05")).toMatchObject({ weeklyList: "sent" });
    expect(sent.map((m) => m.to)).toEqual(["rota@example.com"]);
    expect((await eventsOf(f.firmId, "credential.weekly_list_sent"))[0]?.data).toMatchObject({
      recipients: 1,
      skipped: 1,
    });
  });

  it("caps a long list, so the email always fits", async () => {
    const f = await newFirm();
    await addOfficeUser(f.firmId, "admin@example.com", "admin");
    const total = WEEKLY_LIST_MAX_LINES + 5;
    await su.query(
      `insert into workers (firm_id, first_name, last_name, mobile_e164)
       select $1, 'Worker', 'N' || lpad(g::text, 3, '0'), '+4477009' || lpad(g::text, 5, '0')
         from generate_series(1, $2::int) g`,
      [f.firmId, total],
    );
    await su.query(
      "update workers set first_name = repeat('A', 5000) where firm_id = $1 and last_name = 'N001'",
      [f.firmId],
    );
    await su.query(
      `insert into credentials (firm_id, worker_id, type, expires_on, expiry_warned_for, expiry_warned_days)
       select firm_id, id, 'SIA_DS', '2026-10-20', '2026-10-20', 30 from workers where firm_id = $1`,
      [f.firmId],
    );
    const { scan, sent } = scanner();
    expect(await scan(f.firmId, "2026-10-05")).toMatchObject({ warned: 0, weeklyList: "sent" });
    const [email] = sent;
    expect(email?.channel).toBe("email");
    const lines = (email?.body ?? "").split("\n");
    expect(lines.filter((l) => l.startsWith("- ") && l.includes(": SIA"))).toHaveLength(
      WEEKLY_LIST_MAX_LINES,
    );
    expect(lines).toContain("- and 5 more");
    expect(() => outboundMessageSchema.parse(email)).not.toThrow();
    expect(lines.every((l) => l.length <= 200)).toBe(true);
  });

  it("a renewal recorded as a new row: the old row gets no warning, message or listing", async () => {
    const f = await newFirm();
    await addOfficeUser(f.firmId, "admin@example.com", "admin");
    const sam = await addWorker(f.firmId);
    const oldLicence = await addCredential(f.firmId, sam.id, {
      type: "SIA_DS",
      expiresOn: "2026-10-09",
    });
    await addCredential(f.firmId, sam.id, { type: "SIA_DS", expiresOn: "2029-10-01" });
    const oldAid = await addCredential(f.firmId, sam.id, {
      type: "FIRST_AID",
      expiresOn: "2026-10-04",
      warnedFor: "2026-10-04",
      warnedDays: 7,
    });
    await addCredential(f.firmId, sam.id, { type: "FIRST_AID", expiresOn: null });

    const { scan, sent } = scanner();
    expect(await scan(f.firmId, "2026-10-05")).toEqual({
      date: "2026-10-05",
      warned: 0,
      expired: 1,
      failed: 0,
      weeklyList: "nothing_to_list",
    });
    expect(sent).toEqual([]);
    expect(await credentialRow(oldLicence)).toMatchObject({ status: "valid", warnedDays: null });
    expect(await credentialRow(oldAid)).toMatchObject({ status: "expired" });
    expect(await eventsOf(f.firmId, "credential.expired")).toEqual([
      {
        entity_id: oldAid,
        data: {
          type: "FIRST_AID",
          expiresOn: "2026-10-04",
          notified: false,
          superseded: true,
        },
      },
    ]);
  });

  it("the warning columns are set together or not at all", async () => {
    const f = await newFirm();
    const sam = await addWorker(f.firmId);
    const bad = [
      { warnedFor: null, warnedDays: 7 },
      { warnedFor: "2026-10-12", warnedDays: null },
      { warnedFor: "2026-10-12", warnedDays: 5 },
    ];
    for (const b of bad) {
      await expect(
        su.query(
          `insert into credentials (firm_id, worker_id, type, expires_on, expiry_warned_for, expiry_warned_days)
           values ($1, $2, 'SIA_DS', '2026-10-12', $3, $4)`,
          [f.firmId, sam.id, b.warnedFor, b.warnedDays],
        ),
      ).rejects.toThrow(/credentials_expiry_warned_days/);
    }
  });
});
