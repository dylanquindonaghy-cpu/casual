import { eq, sql } from "drizzle-orm";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// Enquiries' "Requests from the app" (docs/screens.md `/office/enquiries`; `/office/requests` until
// 12D.1): what casuals asked in the app (time changes, swaps, reviews), for an admin or resourcer to
// approve or decline. A question from the shifts line (`general`) is on Enquiries with its message
// instead, while the message is there; once it has gone (the 90-day purge, an erasure: its
// `message_id` cleared) an open question is answered here, so none is ever lost. The session and
// role are checked here as well as on the page. Reads only, inside the firm (RLS scopes every row
// to it).
//
// - waiting: open and escalated requests, oldest first (first asked, first answered), at most 100;
// - answered: requests answered (or sorted) in the last 7 days, newest first, at most 50, with who
//   answered, their note and whether the worker has been told yet.
// Each with the worker, the shift (if any) and what they asked, from the request's payload: the
// times for a time change, who they'd swap with, the rules' reasons for a review, their note.

export const WAITING_MAX = 100;
export const ANSWERED_MAX = 50;
export const ANSWERED_DAYS = 7;

export interface QueueRequest {
  requestId: string;
  ref: string;
  type: string;
  status: string;
  worker: { id: string; name: string; firstName: string };
  shift: {
    shiftId: string;
    role: string;
    site: string | null;
    startsAt: Date;
    endsAt: Date;
  } | null;
  asked: {
    start: string | null; // a time change's wall-clock times
    end: string | null;
    swapWith: string | null;
    reasons: string[]; // a review: the words the worker was shown
    cancellation: string | null; // a review after cancelling: the booking's reference
    note: string | null; // the worker's own note
    voicemail: boolean; // from a voicemail on the shifts line (the caller's number, unchecked)
  };
  createdAt: Date;
  answer: {
    by: string | null;
    at: Date | null;
    note: string | null;
    // Telling the worker: the latest request-update step (null: the job hasn't run yet).
    told: "sending" | "sent" | "held" | "failed" | null;
  } | null;
}

export interface RequestQueue {
  timeZone: string;
  waiting: QueueRequest[];
  waitingMore: boolean;
  answered: QueueRequest[];
}

type Row = {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string | Date;
  resolved_at: string | Date | null;
  resolution_note: string | null;
  resolver: string | null;
  told: string | null;
  worker_id: string;
  first_name: string;
  last_name: string;
  shift_id: string | null;
  role: string | null;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  site_name: string | null;
};

const text = (v: unknown, max = 500): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

function toRequest(r: Row): QueueRequest {
  const p = r.payload ?? {};
  return {
    requestId: r.id,
    ref: r.id.slice(0, 8).toUpperCase(),
    type: r.type,
    status: r.status,
    worker: {
      id: r.worker_id,
      name: `${r.first_name} ${r.last_name}`,
      firstName: r.first_name,
    },
    shift:
      r.shift_id && r.role && r.starts_at && r.ends_at
        ? {
            shiftId: r.shift_id,
            role: r.role,
            site: r.site_name,
            startsAt: new Date(r.starts_at),
            endsAt: new Date(r.ends_at),
          }
        : null,
    asked: {
      start: text(p.start, 5),
      end: text(p.end, 5),
      swapWith: text(p.swapWith, 100),
      reasons: Array.isArray(p.reasons)
        ? p.reasons.filter((x): x is string => typeof x === "string").slice(0, 10)
        : [],
      note: text(p.note),
      cancellation:
        typeof p.cancellation === "string" && /^[0-9A-F]{8}$/.test(p.cancellation)
          ? p.cancellation
          : null,
      voicemail: p.via === "voicemail",
    },
    createdAt: new Date(r.created_at),
    answer:
      r.status === "open" || r.status === "escalated"
        ? null
        : {
            by: r.resolver,
            at: r.resolved_at ? new Date(r.resolved_at) : null,
            note: r.resolution_note,
            told: TOLD[r.told ?? ""] ?? null,
          },
  };
}

const TOLD: Record<string, "sending" | "sent" | "held" | "failed"> = {
  "request.update_notice": "sending",
  "request.update_sent": "sent",
  "request.update_held": "held",
  "request.update_failed": "failed",
};

const SELECT = sql`
  select r.id, r.type, r.status, r.payload, r.created_at, r.resolved_at, r.resolution_note,
         o.name as resolver,
         (select e.action from events e
           where e.firm_id = r.firm_id and e.entity_id = r.id
             and e.action in ('request.update_notice', 'request.update_sent',
                              'request.update_held', 'request.update_failed')
           order by e.id desc limit 1) as told,
         w.id as worker_id, w.first_name, w.last_name,
         s.id as shift_id, s.role, s.starts_at, s.ends_at, si.name as site_name
    from requests r
    join workers w on w.firm_id = r.firm_id and w.id = r.worker_id
    left join shifts s on s.firm_id = r.firm_id and s.id = r.shift_id
    left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
    left join office_users o on o.firm_id = r.firm_id and o.id = r.resolved_by
`;

export async function loadRequestQueue(tx: FirmTx, now: Date): Promise<RequestQueue> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const { rows: waiting } = await tx.execute<Row>(sql`
    ${SELECT}
     where r.status in ('open', 'escalated') and (r.type <> 'general' or r.message_id is null)
     order by r.created_at, r.id
     limit ${WAITING_MAX + 1}
  `);
  const { rows: answered } = await tx.execute<Row>(sql`
    ${SELECT}
     where r.status in ('approved', 'declined', 'auto_resolved')
       and (r.type <> 'general' or r.message_id is null)
       and r.resolved_at > ${new Date(now.getTime() - ANSWERED_DAYS * 24 * 3_600_000)}
     order by r.resolved_at desc, r.id
     limit ${ANSWERED_MAX}
  `);
  return {
    timeZone: firm?.timezone ?? "Europe/London",
    waiting: waiting.slice(0, WAITING_MAX).map(toRequest),
    waitingMore: waiting.length > WAITING_MAX,
    answered: answered.map(toRequest),
  };
}

// The page's data for the logged-in office user, or null (logged out, or a role without it).
export async function officeRequestQueue(
  ctx: AuthContext,
  token: string,
): Promise<RequestQueue | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "enquiries")) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, (tx) => loadRequestQueue(tx, now));
}
