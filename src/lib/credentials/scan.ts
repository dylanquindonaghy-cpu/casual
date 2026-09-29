import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { credentials, credentialTypes, events, firms, officeUsers, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { getTransport, type MessagingTransport } from "../messaging";
import {
  credentialExpiredMessage,
  credentialExpiringMessage,
  credentialWeeklyListEmail,
  type FirmVoice,
} from "../messaging/templates";
import { shortDate } from "../rules/reasons";
import { signOffFor } from "../tenancy/sign-off";
import { addDays, localDateOf } from "../time/zoned";
import { expiryAction, isWeeklyListDay, WARNING_DAYS } from "./expiry";

// The credential expiry jobs (docs/api-and-jobs.md, docs/rules-and-credentials.md "Expiry
// warnings"):
// - credential-scan-tick: a cron at 08:00 London time (no firm). Queues one credential-scan per
//   firm for the firm's local date.
// - credential-scan: one firm's scan for the date in its payload. First, in one transaction, it
//   warns active workers by WhatsApp at 30, 14 and 7 days (expiry.ts decides) and marks
//   credentials expired the day after their expiry date, telling the worker. Then, on Mondays and
//   in a second transaction, it emails active admins and resourcers the week's list, so a problem
//   with the list can never undo (and on retry repeat) the workers' messages. Every change writes
//   an event. Safe to run twice: the warning columns, the status and the list's event all say what
//   was already done, and an advisory lock keeps two scans of a firm from overlapping.
//
// Blocking never waits for this job: the rules engine refuses a credential whose date has passed
// whatever its status says. The scan makes the status match, so the office and the worker see it.
// Messages go out inside the transaction, after the rows are marked, so a failed step retries and
// may repeat a message but never loses one (the queue-then-send outbox comes with Twilio).

export const CREDENTIAL_SCAN_QUEUE = "credential-scan";
export const CREDENTIAL_SCAN_TICK_QUEUE = "credential-scan-tick";
// 08:00, outside the default quiet hours (22:00-07:00). A day the worker was down is caught up the
// next day: warnings go by thresholds crossed, not exact days.
export const CREDENTIAL_SCAN_CRON = "0 8 * * *";
export const CREDENTIAL_SCAN_TZ = "Europe/London";

const DAY_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = "credential-scan:";
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
}

export interface ScanResult {
  date: string;
  warned: number;
  expired: number;
  weeklyList: "sent" | "already_sent" | "nothing_to_list" | "no_recipients" | "not_today";
}

const WEEKLY_LIST_ACTION = "credential.weekly_list_sent";

export async function scanCredentials(
  payload: CredentialScanPayload,
  run: WithFirm,
  deps: CredentialScanDeps,
): Promise<ScanResult> {
  const today = payload.idempotencyKey.slice(KEY_PREFIX.length);
  const { warned, expired } = await run(payload.firmId, (tx) =>
    warnAndExpire(tx, payload.firmId, today, deps.transport),
  );
  const weeklyList = isWeeklyListDay(today)
    ? await run(payload.firmId, (tx) => sendWeeklyList(tx, payload.firmId, today, deps.transport))
    : "not_today";
  return { date: today, warned, expired, weeklyList };
}

