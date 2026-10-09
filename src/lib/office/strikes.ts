import { eq, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/link-login";
import { authParts } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import {
  evidenceStuckSql,
  lastEvidenceCodeSql,
  NOTHING_SENT_CODES,
} from "../strikes/evidence-queue";
import { strikeSettings } from "../strikes/settings";

// The Strikes page (docs/office-v2.md 3.5; docs/screens.md `/office/strikes`; 12C.5), for admins
// and resourcers (checked here as well as on the page; payroll never sees a strike). One row per
// casual with a strike: how many still count (live: not withdrawn and not past its date), whether
// one waits for a review, and their strikes newest first (the latest first), each with its
// session, notice and evidence email, linking to its cancellation record (where it's withdrawn or
// kept). Views: Live (a strike still counting), Needs review (one still counting, flagged), All. Sorted
// by the live count, then the latest strike. Reads only, inside the firm.

export const STRIKE_VIEWS = ["live", "review", "all"] as const;
export type StrikeView = (typeof STRIKE_VIEWS)[number];
export const STRIKES_PAGE_CASUALS = 200;
export const STRIKES_PER_CASUAL = 10;

export interface CasualStrike {
  assignmentId: string;
  ref: string;
  role: string;
  siteName: string | null;
  startsAt: Date;
  cancelledAt: Date;
  noticeHours: number;
  status: "live" | "withdrawn";
  counting: boolean; // live and not past its date
  expiresAt: Date;
  reviewNeeded: boolean;
  evidence: {
    status: string | null;
    sentAt: Date | null;
    stuck: boolean;
    nothingSent: boolean;
  };
}

export interface StrikesRow {
  workerId: string;
  casual: string;
  live: number; // strikes still counting
  review: boolean; // a live strike waits for a review
  strikes: CasualStrike[]; // newest first, at most STRIKES_PER_CASUAL
  more: boolean; // they have more than that
}

export interface StrikesList {
  view: StrikeView;
  timeZone: string;
  liveDays: number;
  noticeHours: number; // the firm's threshold
  rows: StrikesRow[];
  total: number; // casuals in the view
}

// Which casuals a view holds (a HAVING over their strikes).
const viewFilter = (view: StrikeView, now: Date) =>
  view === "live"
    ? sql`count(*) filter (where st.status = 'live' and st.expires_at > ${now}) > 0`
    : view === "review"
      ? sql`bool_or(st.status = 'live' and st.review_needed and st.expires_at > ${now})`
      : sql`true`;

export async function loadStrikes(
  tx: FirmTx,
  o: { view: StrikeView; now: Date; limit?: number },
): Promise<StrikesList> {
  const [firm] = await tx
    .select({ timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const limit = o.limit ?? STRIKES_PAGE_CASUALS;
  const { rows: casuals } = await tx.execute<{
    worker_id: string;
    first_name: string | null;
    last_name: string | null;
    live: number;
    review: boolean;
    total: number;
  }>(sql`
    select w.id::text as worker_id, w.first_name, w.last_name,
           count(*) filter (where st.status = 'live' and st.expires_at > ${o.now})::int as live,
           coalesce(bool_or(st.status = 'live' and st.review_needed and st.expires_at > ${o.now}),
                    false) as review,
           max(st.issued_at) as latest, count(*) over ()::int as total
      from strikes st
      join workers w on w.firm_id = st.firm_id and w.id = st.worker_id
     group by w.id, w.first_name, w.last_name
    having ${viewFilter(o.view, o.now)}
     order by live desc, latest desc, w.id
     limit ${limit}
  `);
  const ids = casuals.map((c) => c.worker_id);
  const { rows: strikeRows } =
    ids.length === 0
      ? { rows: [] }
      : await tx.execute<{
          worker_id: string;
          assignment_id: string;
          role: string;
          site_name: string | null;
          starts_at: string | Date;
          cancelled_at: string | Date;
          notice_hours: number;
          status: "live" | "withdrawn";
          expires_at: string | Date;
          review_needed: boolean;
          evidence_status: string | null;
          evidence_sent_at: string | Date | null;
          evidence_stuck: boolean;
          evidence_code: string | null;
          n: number;
        }>(sql`
          select * from (
            select st.worker_id::text, st.assignment_id::text, s.role, si.name as site_name,
                   s.starts_at, a.cancelled_at, st.notice_hours::float as notice_hours, st.status,
                   st.expires_at, st.review_needed,
                   st.evidence_email_status as evidence_status,
                   st.evidence_email_sent_at as evidence_sent_at,
                   coalesce(${evidenceStuckSql("st")}, false) as evidence_stuck,
                   ${lastEvidenceCodeSql("st")} as evidence_code,
                   row_number() over (partition by st.worker_id
                                      order by st.issued_at desc, st.id)::int as n
              from strikes st
              join assignments a on a.firm_id = st.firm_id and a.id = st.assignment_id
              join shifts s on s.firm_id = st.firm_id and s.id = st.shift_id
              left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
             where st.worker_id in (${sql.join(
               ids.map((id) => sql`${id}::uuid`),
               sql`, `,
             )})
          ) x
          where x.n <= ${STRIKES_PER_CASUAL + 1}
          order by x.worker_id, x.n
        `);
  const byWorker = new Map<string, CasualStrike[]>();
  for (const r of strikeRows) {
    const list = byWorker.get(r.worker_id) ?? [];
    const expiresAt = new Date(r.expires_at);
    list.push({
      assignmentId: r.assignment_id,
      ref: r.assignment_id.slice(0, 8).toUpperCase(),
      role: r.role,
      siteName: r.site_name,
      startsAt: new Date(r.starts_at),
      cancelledAt: new Date(r.cancelled_at),
      noticeHours: Number(r.notice_hours),
      status: r.status,
      counting: r.status === "live" && expiresAt.getTime() > o.now.getTime(),
      expiresAt,
      reviewNeeded: r.review_needed,
      evidence: {
        status: r.evidence_status,
        sentAt: r.evidence_sent_at ? new Date(r.evidence_sent_at) : null,
        stuck: r.evidence_stuck,
        nothingSent: r.evidence_code !== null && NOTHING_SENT_CODES.includes(r.evidence_code),
      },
    });
    byWorker.set(r.worker_id, list);
  }
  return {
    view: o.view,
    timeZone: firm?.timezone ?? "Europe/London",
    liveDays: strikeSettings(firm?.settings ?? {}).liveDays,
    noticeHours: strikeSettings(firm?.settings ?? {}).noticeHours,
    rows: casuals.map((c) => {
      const list = byWorker.get(c.worker_id) ?? [];
      return {
        workerId: c.worker_id,
        casual: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "A casual",
        live: Number(c.live),
        review: c.review,
        strikes: list.slice(0, STRIKES_PER_CASUAL),
        more: list.length > STRIKES_PER_CASUAL,
      };
    }),
    total: Number(casuals[0]?.total ?? 0),
  };
}

export async function officeStrikes(
  ctx: AuthContext,
  token: string,
  view: StrikeView,
): Promise<StrikesList | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "strikes")) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, (tx) => loadStrikes(tx, { view, now }));
}
