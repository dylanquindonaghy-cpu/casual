import { sql } from "drizzle-orm";
import { DAY, systemClock } from "../auth/clock";
import { withFirm } from "../db/scoped";
import {
  askedBySql,
  entryShiftIdSql,
  fromCurrentStartSql,
  noticeSql,
  RECORD_ACTIONS,
  recordRow,
  type RecordMove,
  type RecordQueryRow,
  type RowKind,
} from "../notices/record-rows";
import { FIRM_CHANGE_REASONS } from "../roster/firm-reasons";
import {
  ADDED_ON_SHEET,
  CANCELLED_ON_SHEET,
  CHANGED_ON_SHEET,
  REMOVED_ON_SHEET,
  SITE_CHANGED_ON_SHEET,
} from "../roster/sheets/sync";
import { strikeSettings } from "../strikes/settings";
import { CANCEL_REASONS, OTHER_REASON } from "./cancel-reasons";
import type { PortalContext } from "./my-shifts";

// The casual's own shift record (docs/screens.md "The casual app, Phase 28", 28.4; golden rule 12):
// every offer, booking, office move and shortening and cancellation for her in the last 90 days,
// newest first, built by the notice report's own row builder (src/lib/notices/record-rows.ts) with
// the casual's rules on top:
//
// - Whose rows: those that name her (the entry's worker, `worker_ref`), and those about one of her
//   bookings that name no worker at all (an older rota-sheet move). Never one that names someone
//   else, whatever booking it's about.
// - The notice: only the figure the entry logged when it happened. One the builder worked out from
//   the session's current start (an older offer) is null here: "Notice not recorded".
// - Reasons: only fixed words. The office's list (FIRM_CHANGE_REASONS) and the rota sheet's own
//   words on a row the firm started; on her own cancellation, the cancel sheet's list (her own note
//   under "Something else" shows as "Something else"). Never the office's typed reason for placing
//   her (assignments.override_reason), never a firm cancellation's typed cancel_reason, never codes,
//   "overridden", who sent an offer, or any office user.
// - Strikes: her own cancellation's, read from the live strikes row (as Profile's: my-strikes.ts):
//   a strike, withdrawn, or none. With the firm's strikes switched off, none of it.
// - The shift links only while she can open its page: not cancelled or a draft, and either booked
//   by her or shown to casuals (src/lib/portal/shift-detail.ts decides the page the same way).
//
// No event numbers (one counter across every firm: audit L44), no names, no pay. Read only, inside
// her firm (RLS scopes every row to it), for her worker id from her session. Server only.

export const RECORD_DAYS = 90;
export const RECORD_MAX_ROWS = 300;

// Who started it, in the casual's words: her, or the office (a person there, its rota sheet, its
// planner or an offer wave: always "the office", never a name).
export type RecordBy = "you" | "office";
export type RecordStrike = "strike" | "withdrawn" | "none";
export type RecordAskedBy = "client" | "casual";

export interface MyRecordRow {
  at: Date;
  kind: RowKind;
  by: RecordBy;
  shift: {
    id: string;
    role: string;
    site: string | null;
    startsAt: Date;
    canOpen: boolean;
  } | null;
  moved: RecordMove | null;
  noticeHours: number | null; // as logged; null: "Notice not recorded"
  reason: string | null; // fixed words only
  askedBy: RecordAskedBy | null; // the office's cancellation: who asked for it, when recorded
  ref: string | null; // her own cancellation: the booking's reference
  strike: RecordStrike | null; // her own cancellation, with the firm's strikes on
}

export interface MyRecord {
  timeZone: string;
  days: number;
  rows: MyRecordRow[];
  more: boolean; // more than RECORD_MAX_ROWS in the days
}

// The fixed words a row the firm started may show: the office's list and the rota sheet's own.
const FIRM_WORDS: ReadonlySet<string> = new Set<string>([
  ...Object.values(FIRM_CHANGE_REASONS),
  ADDED_ON_SHEET,
  CANCELLED_ON_SHEET,
  CHANGED_ON_SHEET,
  REMOVED_ON_SHEET,
  SITE_CHANGED_ON_SHEET,
]);

export const firmReasonForCasual = (reason: string | null): string | null =>
  reason !== null && FIRM_WORDS.has(reason) ? reason : null;

// Her own cancellation's reason as the cancel sheet's list says it: a quick reason, or "Something
// else" (her note stays off the page); anything else (none should be) shows nothing.
export function ownReasonForCasual(stored: string | null): string | null {
  if (!stored) return null;
  if ((CANCEL_REASONS as readonly string[]).includes(stored)) return stored;
  if (stored === OTHER_REASON || stored.startsWith(`${OTHER_REASON}:`)) return OTHER_REASON;
  return null;
}

