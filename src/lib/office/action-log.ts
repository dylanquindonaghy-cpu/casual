import { asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { firms, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { roleLabel } from "../portal/format";
import { dayLabel } from "../rules/reasons";
import { addDays, localDateOf, wallTimeOf, zonedToUtc } from "../time/zoned";
import { eventWords } from "./event-words";
import { isLogType, LOG_TYPES, logTypeLabel, type LogType } from "./log-types";

// The office's action log (docs/screens.md `/office/log`; golden rule 5; product spec "every action
// logged so that disputes are settled in seconds"). Admins and resourcers: the session and role are
// checked here as well as on the page. Reads only, inside the firm (RLS scopes every row to it).
//
// Filters (each optional; anything that doesn't parse is ignored):
// - worker: events naming them (data.workerId), done by them, about them, or about one of their
//   bookings, requests, credentials, pay records, login links or pay-page codes;
// - shift: events about it, naming it (data.shiftId), or about one of its bookings or requests;
// - type: one of the plain groups (log-types.ts);
// - from / to: whole days in the firm's time zone. Default: the last 7 days, or, with a shift and
//   no dates, all of that shift's events. At most 92 days (a longer range keeps its last 92).
// Newest first, 100 at a time; `before` (an event id) continues after the last one shown.

export const LOG_PAGE = 100;
export const LOG_DEFAULT_DAYS = 7;
export const LOG_MAX_DAYS = 92;

export interface LogFilters {
  worker: string | null;
  shift: string | null;
  type: LogType | null;
  from: string | null; // yyyy-mm-dd, firm-local
  to: string | null;
}

export interface LogEntry {
  id: number;
  at: Date;
  type: string; // the group, as the list shows it
  words: string;
  shift: { id: string; label: string } | null;
}

export interface ActionLog {
  timeZone: string;
  thisYear: string; // "2026": dates in other years show theirs
  filters: LogFilters;
  clamped: boolean; // the range was cut to 92 days
  entries: LogEntry[];
  older: number | null; // `before` for the next page
  workers: { id: string; name: string }[]; // for the filter
  shifts: { id: string; label: string }[]; // shifts in the chosen dates, for the filter
}

const uuid = z.uuid();
const pad = (n: number) => String(n).padStart(2, "0");

// "2026-11-02", a real calendar day, or null.
const day = (value: string): string | null => {
  if (!/^(20\d\d|2100)-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
};

// "Sat 7 Nov", with the year when it isn't this year ("Sat 7 Nov 2025"): the log is evidence, and
// a search can reach back across a new year.
export const dayWithYear = (isoDay: string, thisYear: string) =>
  isoDay.startsWith(thisYear) ? dayLabel(isoDay) : `${dayLabel(isoDay)} ${isoDay.slice(0, 4)}`;

// What the page's query string says, checked. Unknown or malformed values are dropped.
export function parseLogQuery(query: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const v = query[key];
    return typeof v === "string" ? v.trim() : "";
  };
  const before = Number(one("before"));
  return {
    // Lower case, as the database writes ids (and as events hold them in their data).
    worker: uuid.safeParse(one("worker")).success ? one("worker").toLowerCase() : null,
    shift: uuid.safeParse(one("shift")).success ? one("shift").toLowerCase() : null,
    type: isLogType(one("type")) ? (one("type") as LogType) : null,
    from: day(one("from")),
    to: day(one("to")),
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
  };
}
export type LogQuery = ReturnType<typeof parseLogQuery>;

type Row = {
  id: string | number;
  action: string;
  actor_type: string;
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: string | Date;
  subject_worker: string | null;
  subject_shift: string | null;
};

// The day range to search, as instants, or null for no date limit.
function range(query: LogQuery, today: string, timeZone: string) {
  if (!query.from && !query.to && query.shift) {
    return { from: null, to: null, start: null, end: null, clamped: false };
  }
  let to = query.to ?? (query.from ? addDays(query.from, LOG_DEFAULT_DAYS - 1) : today);
  let from = query.from ?? addDays(to, -(LOG_DEFAULT_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  let clamped = false;
  if (from < addDays(to, -(LOG_MAX_DAYS - 1))) {
    from = addDays(to, -(LOG_MAX_DAYS - 1));
    clamped = true;
  }
  const midnight = (day: string) => {
    const [y = 2000, m = 1, d = 1] = day.split("-").map(Number);
    return zonedToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, timeZone);
  };
  return { from, to, start: midnight(from), end: midnight(addDays(to, 1)), clamped };
}

// The action log's rows about one worker (the table aliased `e`): theirs, ones naming them, and ones
// about their bookings, requests, credentials, pay lines and queries, login links and codes. The
// Worker filter here and their data export (src/lib/gdpr/worker-export.ts) both use it.
export function eventsAboutWorker(w: string): SQL {
  return sql`(
      e.data ->> 'workerId' = ${w}
      or (e.actor_type = 'worker' and e.actor_id = ${w}::uuid)
      or (e.entity_type = 'worker' and e.entity_id = ${w}::uuid)
      or (e.entity_type = 'assignment' and e.entity_id in (
          select a.id from assignments a where a.firm_id = e.firm_id and a.worker_id = ${w}::uuid))
      or (e.entity_type = 'request' and e.entity_id in (
          select r.id from requests r where r.firm_id = e.firm_id and r.worker_id = ${w}::uuid))
      or (e.entity_type = 'credential' and e.entity_id in (
          select c.id from credentials c where c.firm_id = e.firm_id and c.worker_id = ${w}::uuid))
      or (e.entity_type = 'pay_record' and e.entity_id in (
          select p.id from pay_records p where p.firm_id = e.firm_id and p.worker_id = ${w}::uuid))
      or (e.entity_type = 'pay_query' and e.entity_id in (
          select q.id from pay_queries q where q.firm_id = e.firm_id and q.worker_id = ${w}::uuid))
      or (e.entity_type = 'magic_link' and e.entity_id in (
          select m.id from magic_links m where m.firm_id = e.firm_id and m.worker_id = ${w}::uuid))
      or (e.entity_type = 'login_request' and e.entity_id in (
          select m.request_id from magic_links m
           where m.firm_id = e.firm_id and m.worker_id = ${w}::uuid))
      or (e.entity_type = 'otp_code' and e.entity_id in (
          select o.id from otp_codes o
            join sessions ss on ss.firm_id = o.firm_id and ss.id = o.session_id
           where o.firm_id = e.firm_id and ss.worker_id = ${w}::uuid)))`;
}

export async function loadActionLog(tx: FirmTx, query: LogQuery, now: Date): Promise<ActionLog> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const timeZone = firm?.timezone ?? "Europe/London";
  const today = localDateOf(now, timeZone);
  const thisYear = today.slice(0, 4);
  const days = range(query, today, timeZone);

  const where: SQL[] = [sql`true`];
  if (days.start && days.end) {
    where.push(sql`e.created_at >= ${days.start} and e.created_at < ${days.end}`);
  }
  if (query.before) where.push(sql`e.id < ${query.before}`);
  if (query.type) {
    const actions = [...LOG_TYPES[query.type].actions];
    where.push(
      sql`e.action in (${sql.join(
        actions.map((a) => sql`${a}`),
        sql`, `,
      )})`,
    );
  }
  if (query.worker) where.push(eventsAboutWorker(query.worker));
  if (query.shift) {
    const s = query.shift;
    where.push(sql`(
      (e.entity_type = 'shift' and e.entity_id = ${s}::uuid)
      or e.data ->> 'shiftId' = ${s}
      or (e.entity_type = 'assignment' and e.entity_id in (
          select a.id from assignments a where a.firm_id = e.firm_id and a.shift_id = ${s}::uuid))
      or (e.entity_type = 'request' and e.entity_id in (
          select r.id from requests r where r.firm_id = e.firm_id and r.shift_id = ${s}::uuid)))`);
  }

  const { rows } = await tx.execute<Row>(sql`
    select e.id, e.action, e.actor_type, e.actor_id::text as actor_id, e.data, e.created_at,
           coalesce(
             e.data ->> 'workerId',
             case when e.actor_type = 'worker' then e.actor_id::text end,
             case when e.entity_type = 'worker' then e.entity_id::text end,
             (select a.worker_id::text from assignments a
               where e.entity_type = 'assignment' and a.firm_id = e.firm_id and a.id = e.entity_id),
             (select r.worker_id::text from requests r
               where e.entity_type = 'request' and r.firm_id = e.firm_id and r.id = e.entity_id),
             (select c.worker_id::text from credentials c
               where e.entity_type = 'credential' and c.firm_id = e.firm_id and c.id = e.entity_id),
             (select p.worker_id::text from pay_records p
               where e.entity_type = 'pay_record' and p.firm_id = e.firm_id and p.id = e.entity_id),
             (select m.worker_id::text from magic_links m
               where e.entity_type = 'magic_link' and m.firm_id = e.firm_id and m.id = e.entity_id),
             (select m.worker_id::text from magic_links m
               where e.entity_type = 'login_request' and m.firm_id = e.firm_id
                 and m.request_id = e.entity_id),
             (select ss.worker_id::text from otp_codes o
                join sessions ss on ss.firm_id = o.firm_id and ss.id = o.session_id
               where e.entity_type = 'otp_code' and o.firm_id = e.firm_id and o.id = e.entity_id)
           ) as subject_worker,
           coalesce(
             e.data ->> 'shiftId',
             case when e.entity_type = 'shift' then e.entity_id::text end,
             (select a.shift_id::text from assignments a
               where e.entity_type = 'assignment' and a.firm_id = e.firm_id and a.id = e.entity_id),
             (select r.shift_id::text from requests r
               where e.entity_type = 'request' and r.firm_id = e.firm_id and r.id = e.entity_id)
           ) as subject_shift
      from events e
     where ${sql.join(where, sql` and `)}
     order by e.id desc
     limit ${LOG_PAGE + 1}
  `);
  const page = rows.slice(0, LOG_PAGE);

  // Names for the words, and the shifts the lines link to.
  const ids = (values: (string | null | undefined)[]) => [
    ...new Set(values.filter((v): v is string => !!v && uuid.safeParse(v).success)),
  ];
  const workerIds = ids(
    page.flatMap((r) => [r.subject_worker, r.actor_type === "worker" ? r.actor_id : null]),
  );
  const officeIds = ids(
    page.flatMap((r) => [
      r.actor_type === "office" ? r.actor_id : null,
      typeof r.data.offeredBy === "string" ? r.data.offeredBy : null,
      typeof r.data.officeUserId === "string" ? r.data.officeUserId : null,
    ]),
  );
  const shiftIds = ids([...page.map((r) => r.subject_shift), query.shift]);
  const codes = [
    ...new Set(page.map((r) => r.data.type).filter((t): t is string => typeof t === "string")),
  ];
  const inList = (list: string[]) =>
    sql.join(
      list.map((v) => sql`${v}`),
      sql`, `,
    );
  const uuids = (list: string[]) => sql`array[${inList(list)}]::uuid[]`;
  const workerNames = new Map(
    workerIds.length === 0
      ? []
      : (
          await tx.execute<{ id: string; name: string }>(
            sql`select id::text, first_name || ' ' || last_name as name
                  from workers where id = any(${uuids(workerIds)})`,
          )
        ).rows.map((w) => [w.id, w.name]),
  );
  const officeNames = new Map(
    officeIds.length === 0
      ? []
      : (
          await tx.execute<{ id: string; name: string }>(
            sql`select id::text, name from office_users where id = any(${uuids(officeIds)})`,
          )
        ).rows.map((o) => [o.id, o.name]),
  );
  const credentialNames = new Map(
    codes.length === 0
      ? []
      : (
          await tx.execute<{ code: string; name: string }>(
            sql`select code, name from credential_types where code in (${inList(codes)})`,
          )
        ).rows.map((c) => [c.code, c.name]),
  );
  type ShiftRow = { id: string; role: string; starts_at: string | Date; site_name: string | null };
  const shiftRows =
    shiftIds.length === 0
      ? []
      : (
          await tx.execute<ShiftRow>(sql`
            select s.id::text, s.role, s.starts_at, si.name as site_name
              from shifts s
              left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
             where s.id = any(${uuids(shiftIds)})`)
        ).rows;
  const shiftLabel = (s: ShiftRow) => {
    const at = new Date(s.starts_at);
    const w = wallTimeOf(at, timeZone);
    return `${roleLabel(s.role)}${s.site_name ? ` at ${s.site_name}` : ""}, ${dayWithYear(localDateOf(at, timeZone), thisYear)} ${pad(w.hour)}:${pad(w.minute)}`;
  };
  const shiftLabels = new Map(shiftRows.map((s) => [s.id, shiftLabel(s)]));
  const names = {
    worker: (id: unknown) => workerNames.get(String(id)) ?? "Someone",
    office: (id: unknown) => officeNames.get(String(id)) ?? "The office",
    credential: (code: unknown) =>
      credentialNames.get(String(code)) ?? String(code ?? "credential").replace(/_/g, " "),
  };

  const entries: LogEntry[] = page.map((r) => {
    const shiftId = r.subject_shift && shiftLabels.has(r.subject_shift) ? r.subject_shift : null;
    return {
      id: Number(r.id),
      at: new Date(r.created_at),
      type: logTypeLabel(r.action),
      words: eventWords(
        {
          action: r.action,
          actorType: r.actor_type,
          actorId: r.actor_id,
          // The worker the event is about, for the words (when it doesn't name one itself).
          data: { ...r.data, workerId: r.subject_worker ?? r.data.workerId },
        },
        names,
      ),
      shift: shiftId ? { id: shiftId, label: shiftLabels.get(shiftId) ?? "" } : null,
    };
  });

  // For the filter form: everyone, and the shifts in the chosen dates (plus the chosen one).
  const people = await tx
    .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
    .from(workers)
    .orderBy(asc(workers.lastName), asc(workers.firstName), asc(workers.id))
    .limit(2000);
  const inRange =
    days.start && days.end
      ? (
          await tx.execute<ShiftRow>(sql`
            select s.id::text, s.role, s.starts_at, si.name as site_name
              from shifts s
              left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
             where s.starts_at >= ${days.start} and s.starts_at < ${days.end}
             order by s.starts_at, s.id
             limit 200`)
        ).rows
      : [];
  const shiftOptions = inRange.map((s) => ({ id: s.id, label: shiftLabel(s) }));
  if (
    query.shift &&
    shiftLabels.has(query.shift) &&
    !shiftOptions.some((s) => s.id === query.shift)
  ) {
    shiftOptions.unshift({ id: query.shift, label: shiftLabels.get(query.shift) ?? "" });
  }

  return {
    timeZone,
    thisYear,
    filters: {
      worker: query.worker,
      shift: query.shift,
      type: query.type,
      from: days.from,
      to: days.to,
    },
    clamped: days.clamped,
    entries,
    older: rows.length > LOG_PAGE ? (entries.at(-1)?.id ?? null) : null,
    workers: people.map((p) => ({ id: p.id, name: `${p.first} ${p.last}` })),
    shifts: shiftOptions,
  };
}

// The page's data for the logged-in office user, or null (logged out, or a role without it).
export async function officeActionLog(
  ctx: AuthContext,
  token: string,
  query: LogQuery,
): Promise<ActionLog | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "log")) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, (tx) => loadActionLog(tx, query, now));
}