// One scan per firm at a time (a retry overlapping a slow run, say): the second waits here, then
// finds everything already marked and the weekly list's event already written.
async function lockFirmScan(tx: FirmTx): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('credential-scan:' || app_current_firm_id()::text, 0))`,
  );
}

async function firmVoice(tx: FirmTx, firmId: string): Promise<FirmVoice & { line: string | null }> {
  const [firm] = await tx
    .select({ name: firms.name, settings: firms.settings, line: firms.shiftsLineE164 })
    .from(firms)
    .where(eq(firms.id, firmId));
  if (!firm) throw new Error("firm not visible inside its own transaction");
  // `line`: the firm's shifts line, which the workers' messages go from.
  return {
    name: firm.name,
    signOff: signOffFor(firm.name, firm.settings.sign_off),
    line: firm.line,
  };
}

// True when the worker also holds a valid credential of the same type that lasts longer (or never
// expires): a renewal recorded as a new row. The old row gets no warning and no message, and isn't
// listed for the office; it is still marked expired when its date passes, so the record stays true.
// (A drizzle alias renders as its name alone inside sql``, so the FROM names the table as well.)
const newer = alias(credentials, "newer");
const superseded: SQL<boolean> = sql<boolean>`exists (
  select 1 from ${credentials} as ${sql.identifier("newer")}
   where ${newer.firmId} = ${credentials.firmId} and ${newer.workerId} = ${credentials.workerId}
     and ${newer.type} = ${credentials.type} and ${newer.id} <> ${credentials.id}
     and ${newer.status} = 'valid'
     and (${newer.expiresOn} is null or ${newer.expiresOn} > ${credentials.expiresOn}))`;

async function warnAndExpire(
  tx: FirmTx,
  firmId: string,
  today: string,
  transport: MessagingTransport,
): Promise<{ warned: number; expired: number }> {
  await lockFirmScan(tx);
  const voice = await firmVoice(tx, firmId);
  const year = Number(today.slice(0, 4));

  // Every credential the planner could act on today. Locked, so a renewal (an import) racing the
  // scan waits for it, or the scan waits and re-reads the renewed row.
  const due = await tx
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
    .where(
      and(
        eq(credentials.status, "valid"),
        isNotNull(credentials.expiresOn),
        lte(credentials.expiresOn, addDays(today, Math.max(...WARNING_DAYS))),
      ),
    )
    .orderBy(asc(credentials.expiresOn), asc(credentials.id))
    .for("update", { of: credentials });

  let warned = 0;
  let expired = 0;
  for (const c of due) {
    const action = expiryAction(c, today);
    const expiresOn = c.expiresOn ?? "";
    const name = c.typeName ?? displayCode(c.type);
    // No messages to people who've left, or about a credential they've already replaced.
    const tell = c.workerStatus === "active" && !c.superseded;

    if (action.kind === "warn") {
      // Unmarked, so a worker who comes back is warned then.
      if (!tell) continue;
      await tx
        .update(credentials)
        .set({ expiryWarnedFor: expiresOn, expiryWarnedDays: action.days })
        .where(and(eq(credentials.id, c.id), eq(credentials.expiresOn, expiresOn)));
      const sent = await transport.send({
        channel: "whatsapp",
        to: c.mobile,
        ...(voice.line ? { from: voice.line } : {}),
        body: credentialExpiringMessage(voice, name, shortDate(expiresOn, year)),
      });
      await recordEvent(tx, {
        actorType: "system",
        action: "credential.expiry_warning",
        entityType: "credential",
        entityId: c.id,
        data: {
          type: c.type,
          expiresOn,
          days: action.days,
          daysLeft: action.daysLeft,
          channel: "whatsapp",
          providerMessageId: sent.providerMessageId,
        },
      });
      warned += 1;
    } else if (action.kind === "expire") {
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
      const sent = tell
        ? await transport.send({
            channel: "whatsapp",
            to: c.mobile,
            ...(voice.line ? { from: voice.line } : {}),
            body: credentialExpiredMessage(voice, name, shortDate(expiresOn, year)),
          })
        : null;
      await recordEvent(tx, {
        actorType: "system",
        action: "credential.expired",
        entityType: "credential",
        entityId: c.id,
        data: {
          type: c.type,
          expiresOn,
          notified: sent !== null,
          ...(c.superseded ? { superseded: true } : {}),
          channel: sent ? "whatsapp" : null,
          providerMessageId: sent?.providerMessageId ?? null,
        },
      });
      expired += 1;
    }
  }
  return { warned, expired };
}

// The office's Monday list: active workers' credentials expiring in the next 30 days, and those
// that expired in the last week. Once a day at most (its event marks it sent), and only when
// there is something to list. An office address the email can't go to is skipped and counted,
// never allowed to fail the list for everyone else.
async function sendWeeklyList(
  tx: FirmTx,
  firmId: string,
  today: string,
  transport: MessagingTransport,
): Promise<ScanResult["weeklyList"]> {
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
        gte(credentials.expiresOn, addDays(today, -7)),
        lte(credentials.expiresOn, addDays(today, Math.max(...WARNING_DAYS))),
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
    .select({ email: officeUsers.email })
    .from(officeUsers)
    .where(and(eq(officeUsers.status, "active"), inArray(officeUsers.role, ["admin", "resourcer"])))
    .orderBy(asc(officeUsers.email));
  const recipients = office.filter((o) => z.email().safeParse(o.email).success);
  const skipped = office.length - recipients.length;
  if (skipped > 0) log.warn("credential list: office addresses skipped", { firmId, skipped });
  if (recipients.length === 0) return "no_recipients";

  const email = credentialWeeklyListEmail(await firmVoice(tx, firmId), expiring, expired);
  for (const r of recipients) {
    await transport.send({ channel: "email", to: r.email, ...email });
  }
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
export const credentialScanFirmTask = credentialScanTask(() => ({
  transport: getTransport(workerEnv()),
}));

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
