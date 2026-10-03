import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import {
  CANCELLED_ASSIGNMENT_STATUSES,
  firms,
  officeUsers,
  shifts,
  sites,
  workers,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { previewBooking } from "../roster/book";
import { OVERRIDABLE_CODES, type RuleCode } from "../rules/eligibility";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { eventWords } from "./event-words";

// The office's shift pages (docs/screens.md `/office/shifts`, `/office/shifts/[id]`): reads only,
// inside the firm (RLS scopes every row), for admins and resourcers. The session and role are
// checked here as well as on the page.

export const SHIFT_LIST_DAYS = 28;
const LIST_MAX = 200;
const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

async function asOffice<T>(
  ctx: AuthContext,
  token: string,
  work: (tx: FirmTx, now: Date) => Promise<T>,
): Promise<T | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "shifts")) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, (tx) => work(tx, now));
}

async function timeZoneOf(tx: FirmTx): Promise<string> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return firm?.timezone ?? "Europe/London";
}

export interface ShiftListItem {
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  booked: number;
  status: "draft" | "open" | "filled" | "cancelled";
  isUrgent: boolean;
  fromSheet: boolean;
}

export async function officeShiftList(
  ctx: AuthContext,
  token: string,
  from: Date,
): Promise<{ timeZone: string; until: Date; shifts: ShiftListItem[]; more: boolean } | null> {
  return asOffice(ctx, token, async (tx) => {
    const until = new Date(from.getTime() + SHIFT_LIST_DAYS * 24 * 3_600_000);
    const { rows } = await tx.execute<{
      id: string;
      role: string;
      site_name: string | null;
      starts_at: string | Date;
      ends_at: string | Date;
      headcount: number;
      booked: number;
      status: ShiftListItem["status"];
      is_urgent: boolean;
      source: string;
    }>(sql`
      select s.id, s.role, si.name as site_name, s.starts_at, s.ends_at, s.headcount, s.status,
             s.is_urgent, s.source,
             (select count(*)::int from assignments a
               where a.shift_id = s.id and a.worker_id is not null
                 and a.status not in (${CANCELLED}) and a.slot <= s.headcount) as booked
        from shifts s
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
       where s.starts_at >= ${from} and s.starts_at < ${until}
       order by s.starts_at, s.id
       limit ${LIST_MAX + 1}
    `);
    return {
      timeZone: await timeZoneOf(tx),
      until,
      more: rows.length > LIST_MAX,
      shifts: rows.slice(0, LIST_MAX).map((r) => ({
        shiftId: r.id,
        role: r.role,
        site: r.site_name,
        startsAt: new Date(r.starts_at),
        endsAt: new Date(r.ends_at),
        headcount: r.headcount,
        booked: r.booked,
        status: r.status,
        isUrgent: r.is_urgent,
        fromSheet: r.source === "sheets",
      })),
    };
  });
}

export interface ShiftFormData {
  timeZone: string;
  sites: { id: string; name: string }[];
  roles: string[]; // roles in use at the firm, for suggestions
}

async function formData(tx: FirmTx): Promise<ShiftFormData> {
  const siteRows = await tx
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .orderBy(asc(sites.name));
  const { rows } = await tx.execute<{ role: string }>(sql`
    select role from credential_rules
    union select role from shifts
    union select unnest(roles) from workers
    order by 1
  `);
  return { timeZone: await timeZoneOf(tx), sites: siteRows, roles: rows.map((r) => r.role) };
}

export const officeShiftForm = (ctx: AuthContext, token: string) =>
  asOffice(ctx, token, (tx) => formData(tx));

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

