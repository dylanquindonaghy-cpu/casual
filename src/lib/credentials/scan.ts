import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import {
  credentialRules,
  credentials,
  credentialTypes,
  events,
  firms,
  officeUsers,
  workers,
} from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { getTransport, type MessagingTransport } from "../messaging";
import type { OutboundMessage } from "../messaging/transport";
import {
  credentialExpiredMessage,
  credentialExpiringMessage,
  credentialWeeklyListEmail,
  type FirmVoice,
} from "../messaging/templates";
import { casualMayUpload } from "../rules/packs";
import { shortDate } from "../rules/reasons";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { addDays, localDateOf } from "../time/zoned";
import { EXPIRING_SOON_DAYS, expiryAction, isWeeklyListDay } from "./expiry";

// The credential expiry jobs (docs/api-and-jobs.md, docs/rules-and-credentials.md "Expiry
// warnings"):
// - credential-scan-tick: a cron at 08:00 London time (no firm). Queues one credential-scan per
//   firm for the firm's local date.
// - credential-scan: one firm's scan for the date in its payload. It warns active workers by
//   WhatsApp at 30, 14 and 7 days (expiry.ts decides) and marks credentials expired the day after
//   their expiry date, telling the worker. Then, on Mondays, it emails active admins and resourcers
//   the week's list. Every change writes an event.
//
// At most once, like the notices (claim → send → record; no claim or outcome transaction is held
// across a message: the firm's scan lock is held by one that writes nothing, oneScanAtATime). Per
// credential: (1) a short transaction re-reads and locks the row, decides again, and
// claims it (the warning columns set, or the status set to expired with `credential.expired`
// logged), committed before anything is sent; (2) the WhatsApp, outside any transaction; (3) a
// short transaction logs credential.expiry_warning / credential.expiry_notice_sent, or
// credential.expiry_warning_failed / credential.expiry_notice_failed. The list: its event is the
// claim, written first; then one email per office user, a failure logged and the rest still sent.
// Safe to run twice: the warning columns, the status and the list's event all say what was already
// done, and a retry sends nothing for them (a message that may have gone is never sent again).
//
// Blocking never waits for this job: the rules engine refuses a credential whose date has passed
// whatever its status says. The scan makes the status match, so the office and the worker see it.

export const CREDENTIAL_SCAN_QUEUE = "credential-scan";
export const CREDENTIAL_SCAN_TICK_QUEUE = "credential-scan-tick";
// 08:00, outside the default quiet hours (22:00-07:00). A day the worker was down is caught up the
// next day: warnings go by thresholds crossed, not exact days.
export const CREDENTIAL_SCAN_CRON = "0 8 * * *";
export const CREDENTIAL_SCAN_TZ = "Europe/London";

const DAY_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = "credential-scan:";
// How long a scan waits for another scan of the same firm to finish (oneScanAtATime).
const SCAN_LOCK_WAIT = "5min";
// Names in the office list are cut to this length, so the email stays within its size limit.
const MAX_NAME_LENGTH = 80;

// The date the scan is for (the firm's local date when the tick ran) rides in the key, so a retry
// after midnight still scans for that day, and the job needs no clock.
export const credentialScanPayload = firmJobEnvelope.extend({
  idempotencyKey: z
    .string()
    .regex(/^credential-scan:\d{4}-\d{2}-\d{2}$/)
    .refine((key) => {
      const date = key.slice(KEY_PREFIX.length);
      return addDays(date, 0) === date;
    }, "a real calendar date"),
});
export type CredentialScanPayload = z.infer<typeof credentialScanPayload>;

export const credentialScanJob = { queue: CREDENTIAL_SCAN_QUEUE, schema: credentialScanPayload };

export interface CredentialScanDeps {
  transport: MessagingTransport;
  // The app's domain (APP_BASE_DOMAIN): the reminders link to the casual's upload page on their
  // firm's portal (12F.2).
  baseDomain: string;
}