type Row = RecordQueryRow & {
  assignment_id: string | null; // her booking the entry is about (never someone else's)
  cancel_reason: string | null; // that booking's, only for her own cancellation
  asked_by: "casual" | "firm" | "client" | "unknown" | null;
  strike_status: "live" | "withdrawn" | null;
  can_open: boolean;
};

type Ctx = PortalContext & { firm: { id: string } };

export async function myRecord(ctx: Ctx, workerId: string): Promise<MyRecord> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  const since = new Date(now.getTime() - RECORD_DAYS * DAY);
  return run(ctx.firm.id, async (tx) => {
    const { rows: firmRows } = await tx.execute<{
      settings: Record<string, unknown>;
      timezone: string;
    }>(sql`select settings, timezone from firms where id = app_current_firm_id()`);
    const timeZone = firmRows[0]?.timezone ?? "Europe/London";
    // Hers in this firm only: a worker id that isn't one of the firm's (none should come from a
    // session) has no record here, even where an entry of this firm happens to name it.
    const { rows: known } = await tx.execute<{ id: string }>(
      sql`select id::text from workers where id = ${workerId}::uuid`,
    );
    if (known.length === 0) return { timeZone, days: RECORD_DAYS, more: false, rows: [] };
    const strikesOn = strikeSettings(firmRows[0]?.settings ?? {}).enabled;
    const actions = sql.join(
      RECORD_ACTIONS.map((a) => sql`${a}`),
      sql`, `,
    );
    // Her entries: each way found on its own index (worker_ref; the entry's booking), as the action
    // log does (src/lib/office/action-log.ts eventsAboutWorker).
    const { rows } = await tx.execute<Row>(sql`
      select e.id, e.action, e.actor_type, e.data, e.created_at,
             ${noticeSql()} as notice, ${fromCurrentStartSql()} as from_current,
             s.id::text as shift_id, s.role, s.starts_at, si.name as site_name,
             a.id::text as assignment_id,
             case when e.action = 'shift.cancelled' and e.data ->> 'by' = 'worker'
                       and a.status = 'cancelled_worker'
                  then a.cancel_reason end as cancel_reason,
             ${askedBySql()} as asked_by,
             st.status as strike_status,
             coalesce(s.status not in ('cancelled', 'draft') and (
               exists (select 1 from assignments b
                        where b.firm_id = s.firm_id and b.shift_id = s.id
                          and b.worker_id = ${workerId}::uuid
                          and b.status in ('confirmed', 'completed', 'no_show'))
               or (s.showing_to_casuals and exists (
                     select 1 from shift_events ev
                      where ev.firm_id = s.firm_id and ev.id = s.event_id
                        and ev.showing_to_casuals))), false) as can_open
        from events e
        left join assignments a on e.entity_type = 'assignment'
          and a.firm_id = e.firm_id and a.id = e.entity_id and a.worker_id = ${workerId}::uuid
        left join shifts s on s.firm_id = e.firm_id and s.id = ${entryShiftIdSql()}
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
        left join strikes st on st.firm_id = e.firm_id and st.assignment_id = a.id
       where e.id in (
               select x.id from events x where x.worker_ref = ${workerId}
               union all
               select x.id from events x
                where x.worker_ref is null and x.entity_type = 'assignment'
                  and x.entity_id in (select m.id from assignments m
                                       where m.worker_id = ${workerId}::uuid))
         and e.action in (${actions})
         and e.created_at >= ${since}
       order by e.created_at desc, e.id desc
       limit ${RECORD_MAX_ROWS + 1}
    `);
    return {
      timeZone,
      days: RECORD_DAYS,
      more: rows.length > RECORD_MAX_ROWS,
      rows: rows.slice(0, RECORD_MAX_ROWS).map((r) => casualRow(r, strikesOn)),
    };
  });
}

// One row as the casual may see it (pure apart from its input).
function casualRow(r: Row, strikesOn: boolean): MyRecordRow {
  const row = recordRow(r);
  const mine = row.initiator === "worker";
  const ownCancel = mine && row.kind === "cancelled";
  return {
    at: row.at,
    kind: row.kind,
    by: mine ? "you" : "office",
    shift: row.shift ? { ...row.shift, canOpen: Boolean(r.can_open) } : null,
    moved: row.moved,
    noticeHours: row.noticeLogged ? row.noticeHours : null,
    reason: ownCancel
      ? ownReasonForCasual(r.cancel_reason)
      : mine
        ? null
        : firmReasonForCasual(row.loggedReason),
    askedBy:
      row.kind === "cancelled" && !mine && (r.asked_by === "client" || r.asked_by === "casual")
        ? r.asked_by
        : null,
    ref: ownCancel && r.assignment_id ? r.assignment_id.slice(0, 8).toUpperCase() : null,
    strike:
      ownCancel && strikesOn
        ? r.strike_status === "live"
          ? "strike"
          : r.strike_status === "withdrawn"
            ? "withdrawn"
            : "none"
        : null,
  };
}