export interface ShiftDetail {
  form: ShiftFormData;
  shift: {
    shiftId: string;
    role: string;
    siteId: string | null;
    site: string | null;
    startsAt: Date;
    endsAt: Date;
    headcount: number;
    booked: number;
    instructions: string | null;
    status: ShiftListItem["status"];
    isUrgent: boolean;
    fromSheet: boolean;
    fromImport: boolean;
    started: boolean;
    ended: boolean;
  };
  edit: { date: string; start: string; end: string; editable: boolean };
  places: {
    assignmentId: string;
    slot: number;
    workerId: string | null;
    worker: string;
    status: string;
    cancelledAt: Date | null;
    noticeHours: number | null;
    reason: string | null;
    // Why this person can't work it as things stand (Phase 10): their status, or a site block.
    flag: "inactive" | "blocked" | "site_blocked" | null;
  }[];
  offers: {
    worker: string;
    wave: number | null;
    byOffice: string | null;
    response: string | null;
    sentAt: Date;
  }[];
  history: { at: Date; words: string }[];
  people: { id: string; name: string }[]; // active workers with the role, not on the shift now
  check: {
    workerId: string;
    name: string;
    ok: boolean;
    reasons: string[];
    codes: RuleCode[];
    overridable: boolean; // every "no" is one the office may override (with a reason)
  } | null;
}