export interface ScanResult {
  date: string;
  warned: number;
  expired: number;
  failed: number; // warnings or expiry messages that couldn't be sent (logged, not tried again)
  weeklyList: "sent" | "already_sent" | "nothing_to_list" | "no_recipients" | "not_today";
}

const WEEKLY_LIST_ACTION = "credential.weekly_list_sent";

export async function scanCredentials(
  payload: CredentialScanPayload,
  run: WithFirm,
  deps: CredentialScanDeps,
): Promise<ScanResult> {
  const today = payload.idempotencyKey.slice(KEY_PREFIX.length);
  // The Monday list stays outside: claimWeeklyList takes the same lock in its own transaction.
  const { warned, expired, failed } = await oneScanAtATime(run, payload.firmId, () =>
    warnAndExpire(run, payload.firmId, today, deps),
  );
  const weeklyList = isWeeklyListDay(today)
    ? await sendWeeklyList(run, payload.firmId, today, deps.transport)
    : "not_today";
  return { date: today, warned, expired, failed, weeklyList };
}

// One scan per firm at a time (a retry overlapping a slow run, say): the second waits here, then
// finds everything already marked and the weekly list's event already written.
async function lockFirmScan(tx: FirmTx): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('credential-scan:' || app_current_firm_id()::text, 0))`,
  );
}

// The warnings and expiries hold the firm's scan lock from the first read to the last outcome
// logged. So a claim with no outcome is only ever one a stopped run left (its connection, and the
// lock with it, gone), never one another scan is sending right now. (Without it, a second scan
// could lock a credential the first had claimed but not yet logged and log it as sent,
// unconfirmed, and the first's real outcome, its message id or its failure, was lost.) The lock is
// held by a transaction of its own that writes nothing; every claim and outcome still commits in
// its own short transaction, so nothing written is undone after a message went.
async function oneScanAtATime<T>(
  run: WithFirm,
  firmId: string,
  work: () => Promise<T>,
): Promise<T> {
  let release: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (release = resolve));
  let locked: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (locked = resolve));
  const holder = run(firmId, async (tx) => {
    // A scan stuck mid-send must not leave every later one waiting forever, each holding a
    // connection: after a few minutes the wait fails (nothing claimed yet), and pg-boss retries.
    await tx.execute(sql`select set_config('lock_timeout', ${SCAN_LOCK_WAIT}, true)`);
    await lockFirmScan(tx);
    locked();
    await finished;
  });
  // The holder failing before it has the lock (the database down, say) fails the scan.
  await Promise.race([held, holder]);
  try {
    // Outside the holder's callback (withFirm can't nest): the work's own short transactions.
    return await work();
  } finally {
    release();
    await holder;
  }
}

async function firmVoice(
  tx: FirmTx,
  firmId: string,
): Promise<FirmVoice & { line: string | null; slug: string }> {
  const [firm] = await tx
    .select({
      name: firms.name,
      slug: firms.slug,
      settings: firms.settings,
      line: firms.shiftsLineE164,
    })
    .from(firms)
    .where(eq(firms.id, firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  // `line`: the firm's shifts line, which the workers' messages go from.
  return {
    name: firm.name,
    signOff: signOffFor(firm.name, firm.settings.sign_off),
    line: firm.line,
    slug: firm.slug,
  };
}

// True when the worker also holds a valid, checked credential of the same type that lasts longer (or
// never expires): a renewal recorded as a new row (a casual's upload only once the office approves
// it, 12F.2). The old row gets no warning and no message, and isn't
// listed for the office; it is still marked expired when its date passes, so the record stays true.
// (A drizzle alias renders as its name alone inside sql``, so the FROM names the table as well.)
const newer = alias(credentials, "newer");
const superseded: SQL<boolean> = sql<boolean>`exists (
  select 1 from ${credentials} as ${sql.identifier("newer")}
   where ${newer.firmId} = ${credentials.firmId} and ${newer.workerId} = ${credentials.workerId}
     and ${newer.type} = ${credentials.type} and ${newer.id} <> ${credentials.id}
     and ${newer.status} = 'valid' and ${newer.checkState} = 'verified'
     and (${newer.expiresOn} is null or ${newer.expiresOn} > ${credentials.expiresOn}))`;

type CredentialClaim =
  | null // nothing to do (already done, or nothing due)
  | {
      kind: "warn" | "expire";
      // The message, or null: an expiry with nobody to tell.
      message: OutboundMessage | null;
      data: Record<string, unknown>;
    };

// The row as it is now, locked: the scan decides from this, never from the list read earlier.
async function lockDue(tx: FirmTx, id: string) {
  const [row] = await tx
    .select({
      id: credentials.id,
      type: credentials.type,
      status: credentials.status,
      expiresOn: credentials.expiresOn,
      warnedFor: credentials.expiryWarnedFor,
      warnedDays: credentials.expiryWarnedDays,
      workerStatus: workers.status,
      mobile: workers.mobileE164,
      typeName: credentialTypes.name,
      officeRecorded: credentialTypes.officeRecorded,
      // Whether one of the worker's roles needs it (the firm's rules): only then has she an
      // upload page for it (12F.2).
      needed: sql<boolean>`exists (
        select 1 from ${credentialRules} r
         where r.firm_id = ${credentials.firmId} and r.role = any(${workers.roles})
           and ${credentials.type} = any(r.required_types))`,
      superseded,
    })
    .from(credentials)
    .innerJoin(
      workers,
      and(eq(workers.firmId, credentials.firmId), eq(workers.id, credentials.workerId)),
    )
    .leftJoin(
      credentialTypes,
      and(
        eq(credentialTypes.firmId, credentials.firmId),
        eq(credentialTypes.code, credentials.type),
      ),
    )
    .where(eq(credentials.id, id))
    .for("update", { of: credentials });
  return row ?? null;
}

const WARNING_OUTCOMES = ["credential.expiry_warning", "credential.expiry_warning_failed"];
const NOTICE_OUTCOMES = ["credential.expiry_notice_sent", "credential.expiry_notice_failed"];

// Whether a credential's message is logged already: the warning for this date and threshold, or
// the expiry notice.
async function outcomeLogged(
  tx: FirmTx,
  id: string,
  outcome: { warning: { expiresOn: string; days: number } } | { notice: true },
): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${id}
       and ${
         "warning" in outcome
           ? sql`action in (${sql.join(
               WARNING_OUTCOMES.map((a) => sql`${a}`),
               sql`, `,
             )})
                 and data ->> 'expiresOn' = ${outcome.warning.expiresOn}
                 and data ->> 'days' = ${String(outcome.warning.days)}`
           : sql`action in (${sql.join(
               NOTICE_OUTCOMES.map((a) => sql`${a}`),
               sql`, `,
             )})`
       }
     limit 1
  `);
  return rows.length > 0;
}

