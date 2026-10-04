import { and, asc, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { normaliseMobile } from "../auth/mobile";
import { retryAborted } from "../db/retry";
import {
  assignments,
  credentials,
  firms,
  magicLinks,
  messages,
  offers,
  payQueries,
  payRecords,
  pushSubscriptions,
  requests,
  sessions,
  shiftReminders,
  shifts,
  sites,
  workerSiteBlocks,
  workerUnavailableDays,
  workers,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";
import { eventsAboutWorker } from "../office/action-log";
import { csvCell } from "../office/notice-report";
import { rosterId } from "../roster/book";
import { renumberEvents } from "./event-numbers";

// A worker's data, for a subject access request (docs/runbooks.md "GDPR requests"; UK GDPR: send
// it within a month). Everything this firm holds about one worker: their details, credentials,
// days off, bookings, offers, requests, reminders, pay lines, pay queries, shifts-line messages
// (with messages from or to their number from before it was known), the action log's rows about
// them, the shifts those were about, and when they logged in. Every column as stored, except the
// firm and worker ids on each row and the login secrets (link, session and code hashes, and a
// phone's push keys: those say only when a phone turned notifications on).
//
// As JSON (the rows as they are) or CSV (the same, one value per line: section, record, field,
// value; nested values as dotted fields). Admins only, checked inside the firm's transaction, and
// logged: worker.data_exported {format} (personal data leaving the system, and the month's clock
// needs a record of it being sent).

export const EXPORT_FORMATS = ["json", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

type Row = Record<string, unknown>;

export interface WorkerExport {
  exportedAt: Date;
  firm: string;
  worker: Row;
  sections: Record<string, Row[]>;
}

// Every column of a table except the firm and worker ids (the same on every row of an export).
function columnsOf(table: PgTable) {
  return Object.fromEntries(
    Object.entries(getTableColumns(table)).filter(
      ([key]) => key !== "firmId" && key !== "workerId",
    ),
  );
}

// Their shifts-line messages: the ones set to them, and from or to their number before it was
// known (no worker set). The replies to any of those are added below. The same rows
// app_erase_worker() deletes.
function theirOwnMessages(workerId: string, mobile: string | null): SQL | undefined {
  if (!mobile) return eq(messages.workerId, workerId);
  return or(
    eq(messages.workerId, workerId),
    and(
      isNull(messages.workerId),
      or(
        and(eq(messages.direction, "in"), eq(messages.fromE164, mobile)),
        and(eq(messages.direction, "out"), eq(messages.toE164, mobile)),
      ),
    ),
  );
}

export async function collectWorkerData(
  tx: FirmTx,
  workerId: string,
  now: Date,
): Promise<WorkerExport | null> {
  const [worker] = await tx
    .select(columnsOf(workers))
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return null;
  const [firm] = await tx.select({ name: firms.name }).from(firms);
  const mobile = typeof worker.mobileE164 === "string" ? worker.mobileE164 : null;

  const credentialRows = await tx
    .select(columnsOf(credentials))
    .from(credentials)
    .where(eq(credentials.workerId, workerId))
    .orderBy(asc(credentials.createdAt), asc(credentials.id));
  const daysOff = await tx
    .select(columnsOf(workerUnavailableDays))
    .from(workerUnavailableDays)
    .where(eq(workerUnavailableDays.workerId, workerId))
    .orderBy(asc(workerUnavailableDays.day));
  // Sites the office has kept them off, with the site's name (Phase 10).
  const siteBlocks = await tx
    .select({
      site: sites.name,
      reason: workerSiteBlocks.reason,
      createdAt: workerSiteBlocks.createdAt,
    })
    .from(workerSiteBlocks)
    .innerJoin(
      sites,
      and(eq(sites.firmId, workerSiteBlocks.firmId), eq(sites.id, workerSiteBlocks.siteId)),
    )
    .where(eq(workerSiteBlocks.workerId, workerId))
    .orderBy(asc(sites.name));
  const bookings = await tx
    .select(columnsOf(assignments))
    .from(assignments)
    .where(eq(assignments.workerId, workerId))
    .orderBy(asc(assignments.createdAt), asc(assignments.id));
  const offerRows = await tx
    .select(columnsOf(offers))
    .from(offers)
    .where(eq(offers.workerId, workerId))
    .orderBy(asc(offers.createdAt), asc(offers.id));
  const requestRows = await tx
    .select(columnsOf(requests))
    .from(requests)
    .where(eq(requests.workerId, workerId))
    .orderBy(asc(requests.createdAt), asc(requests.id));
  const reminders = await tx
    .select(columnsOf(shiftReminders))
    .from(shiftReminders)
    .innerJoin(
      assignments,
      and(
        eq(assignments.firmId, shiftReminders.firmId),
        eq(assignments.id, shiftReminders.assignmentId),
      ),
    )
    .where(eq(assignments.workerId, workerId))
    .orderBy(asc(shiftReminders.createdAt), asc(shiftReminders.id));
  const payLines = await tx
    .select(columnsOf(payRecords))
    .from(payRecords)
    .where(eq(payRecords.workerId, workerId))
    .orderBy(asc(payRecords.periodStart), asc(payRecords.id));
  const payQuestions = await tx
    .select(columnsOf(payQueries))
    .from(payQueries)
    .where(eq(payQueries.workerId, workerId))
    .orderBy(asc(payQueries.createdAt), asc(payQueries.id));
  const own = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(theirOwnMessages(workerId, mobile));
  const ownIds = own.map((m) => m.id);
  const messageRows =
    ownIds.length === 0
      ? []
      : await tx
          .select(columnsOf(messages))
          .from(messages)
          .where(or(inArray(messages.id, ownIds), inArray(messages.replyTo, ownIds)))
          .orderBy(asc(messages.createdAt), asc(messages.id));
  // The same rows the action log's Worker filter finds.
  const { rows: logRows } = await tx.execute<Row>(sql`
    select e.id, e.actor_type as "actorType", e.actor_id as "actorId", e.action,
           e.entity_type as "entityType", e.entity_id as "entityId", e.data,
           e.created_at as "createdAt"
      from events e
     where ${eventsAboutWorker(workerId)}
     order by e.id
  `);
  const logins = await tx
    .select({
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(and(eq(sessions.kind, "worker"), eq(sessions.workerId, workerId)))
    .orderBy(asc(sessions.createdAt));
  const loginLinks = await tx
    .select({
      createdAt: magicLinks.createdAt,
      sentAt: magicLinks.sentAt,
      usedAt: magicLinks.usedAt,
      expiresAt: magicLinks.expiresAt,
    })
    .from(magicLinks)
    .where(and(eq(magicLinks.kind, "worker"), eq(magicLinks.workerId, workerId)))
    .orderBy(asc(magicLinks.createdAt));
  const phones = await tx
    .select({ notificationsOnAt: pushSubscriptions.createdAt })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.workerId, workerId))
    .orderBy(asc(pushSubscriptions.createdAt));

  // The shifts all of that was about: when and where, so the rest reads on its own.
  const shiftIds = [
    ...new Set(
      ([...bookings, ...offerRows, ...requestRows, ...payQuestions] as Row[])
        .map((r) => r.shiftId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const shiftRows =
    shiftIds.length === 0
      ? []
      : await tx
          .select({
            id: shifts.id,
            role: shifts.role,
            site: sites.name,
            startsAt: shifts.startsAt,
            endsAt: shifts.endsAt,
            status: shifts.status,
          })
          .from(shifts)
          .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
          .where(inArray(shifts.id, shiftIds))
          .orderBy(asc(shifts.startsAt), asc(shifts.id));

  return {
    exportedAt: now,
    firm: firm?.name ?? "",
    worker,
    sections: {
      credentials: credentialRows,
      daysUnavailable: daysOff,
      siteBlocks,
      bookings,
      offers: offerRows,
      requests: requestRows,
      shiftReminders: reminders,
      payRecords: payLines,
      payQueries: payQuestions,
      messages: messageRows,
      // Numbered within this file, not by the counter every firm shares (event-numbers.ts).
      actionLog: renumberEvents(logRows),
      logins,
      loginLinks,
      phoneNotifications: phones,
      shifts: shiftRows,
    },
  };
}

export function workerExportJson(data: WorkerExport): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// Nested values (a request's payload, an event's data) become dotted fields; lists stay as JSON.
function flatten(value: unknown, prefix: string, out: [string, string][]): void {
  if (value instanceof Date) out.push([prefix, value.toISOString()]);
  else if (value === null || value === undefined) out.push([prefix, ""]);
  else if (Array.isArray(value)) out.push([prefix, JSON.stringify(value)]);
  else if (typeof value === "object") {
    const entries = Object.entries(value as Row);
    if (entries.length === 0) out.push([prefix, "{}"]);
    for (const [key, inner] of entries) flatten(inner, prefix ? `${prefix}.${key}` : key, out);
  } else out.push([prefix, String(value)]);
}

export const WORKER_CSV_HEADER = ["Section", "Record", "Field", "Value"];

export function workerExportCsv(data: WorkerExport): string {
  const lines: string[][] = [WORKER_CSV_HEADER];
  const add = (section: string, record: string, row: unknown) => {
    const fields: [string, string][] = [];
    flatten(row, "", fields);
    for (const [field, value] of fields) lines.push([section, record, field, value]);
  };
  add("export", "1", { exportedAt: data.exportedAt, firm: data.firm });
  add("worker", "1", data.worker);
  for (const [section, rows] of Object.entries(data.sections)) {
    rows.forEach((row, i) => add(section, String(i + 1), row));
  }
  // The byte order mark tells Excel the file is UTF-8 (names with accents), as the notice report.
  return `\uFEFF${lines.map((l) => l.map((cell) => csvCell(cell)).join(",")).join("\r\n")}\r\n`;
}

// The file's name: the worker's id (never their name: file names end up in email subjects and
// download folders).
export function workerExportFileName(workerId: string, format: ExportFormat, now: Date): string {
  return `worker-${workerId.slice(0, 8)}-data-${now.toISOString().slice(0, 10)}.${format}`;
}

export type WorkerExportResult =
  | { status: "ok"; body: string; fileName: string; contentType: string }
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function exportWorkerData(
  ctx: OfficeContext,
  rawWorkerId: string,
  rawFormat: string,
): Promise<WorkerExportResult> {
  const id = rosterId.safeParse(rawWorkerId);
  const chosen = z.enum(EXPORT_FORMATS).safeParse(rawFormat);
  if (!id.success || !chosen.success) return { status: "not_found" };
  const workerId = id.data;
  const format = chosen.data;
  const { run, by } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<WorkerExportResult> => {
      if (!(await officeUserMay(tx, by.id, "data"))) return { status: "not_allowed" };
      const data = await collectWorkerData(tx, workerId, now);
      if (!data) return { status: "not_found" };
      await recordEvent(tx, {
        actorType: "office",
        actorId: by.id,
        action: "worker.data_exported",
        entityType: "worker",
        entityId: workerId,
        data: { workerId, format },
      });
      return format === "json"
        ? {
            status: "ok",
            body: workerExportJson(data),
            fileName: workerExportFileName(workerId, "json", now),
            contentType: "application/json; charset=utf-8",
          }
        : {
            status: "ok",
            body: workerExportCsv(data),
            fileName: workerExportFileName(workerId, "csv", now),
            contentType: "text/csv; charset=utf-8",
          };
    }),
  );
}

export interface WorkerMatch {
  id: string;
  name: string;
  mobile: string | null;
  status: string;
  erased: boolean;
}

export const MAX_WORKER_MATCHES = 20;

// Finding the worker a request is about: by a mobile number (any UK way of writing it) or a part
// of their name. At most 20, erased ones included (so the office can see a deletion was done).
export async function findWorkers(
  ctx: OfficeContext,
  rawQuery: string,
  area: "data" | "workers" = "data", // the office worker pages search the same way (Phase 10)
): Promise<WorkerMatch[] | null> {
  const query = rawQuery.trim().slice(0, 100);
  if (!query) return [];
  const mobile = normaliseMobile(query);
  const { run } = parts(ctx);
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, area))) return null;
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await tx
      .select({
        id: workers.id,
        firstName: workers.firstName,
        lastName: workers.lastName,
        mobile: workers.mobileE164,
        status: workers.status,
        erasedAt: workers.erasedAt,
      })
      .from(workers)
      .where(
        mobile
          ? eq(workers.mobileE164, mobile)
          : sql`(${workers.firstName} || ' ' || ${workers.lastName}) ilike ${pattern}`,
      )
      .orderBy(asc(workers.lastName), asc(workers.firstName), asc(workers.id))
      .limit(MAX_WORKER_MATCHES);
    return rows.map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      mobile: r.mobile,
      status: r.status,
      erased: r.erasedAt !== null,
    }));
  });
}