export async function officeShiftDetail(
  ctx: AuthContext,
  token: string,
  shiftId: string,
  checkWorkerId?: string,
): Promise<ShiftDetail | null> {
  if (!z.uuid().safeParse(shiftId).success) return null;
  return asOffice(ctx, token, async (tx, now) => {
    const [s] = await tx
      .select({
        id: shifts.id,
        role: shifts.role,
        siteId: shifts.siteId,
        site: sites.name,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        headcount: shifts.headcount,
        instructions: shifts.instructions,
        status: shifts.status,
        isUrgent: shifts.isUrgent,
        source: shifts.source,
      })
      .from(shifts)
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(eq(shifts.id, shiftId));
    if (!s) return null;
    const form = await formData(tx);
    const tz = form.timeZone;

    const { rows: placeRows } = await tx.execute<{
      id: string;
      slot: number;
      worker_id: string | null;
      first_name: string | null;
      last_name: string | null;
      status: string;
      cancelled_at: string | Date | null;
      notice_hours: string | number | null;
      cancel_reason: string | null;
      worker_status: "active" | "inactive" | "blocked" | null;
      site_blocked: boolean;
    }>(sql`
      select a.id, a.slot, a.worker_id, w.first_name, w.last_name, a.status, a.cancelled_at,
             a.notice_hours, a.cancel_reason, w.status as worker_status,
             exists (select 1 from worker_site_blocks b
                      where b.firm_id = a.firm_id and b.worker_id = a.worker_id
                        and b.site_id = ${s.siteId}) as site_blocked
        from assignments a
        left join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
       where a.shift_id = ${shiftId} and a.worker_id is not null
       order by (a.status in (${CANCELLED})), a.slot, a.cancelled_at desc nulls first
    `);
    const live = placeRows.filter(
      (p) => !(CANCELLED_ASSIGNMENT_STATUSES as readonly string[]).includes(p.status),
    );
    const booked = live.filter((p) => p.slot <= s.headcount).length;

    const { rows: offerRows } = await tx.execute<{
      first_name: string;
      last_name: string;
      wave: number | null;
      office_name: string | null;
      response: string | null;
      sent_at: string | Date;
    }>(sql`
      select w.first_name, w.last_name, o.wave, ou.name as office_name, o.response, o.sent_at
        from offers o
        join workers w on w.firm_id = o.firm_id and w.id = o.worker_id
        left join office_users ou on ou.firm_id = o.firm_id and ou.id = o.offered_by
       where o.shift_id = ${shiftId}
       order by o.sent_at, w.last_name
    `);

    const { rows: eventRows } = await tx.execute<{
      action: string;
      actor_type: string;
      actor_id: string | null;
      data: Record<string, unknown>;
      created_at: string | Date;
    }>(sql`
      select e.action, e.actor_type, e.actor_id, e.data, e.created_at from events e
       where e.entity_id = ${shiftId}
          or e.entity_id in (select a.id from assignments a where a.shift_id = ${shiftId})
          or e.entity_id in (select o.id from offers o where o.shift_id = ${shiftId})
       order by e.id desc
       limit 100
    `);
    const workerIds = new Set<string>();
    const officeIds = new Set<string>();
    for (const e of eventRows) {
      if (typeof e.data.workerId === "string") workerIds.add(e.data.workerId);
      if (typeof e.data.offeredBy === "string") officeIds.add(e.data.offeredBy);
      if (typeof e.data.officeUserId === "string") officeIds.add(e.data.officeUserId);
      if (e.actor_type === "office" && e.actor_id) officeIds.add(e.actor_id);
    }
    const ids = (set: Set<string>) => [...set].filter((id) => z.uuid().safeParse(id).success);
    const workerNames = new Map(
      (ids(workerIds).length
        ? await tx
            .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
            .from(workers)
            .where(inArray(workers.id, ids(workerIds)))
        : []
      ).map((w) => [w.id, `${w.first} ${w.last}`]),
    );
    const officeNames = new Map(
      (ids(officeIds).length
        ? await tx
            .select({ id: officeUsers.id, name: officeUsers.name })
            .from(officeUsers)
            .where(inArray(officeUsers.id, ids(officeIds)))
        : []
      ).map((o) => [o.id, o.name]),
    );
    const names = {
      worker: (id: unknown) => workerNames.get(String(id)) ?? "Someone",
      office: (id: unknown) => officeNames.get(String(id)) ?? "The office",
    };

    const onIt = new Set(live.map((p) => p.worker_id));
    const peopleRows = await tx
      .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
      .from(workers)
      .where(and(eq(workers.status, "active"), sql`${s.role} = any (${workers.roles})`))
      .orderBy(asc(workers.lastName), asc(workers.firstName));
    const people = peopleRows
      .filter((p) => !onIt.has(p.id))
      .map((p) => ({ id: p.id, name: `${p.first} ${p.last}` }));

    let check: ShiftDetail["check"] = null;
    if (checkWorkerId && z.uuid().safeParse(checkWorkerId).success) {
      const [who] = await tx
        .select({ first: workers.firstName, last: workers.lastName })
        .from(workers)
        .where(eq(workers.id, checkWorkerId));
      const verdict = who
        ? await previewBooking(tx, { shiftId, workerId: checkWorkerId, now })
        : null;
      if (who && verdict) {
        check = {
          workerId: checkWorkerId,
          name: `${who.first} ${who.last}`,
          ok: verdict.ok,
          reasons: verdict.reasons,
          codes: verdict.codes,
          overridable:
            !verdict.ok &&
            verdict.codes.length > 0 &&
            verdict.codes.every((c) => (OVERRIDABLE_CODES as readonly string[]).includes(c)),
        };
      }
    }

    const started = s.startsAt.getTime() <= now.getTime();
    return {
      form,
      shift: {
        shiftId: s.id,
        role: s.role,
        siteId: s.siteId,
        site: s.site,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        headcount: s.headcount,
        booked,
        instructions: s.instructions,
        status: s.status,
        isUrgent: s.isUrgent,
        fromSheet: s.source === "sheets",
        fromImport: s.source === "csv",
        started,
        ended: s.endsAt.getTime() <= now.getTime(),
      },
      edit: {
        date: localDateOf(s.startsAt, tz),
        start: hhmm(s.startsAt, tz),
        end: hhmm(s.endsAt, tz),
        editable: !started && s.status !== "cancelled" && s.source !== "sheets",
      },
      places: placeRows.map((p) => ({
        assignmentId: p.id,
        slot: p.slot,
        workerId: p.worker_id,
        worker: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        status: p.status,
        cancelledAt: p.cancelled_at ? new Date(p.cancelled_at) : null,
        noticeHours: p.notice_hours === null ? null : Number(p.notice_hours),
        reason: p.cancel_reason,
        flag:
          p.worker_status === "inactive" || p.worker_status === "blocked"
            ? p.worker_status
            : p.site_blocked
              ? "site_blocked"
              : null,
      })),
      offers: offerRows.map((o) => ({
        worker: `${o.first_name} ${o.last_name}`,
        wave: o.wave,
        byOffice: o.office_name,
        response: o.response,
        sentAt: new Date(o.sent_at),
      })),
      history: eventRows.map((e) => ({
        at: new Date(e.created_at),
        words: eventWords(
          { action: e.action, actorType: e.actor_type, actorId: e.actor_id, data: e.data },
          names,
        ),
      })),
      people,
      check,
    };
  });
}