// A run that stopped between a claim and its record step (a crash, a failed commit) leaves a
// message that may have gone with no event. The next run logs it as sent, unconfirmed, so the log
// still has it; it's never sent again. (Expiry events from before Phase 10 carry their message's
// details themselves and are left alone.)
async function catchUpExpiryNotices(run: WithFirm, firmId: string): Promise<void> {
  const { rows } = await run(firmId, (tx) =>
    tx.execute<{ entity_id: string; data: { type?: string; expiresOn?: string } }>(sql`
      select e.entity_id::text, e.data from events e
       where e.action = 'credential.expired' and e.data ->> 'notified' = 'true'
         and not (e.data ? 'providerMessageId')
         and e.created_at > now() - interval '30 days'
         and not exists (select 1 from events n
                          where n.entity_id = e.entity_id
                            and n.action in (${sql.join(
                              NOTICE_OUTCOMES.map((a) => sql`${a}`),
                              sql`, `,
                            )}))
    `),
  );
  for (const r of rows) {
    await run(firmId, async (tx) => {
      await tx.execute(sql`select 1 from credentials where id = ${r.entity_id} for update`);
      if (await outcomeLogged(tx, r.entity_id, { notice: true })) return;
      await recordEvent(tx, {
        actorType: "system",
        action: "credential.expiry_notice_sent",
        entityType: "credential",
        entityId: r.entity_id,
        data: {
          type: r.data.type ?? null,
          expiresOn: r.data.expiresOn ?? null,
          channel: "whatsapp",
          unconfirmed: true,
        },
      });
    });
  }
}

