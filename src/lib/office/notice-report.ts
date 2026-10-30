import { eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { firms, type CancelAsker } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { roleLabel } from "../portal/format";
import { addDays, localDateOf, wallTimeOf, zonedToUtc } from "../time/zoned";
import { dayWithYear } from "./action-log";

// The notice and cancellation report (docs/screens.md `/office/reports/notice`; docs/compliance.md,
// Employment Rights Act: firms will need evidence of every offer, change and cancellation, who
// started it and how much notice the worker had). Built from the append-only action log, one row
// per worker affected:
//   Offered   offer.sent        (an offer wave, or the office)
//   Booked    shift.assigned    (the worker, the office, or the rota sheet)
//   Moved     shift.moved       (the office, or the rota sheet)
//   Shortened shift.curtailed   (the office, or the rota sheet)
//   Cancelled shift.cancelled   (the worker, the office, or the rota sheet)
// Notice hours come from the event itself (recorded when it happened). Offers logged before they
// recorded it are counted from the shift's current start, and say so.
//
// Short notice: under the firm's `short_notice_threshold_hours` (1 to 720; missing or not valid:
// 48, the placeholder until the 2027 rules are final, and the page says which). Every row is
// flagged against it; the filters narrow the list.
//
// Admins and resourcers: the session and role are checked here as well as on the page and the
// download. Reads only, inside the firm (RLS scopes every row to it).

export const REPORT_DEFAULT_DAYS = 28;
export const REPORT_MAX_DAYS = 366;
export const REPORT_PAGE_ROWS = 500;
export const REPORT_CSV_ROWS = 20_000;
export const DEFAULT_SHORT_NOTICE_HOURS = 48;

export const REPORT_KINDS = {
  offers: ["offer.sent"],
  bookings: ["shift.assigned"],
  changes: ["shift.moved", "shift.curtailed"],
  cancellations: ["shift.cancelled"],
} as const;
export type ReportKind = keyof typeof REPORT_KINDS;
const ALL_ACTIONS = Object.values(REPORT_KINDS).flat();

export type RowKind = "offered" | "booked" | "moved" | "shortened" | "cancelled";
export type Initiator = "worker" | "office" | "rota_sheet" | "offer_wave" | "firm";

export interface NoticeRow {
  eventId: number;
  at: Date;
  kind: RowKind;
  initiator: Initiator;
  worker: string;
  shift: { id: string; role: string; site: string | null; startsAt: Date } | null;
  // A move's or shortening's times before and after, and whether the site changed.
  moved: {
    fromStart: Date;
    fromEnd: Date;
    toStart: Date;
    toEnd: Date;
    siteChanged: boolean;
  } | null;
  noticeHours: number | null;
  noticeFromCurrentStart: boolean; // an older offer: counted from the shift's start as it is now
  shortNotice: boolean;
  // The firm's reason: its fixed change and cancellation words, the rota sheet's, or the office's
  // typed override reason when it placed someone (from Phase 10 read from the booking, not the
  // log: gone once the retention purge or a deletion clears it). A worker's typed reason is never
  // logged.
  reason: string | null;
  // A cancellation's: who asked for it (P3.4, assignments.cancel_asked_by), apart from who carried
  // it out (initiator): the casual, the firm, its client, or not known. Null for other rows.
  askedBy: CancelAsker | null;
}

export interface NoticeReport {
  timeZone: string;
  thisYear: string;
  threshold: { hours: number; source: "setting" | "default" | "invalid" };
  filters: {
    from: string;
    to: string;
    kind: ReportKind | null;
    by: "worker" | "firm" | null;
    shortOnly: boolean;
  };
  clamped: boolean;
  total: number;
  // The cancellations among them (every one the filters match, not just this page's), by who asked
  // for them (P3.4).
  askedBy: Record<CancelAsker, number>;
  rows: NoticeRow[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const day = (value: string): string | null => {
  if (!/^(20\d\d|2100)-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
};

// What the page's (or the download's) query string says, checked; anything else is dropped.
export function parseNoticeQuery(query: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const v = query[key];
    return typeof v === "string" ? v.trim() : "";
  };
  const kind = one("kind");
  const by = one("by");
  return {
    from: day(one("from")),
    to: day(one("to")),
    kind: Object.hasOwn(REPORT_KINDS, kind) ? (kind as ReportKind) : null,
    by: by === "worker" ? ("worker" as const) : by === "firm" ? ("firm" as const) : null,
    shortOnly: one("short") === "1",
  };
}
export type NoticeQuery = ReturnType<typeof parseNoticeQuery>;

export function shortNoticeThreshold(settings: Record<string, unknown>): NoticeReport["threshold"] {
  const raw = settings.short_notice_threshold_hours;
  if (raw === undefined) return { hours: DEFAULT_SHORT_NOTICE_HOURS, source: "default" };
  const parsed = z.number().min(1).max(720).safeParse(raw);
  return parsed.success
    ? { hours: parsed.data, source: "setting" }
    : { hours: DEFAULT_SHORT_NOTICE_HOURS, source: "invalid" };
}

const KIND_OF: Record<string, RowKind> = {
  "offer.sent": "offered",
  "shift.assigned": "booked",
  "shift.moved": "moved",
  "shift.curtailed": "shortened",
  "shift.cancelled": "cancelled",
};

type Row = {
  id: string | number;
  action: string;
  actor_type: string;
  data: Record<string, unknown>;
  created_at: string | Date;
  notice: string | number | null;
  from_current: boolean;
  shift_id: string | null;
  role: string | null;
  starts_at: string | Date | null;
  site_name: string | null;
  first_name: string | null;
  last_name: string | null;
  override_reason: string | null;
  asked_by: CancelAsker | null;
};

// Who started it, from the event: the worker, the office, the rota sheet (the Google Sheets sync,
// the system on the firm's behalf), or an offer wave.
function initiatorOf(action: string, actorType: string, data: Record<string, unknown>): Initiator {
  if (action === "offer.sent") return data.offeredBy ? "office" : "offer_wave";
  if (data.by === "worker") return "worker";
  if (data.source === "sheets") return "rota_sheet";
  return actorType === "office" ? "office" : "firm";
}

const isoOf = (v: unknown): Date | null =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null;

export async function loadNoticeReport(
  tx: FirmTx,
  query: NoticeQuery,
  now: Date,
  limit: number = REPORT_PAGE_ROWS,
): Promise<NoticeReport> {
  const [firm] = await tx
    .select({ timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const timeZone = firm?.timezone ?? "Europe/London";
  const threshold = shortNoticeThreshold(firm?.settings ?? {});
  const today = localDateOf(now, timeZone);

  let to = query.to ?? (query.from ? addDays(query.from, REPORT_DEFAULT_DAYS - 1) : today);
  let from = query.from ?? addDays(to, -(REPORT_DEFAULT_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  let clamped = false;
  if (from < addDays(to, -(REPORT_MAX_DAYS - 1))) {
    from = addDays(to, -(REPORT_MAX_DAYS - 1));
    clamped = true;
  }
  const midnight = (d: string) => {
    const [y = 2000, m = 1, dd = 1] = d.split("-").map(Number);
    return zonedToUtc({ year: y, month: m, day: dd, hour: 0, minute: 0 }, timeZone);
  };

  const actions = query.kind ? [...REPORT_KINDS[query.kind]] : [...ALL_ACTIONS];
  const workerStarted = sql`coalesce(e.action in ('shift.assigned', 'shift.cancelled')
    and e.data ->> 'by' = 'worker', false)`;
  // The notice in hours: the event's own figure, or for an older offer, from the current start.
  const recorded = sql`case when e.data ->> 'noticeHours' ~ '^-?[0-9]+(\\.[0-9]+)?$'
                            then (e.data ->> 'noticeHours')::numeric end`;
  const notice = sql`coalesce(${recorded}, case when e.action = 'offer.sent' and s.starts_at is not null
      then round((extract(epoch from s.starts_at - e.created_at) / 3600)::numeric, 2) end)`;
  const where: SQL[] = [
    sql`e.created_at >= ${midnight(from)} and e.created_at < ${midnight(addDays(to, 1))}`,
    sql`e.action in (${sql.join(
      actions.map((a) => sql`${a}`),
      sql`, `,
    )})`,
  ];
  if (query.by === "worker") where.push(workerStarted);
  if (query.by === "firm") where.push(sql`not ${workerStarted}`);
  if (query.shortOnly) where.push(sql`${notice} < ${threshold.hours}`);

  const uuidText = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
  // The shift and worker the event names, or (an older rota-sheet move that named neither) those
  // of the booking it's about.
  const joins = sql`
    left join assignments a on e.entity_type = 'assignment'
      and a.firm_id = e.firm_id and a.id = e.entity_id
    left join shifts s on s.firm_id = e.firm_id and s.id = coalesce(
      case when e.data ->> 'shiftId' ~ ${uuidText} then (e.data ->> 'shiftId')::uuid end, a.shift_id)
    left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
    left join workers w on w.firm_id = e.firm_id and w.id = coalesce(
      case when e.data ->> 'workerId' ~ ${uuidText} then (e.data ->> 'workerId')::uuid end, a.worker_id)`;
  const whereSql = sql.join(where, sql` and `);

  const { rows: counted } = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from events e ${joins} where ${whereSql}`);
  // Who asked: the cancellation's own log entry (since P3.4), else its booking's record (every one
  // since migration 0053); one with neither (none should be) counts as not known.
  const askedBySql = sql`case when e.action = 'shift.cancelled'
                              then coalesce(case when e.data ->> 'askedBy' in ('casual', 'firm', 'client', 'unknown')
                                                 then e.data ->> 'askedBy' end,
                                            a.cancel_asked_by, 'unknown') end`;
  const { rows: asked } = await tx.execute<{ asked_by: CancelAsker; n: number }>(sql`
    select ${askedBySql} as asked_by, count(*)::int as n
      from events e ${joins}
     where ${whereSql} and e.action = 'shift.cancelled'
     group by 1`);
  const askedBy: Record<CancelAsker, number> = { casual: 0, firm: 0, client: 0, unknown: 0 };
  for (const a of asked) askedBy[a.asked_by] += a.n;
  const { rows } = await tx.execute<Row>(sql`
    select e.id, e.action, e.actor_type, e.data, e.created_at,
           ${notice} as notice,
           (${recorded}) is null and e.action = 'offer.sent' and s.starts_at is not null
             as from_current,
           s.id::text as shift_id, s.role, s.starts_at, si.name as site_name,
           w.first_name, w.last_name, a.override_reason, ${askedBySql} as asked_by
      from events e ${joins}
     where ${whereSql}
     order by e.id desc
     limit ${limit}`);

  return {
    timeZone,
    thisYear: today.slice(0, 4),
    threshold,
    filters: { from, to, kind: query.kind, by: query.by, shortOnly: query.shortOnly },
    clamped,
    total: counted[0]?.n ?? 0,
    askedBy,
    rows: rows.map((r) => {
      const hours = r.notice === null ? null : Number(r.notice);
      const kind = KIND_OF[r.action] ?? "booked";
      const firmStarted = initiatorOf(r.action, r.actor_type, r.data) !== "worker";
      const oldStart = isoOf(r.data.oldStartsAt);
      const newStart = isoOf(r.data.newStartsAt);
      const oldEnd = isoOf(r.data.oldEndsAt);
      const newEnd = isoOf(r.data.newEndsAt);
      return {
        eventId: Number(r.id),
        at: new Date(r.created_at),
        kind,
        initiator: initiatorOf(r.action, r.actor_type, r.data),
        worker: r.first_name ? `${r.first_name} ${r.last_name ?? ""}`.trim() : "Someone",
        shift:
          r.shift_id && r.role && r.starts_at
            ? {
                id: r.shift_id,
                role: r.role,
                site: r.site_name,
                startsAt: new Date(r.starts_at),
              }
            : null,
        moved:
          (kind === "moved" || kind === "shortened") && oldStart && newStart && oldEnd && newEnd
            ? {
                fromStart: oldStart,
                fromEnd: oldEnd,
                toStart: newStart,
                toEnd: newEnd,
                siteChanged:
                  "oldSiteId" in r.data &&
                  "newSiteId" in r.data &&
                  r.data.oldSiteId !== r.data.newSiteId,
              }
            : null,
        noticeHours: hours !== null && Number.isFinite(hours) ? hours : null,
        noticeFromCurrentStart: Boolean(r.from_current),
        shortNotice: hours !== null && Number.isFinite(hours) && hours < threshold.hours,
        reason: !firmStarted
          ? null
          : typeof r.data.reason === "string"
            ? r.data.reason
            : r.action === "shift.assigned" && r.override_reason
              ? r.override_reason
              : null,
        askedBy: r.asked_by,
      };
    }),
  };
}

// The words the page and the file use.
export const KIND_WORDS: Record<RowKind, string> = {
  offered: "Offered",
  booked: "Booked",
  moved: "Moved",
  shortened: "Shortened",
  cancelled: "Cancelled",
};
export const INITIATOR_WORDS: Record<Initiator, string> = {
  worker: "The worker",
  office: "The office",
  rota_sheet: "The rota sheet",
  offer_wave: "An offer wave",
  firm: "The firm",
};
export const FILTER_KIND_WORDS: Record<ReportKind, string> = {
  offers: "Offers",
  bookings: "Bookings",
  changes: "Moves and shortenings",
  cancellations: "Cancellations",
};

// "09:14 on Mon 2 Nov" (the year when it isn't this year).
export function whenWords(instant: Date, timeZone: string, thisYear: string): string {
  const w = wallTimeOf(instant, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)} on ${dayWithYear(localDateOf(instant, timeZone), thisYear)}`;
}

// "Sat 7 Nov 06:00 to 14:00", or "Sat 7 Nov 22:00 to Sun 8 Nov 06:00" across midnight.
export function spanWords(start: Date, end: Date, timeZone: string, thisYear: string): string {
  const time = (d: Date) => {
    const w = wallTimeOf(d, timeZone);
    return `${pad(w.hour)}:${pad(w.minute)}`;
  };
  const startDay = localDateOf(start, timeZone);
  const endDay = localDateOf(end, timeZone);
  const endText = endDay === startDay ? time(end) : `${dayWithYear(endDay, thisYear)} ${time(end)}`;
  return `${dayWithYear(startDay, thisYear)} ${time(start)} to ${endText}`;
}

export function localStamp(instant: Date, timeZone: string): string {
  const w = wallTimeOf(instant, timeZone);
  return `${localDateOf(instant, timeZone)} ${pad(w.hour)}:${pad(w.minute)}`;
}

// "Door supervisor at Riverside Arena, Sat 7 Nov 08:00" (the year when it isn't this year).
export function shiftWords(shift: NoticeRow["shift"], timeZone: string, thisYear: string): string {
  if (!shift) return "A shift no longer here";
  const w = wallTimeOf(shift.startsAt, timeZone);
  return `${roleLabel(shift.role)}${shift.site ? ` at ${shift.site}` : ""}, ${dayWithYear(localDateOf(shift.startsAt, timeZone), thisYear)} ${pad(w.hour)}:${pad(w.minute)}`;
}

// One CSV cell: quoted when needed, and a leading = + - @ (or tab / carriage return) made inert
// so a spreadsheet shows it as text instead of running it as a formula.
export function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  // A plain number (a negative notice, say) can't be a formula: left as it is.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Who asked for a cancellation (P3.4), as the page and the file say it (Phase 25.2): the casual's
// own ask in the report's own word for them, beside "Started by".
export const ASKED_BY_WORDS: Record<CancelAsker, string> = {
  casual: "The worker",
  firm: "The firm",
  client: "The client",
  unknown: "Not known",
};

export const CSV_HEADER = [
  "When (firm time)",
  "When (UTC)",
  "What",
  "Started by",
  "Asked by",
  "Worker",
  "Shift",
  "Shift start (as it is now)",
  "Was (start to end)",
  "Now (start to end)",
  "Notice (hours)",
  "Short notice",
  "Reason",
  "Note",
];

export function noticeReportCsv(report: OfficeNoticeReport): string {
  const tz = report.timeZone;
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const r of report.rows) {
    lines.push(
      [
        localStamp(r.at, tz),
        r.at.toISOString(),
        KIND_WORDS[r.kind],
        INITIATOR_WORDS[r.initiator],
        r.askedBy ? ASKED_BY_WORDS[r.askedBy] : "",
        r.worker,
        r.shift
          ? `${roleLabel(r.shift.role)}${r.shift.site ? ` at ${r.shift.site}` : ""}`
          : "A shift no longer here",
        r.shift ? localStamp(r.shift.startsAt, tz) : "",
        r.moved ? `${localStamp(r.moved.fromStart, tz)} to ${localStamp(r.moved.fromEnd, tz)}` : "",
        r.moved ? `${localStamp(r.moved.toStart, tz)} to ${localStamp(r.moved.toEnd, tz)}` : "",
        r.noticeHours === null ? "" : r.noticeHours.toFixed(2),
        r.shortNotice ? "Yes" : "No",
        r.reason ?? "",
        noteOf(r),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // With a byte-order mark, so Excel reads accented names (Zoë, Łukasz) as UTF-8.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// The file's "Note" column: anything a reader needs to read the row right.
function noteOf(r: OfficeNoticeRow): string {
  const notes: string[] = [];
  if (r.moved?.siteChanged) notes.push("The site changed");
  if (r.noticeHours !== null && r.noticeHours < 0) notes.push("After the start");
  if (r.noticeFromCurrentStart) notes.push("Notice counted from the shift's current start");
  return notes.join(". ");
}

// What the office's page and file get: no event numbers. They come from one counter shared by every
// firm, so a firm could count the others' activity between them (Phase 10 task 19, audit L44). Who
// asked for each cancellation (P3.4) is there, in ASKED_BY_WORDS on both (Phase 25.2).
export type OfficeNoticeRow = Omit<NoticeRow, "eventId">;
export type OfficeNoticeReport = Omit<NoticeReport, "rows"> & { rows: OfficeNoticeRow[] };

// The report for the logged-in office user, or null (logged out, or a role without it).
export async function officeNoticeReport(
  ctx: AuthContext,
  token: string,
  query: NoticeQuery,
  limit: number = REPORT_PAGE_ROWS,
): Promise<OfficeNoticeReport | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "reports")) return null;
  const { run, now } = authParts(ctx);
  const report = await run(ctx.firm.id, (tx) => loadNoticeReport(tx, query, now, limit));
  return {
    ...report,
    rows: report.rows.map((r): OfficeNoticeRow => ({
      at: r.at,
      kind: r.kind,
      initiator: r.initiator,
      askedBy: r.askedBy,
      worker: r.worker,
      shift: r.shift,
      moved: r.moved,
      noticeHours: r.noticeHours,
      noticeFromCurrentStart: r.noticeFromCurrentStart,
      shortNotice: r.shortNotice,
      reason: r.reason,
    })),
  };
}