// (1) One credential's claim: decided again on the locked row, marked, and (for an expiry) logged.
async function claimCredential(
  tx: FirmTx,
  id: string,
  today: string,
  voice: FirmVoice & { line: string | null },
  portal: string,
): Promise<CredentialClaim> {
  const c = await lockDue(tx, id);
  if (!c || c.status !== "valid" || !c.expiresOn) return null;
  // A warning an earlier run claimed but never logged (it stopped after the claim): logged now as
  // sent, unconfirmed, and never sent again.
  if (
    c.warnedFor === c.expiresOn &&
    c.warnedDays !== null &&
    !(await outcomeLogged(tx, c.id, { warning: { expiresOn: c.expiresOn, days: c.warnedDays } }))
  ) {
    await recordEvent(tx, {
      actorType: "system",
      action: "credential.expiry_warning",
      entityType: "credential",
      entityId: c.id,
      data: {
        type: c.type,
        expiresOn: c.expiresOn,
        days: c.warnedDays,
        channel: "whatsapp",
        unconfirmed: true,
      },
    });
  }
  const action = expiryAction(c, today);
  const expiresOn = c.expiresOn;
  const year = Number(today.slice(0, 4));
  const name = c.typeName ?? displayCode(c.type);
  // No messages to people who've left, or about a credential they've already replaced. (An active
  // worker always has a mobile: only an erased one has none.)
  const mobile = c.workerStatus === "active" && !c.superseded ? c.mobile : null;
  const from = voice.line ? { from: voice.line } : {};
  // Where she uploads the renewed card (12F.2). One she can't upload (the office records it, or none
  // of her roles needs it, so her upload page wouldn't take it) says to send it to the office.
  const upload =
    c.needed && !c.officeRecorded && casualMayUpload(c.type)
      ? `${portal}/profile/upload/${c.type}`
      : null;

  if (action.kind === "warn") {
    // Unmarked, so a worker who comes back is warned then.
    if (!mobile) return null;
    await tx
      .update(credentials)
      .set({ expiryWarnedFor: expiresOn, expiryWarnedDays: action.days })
      .where(and(eq(credentials.id, c.id), eq(credentials.expiresOn, expiresOn)));
    return {
      kind: "warn",
      message: {
        channel: "whatsapp",
        to: mobile,
        ...from,
        body: credentialExpiringMessage(voice, name, shortDate(expiresOn, year), upload),
      },
      data: { type: c.type, expiresOn, days: action.days, daysLeft: action.daysLeft },
    };
  }
  if (action.kind === "expire") {
    await tx
      .update(credentials)
      .set({ status: "expired" })
      .where(
        and(
          eq(credentials.id, c.id),
          eq(credentials.status, "valid"),
          eq(credentials.expiresOn, expiresOn),
        ),
      );
    // The status change is logged with the claim (golden rule 5), whatever the message does.
    await recordEvent(tx, {
      actorType: "system",
      action: "credential.expired",
      entityType: "credential",
      entityId: c.id,
      data: {
        type: c.type,
        expiresOn,
        notified: mobile !== null, // the worker is being told (the outcome is logged after)
        ...(c.superseded ? { superseded: true } : {}),
      },
    });
    return {
      kind: "expire",
      message: mobile
        ? {
            channel: "whatsapp",
            to: mobile,
            ...from,
            body: credentialExpiredMessage(voice, name, shortDate(expiresOn, year), upload),
          }
        : null,
      data: { type: c.type, expiresOn },
    };
  }
  return null;
}

async function warnAndExpire(
  run: WithFirm,
  firmId: string,
  today: string,
  deps: CredentialScanDeps,
): Promise<{ warned: number; expired: number; failed: number }> {
  const { transport } = deps;
  const inFirm = <T>(fn: (tx: FirmTx) => Promise<T>) => run(firmId, fn);
  // Every credential the planner could act on today (read only: each is locked when claimed).
  const { voice, due } = await inFirm(async (tx) => ({
    voice: await firmVoice(tx, firmId),
    due: await tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(
        and(
          eq(credentials.status, "valid"),
          eq(credentials.checkState, "verified"),
          isNotNull(credentials.expiresOn),
          lte(credentials.expiresOn, addDays(today, EXPIRING_SOON_DAYS)),
        ),
      )
      .orderBy(asc(credentials.expiresOn), asc(credentials.id)),
  }));

  await catchUpExpiryNotices(run, firmId);

  let warned = 0;
  let expired = 0;
  let failed = 0;
  for (const { id } of due) {
    const claim = await inFirm((tx) =>
      claimCredential(tx, id, today, voice, portalUrl(voice.slug, deps.baseDomain)),
    );
    if (!claim) continue;
    if (claim.kind === "expire") expired += 1;
    if (!claim.message) continue;

    // (2) The message, outside any transaction.
    let sent: { providerMessageId: string } | { code: string };
    try {
      sent = await transport.send(claim.message);
    } catch (err) {
      sent = { code: errorCode(err) };
    }

    // (3) The outcome, logged once (a rerun may have caught it up already, as unconfirmed).
    const ok = "providerMessageId" in sent;
    await inFirm(async (tx) => {
      await tx.execute(sql`select 1 from credentials where id = ${id} for update`);
      const logged = await outcomeLogged(
        tx,
        id,
        claim.kind === "warn"
          ? { warning: { expiresOn: String(claim.data.expiresOn), days: Number(claim.data.days) } }
          : { notice: true },
      );
      if (logged) return;
      await recordEvent(tx, {
        actorType: "system",
        action:
          claim.kind === "warn"
            ? ok
              ? "credential.expiry_warning"
              : "credential.expiry_warning_failed"
            : ok
              ? "credential.expiry_notice_sent"
              : "credential.expiry_notice_failed",
        entityType: "credential",
        entityId: id,
        data: {
          ...claim.data,
          channel: "whatsapp",
          ...("providerMessageId" in sent
            ? { providerMessageId: sent.providerMessageId }
            : { code: sent.code }),
        },
      });
    });
    if (!ok) failed += 1;
    else if (claim.kind === "warn") warned += 1;
  }
  return { warned, expired, failed };
}

// The office's Monday list: active workers' credentials expiring in the next 30 days, and those
// that expired in the last week. Once a day at most (its event marks it sent), and only when
// there is something to list. An office address the email can't go to is skipped and counted,
// never allowed to fail the list for everyone else.
async function claimWeeklyList(
  tx: FirmTx,
  firmId: string,
  today: string,
): Promise<
  | Exclude<ScanResult["weeklyList"], "sent">
  | {
      recipients: { id: string; email: string }[];
      email: ReturnType<typeof credentialWeeklyListEmail>;
    }
> {
  await lockFirmScan(tx);
  const [already] = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.action, WEEKLY_LIST_ACTION), sql`${events.data} ->> 'date' = ${today}`))
    .limit(1);
  if (already) return "already_sent";

  const year = Number(today.slice(0, 4));
  const rows = await tx
    .select({
      status: credentials.status,
      type: credentials.type,
      expiresOn: credentials.expiresOn,
      firstName: workers.firstName,
      lastName: workers.lastName,
      typeName: credentialTypes.name,
    })
    .from(credentials)
    .innerJoin(
      workers,
      and(eq(workers.firmId, credentials.firmId), eq(workers.id, credentials.workerId)),
    )
    .leftJoin(
      credentialTypes,
      and(
        eq(credentialTypes.firmId, credentials.firmId),
        eq(credentialTypes.code, credentials.type),
      ),
    )
    .where(
      and(
        eq(workers.status, "active"),
        inArray(credentials.status, ["valid", "expired"]),
        eq(credentials.checkState, "verified"),
        gte(credentials.expiresOn, addDays(today, -7)),
        lte(credentials.expiresOn, addDays(today, EXPIRING_SOON_DAYS)),
        sql`not ${superseded}`,
      ),
    )
    .orderBy(asc(credentials.expiresOn), asc(workers.lastName), asc(workers.firstName));

  const entry = (r: (typeof rows)[number]) => ({
    person: `${r.firstName} ${r.lastName}`.slice(0, MAX_NAME_LENGTH),
    credential: r.typeName ?? displayCode(r.type),
    date: shortDate(r.expiresOn ?? "", year),
  });
  const expiring = rows
    .filter((r) => r.status === "valid" && (r.expiresOn ?? "") >= today)
    .map(entry);
  const expired = rows.filter((r) => (r.expiresOn ?? "") < today).map(entry);
  if (expiring.length + expired.length === 0) return "nothing_to_list";

  const office = await tx
    .select({ id: officeUsers.id, email: officeUsers.email })
    .from(officeUsers)
    .where(and(eq(officeUsers.status, "active"), inArray(officeUsers.role, ["admin", "resourcer"])))
    .orderBy(asc(officeUsers.email));
  const recipients = office.filter((o) => z.email().safeParse(o.email).success);
  const skipped = office.length - recipients.length;
  if (skipped > 0) log.warn("credential list: office addresses skipped", { firmId, skipped });
  if (recipients.length === 0) return "no_recipients";

  const email = credentialWeeklyListEmail(await firmVoice(tx, firmId), expiring, expired);
  // The list's event is the claim, written before any email goes.
  await recordEvent(tx, {
    actorType: "system",
    action: WEEKLY_LIST_ACTION,
    entityType: "firm",
    data: {
      date: today,
      recipients: recipients.length,
      skipped,
      expiring: expiring.length,
      expired: expired.length,
    },
  });
  return { recipients, email };
}

async function sendWeeklyList(
  run: WithFirm,
  firmId: string,
  today: string,
  transport: MessagingTransport,
): Promise<ScanResult["weeklyList"]> {
  const claim = await run(firmId, (tx) => claimWeeklyList(tx, firmId, today));
  if (typeof claim === "string") return claim;
  // One email per office user, no transaction open; one that fails is logged and the rest still go.
  for (const r of claim.recipients) {
    try {
      await transport.send({ channel: "email", to: r.email, ...claim.email });
    } catch (err) {
      await run(firmId, (tx) =>
        recordEvent(tx, {
          actorType: "system",
          action: "credential.weekly_list_failed",
          entityType: "firm",
          data: { date: today, officeUserId: r.id, code: errorCode(err) },
        }),
      );
    }
  }
  return "sent";
}

// A type the firm has no row for (say, an imported code): show the code readably.
const displayCode = (code: string) => code.replace(/_/g, " ");

export function credentialScanTask(
  deps: () => CredentialScanDeps,
): FirmTask<CredentialScanPayload> {
  return {
    ...credentialScanJob,
    task: (payload, run) => scanCredentials(payload, run, deps()),
  };
}

// The worker's wiring. Deps are read when the job runs.
export const credentialScanFirmTask = credentialScanTask(() => {
  const env = workerEnv();
  return { transport: getTransport(env), baseDomain: env.APP_BASE_DOMAIN };
});

export interface CredentialTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}

// One scan per firm per local date: a second tick the same day queues nothing new. One firm's
// failure never stops the others' scans.
export async function runCredentialScanTick(deps: CredentialTickDeps): Promise<{ queued: number }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  let queued = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      const id = await deps.run(firmId, async (tx) => {
        const [firm] = await tx
          .select({ timezone: firms.timezone })
          .from(firms)
          .where(eq(firms.id, firmId));
        if (!firm) return null;
        const key = `${KEY_PREFIX}${localDateOf(now, firm.timezone)}`;
        return sendFirmJob(
          tx,
          credentialScanJob,
          { idempotencyKey: key },
          { singletonKey: key, singletonSeconds: DAY_SECONDS },
        );
      });
      if (id !== null) queued += 1;
    } catch (err) {
      logger.error("credential scan tick failed for a firm", { firmId, error: err });
    }
  }
  return { queued };
}
