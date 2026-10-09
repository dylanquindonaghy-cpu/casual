import { sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { withFirm } from "../db/scoped";
import { strikeSettings } from "../strikes/settings";
import type { PortalContext } from "./my-shifts";

// The casual's own strikes, for Profile (docs/office-v2.md 4.6; 12C.5): how many still count (in
// the firm's `strikes.live_days`, not withdrawn), the firm's notice rule, and each of their strikes
// kept (newest first, the latest MY_STRIKES_MAX): the session, when they cancelled, the notice, until when it counts and
// whether it was withdrawn. Never the withdrawal's reason (the office's words) or the review flag.
// Only their own, inside their firm. Server only.

export const MY_STRIKES_MAX = 20;

export interface MyStrike {
  shiftId: string;
  role: string;
  siteName: string | null;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date;
  noticeHours: number;
  expiresAt: Date;
  status: "live" | "withdrawn";
  counting: boolean; // live and not past its date
}

export interface MyStrikes {
  timeZone: string;
  counting: number;
  liveDays: number;
  noticeHours: number;
  strikes: MyStrike[];
  more: boolean; // they have more than MY_STRIKES_MAX
}

type Ctx = PortalContext & { firm: { id: string } };

export async function myStrikes(ctx: Ctx, workerId: string): Promise<MyStrikes> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const { rows: firmRows } = await tx.execute<{
      settings: Record<string, unknown>;
      timezone: string;
    }>(sql`select settings, timezone from firms where id = app_current_firm_id()`);
    const settings = strikeSettings(firmRows[0]?.settings ?? {});
    const { rows } = await tx.execute<{
      shift_id: string;
      role: string;
      site_name: string | null;
      starts_at: string | Date;
      ends_at: string | Date;
      cancelled_at: string | Date;
      notice_hours: number;
      expires_at: string | Date;
      status: "live" | "withdrawn";
    }>(sql`
      select st.shift_id::text, s.role, si.name as site_name, s.starts_at, s.ends_at,
             a.cancelled_at, st.notice_hours::float as notice_hours, st.expires_at, st.status
        from strikes st
        join assignments a on a.firm_id = st.firm_id and a.id = st.assignment_id
        join shifts s on s.firm_id = st.firm_id and s.id = st.shift_id
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
       where st.worker_id = ${workerId}
       order by st.issued_at desc, st.id
       limit ${MY_STRIKES_MAX + 1}
    `);
    const { rows: counted } = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from strikes
       where worker_id = ${workerId} and status = 'live' and expires_at > ${now}
    `);
    return {
      timeZone: firmRows[0]?.timezone ?? "Europe/London",
      counting: Number(counted[0]?.n ?? 0),
      liveDays: settings.liveDays,
      noticeHours: settings.noticeHours,
      more: rows.length > MY_STRIKES_MAX,
      strikes: rows.slice(0, MY_STRIKES_MAX).map((r) => {
        const expiresAt = new Date(r.expires_at);
        return {
          shiftId: r.shift_id,
          role: r.role,
          siteName: r.site_name,
          startsAt: new Date(r.starts_at),
          endsAt: new Date(r.ends_at),
          cancelledAt: new Date(r.cancelled_at),
          noticeHours: Number(r.notice_hours),
          expiresAt,
          status: r.status,
          counting: r.status === "live" && expiresAt.getTime() > now.getTime(),
        };
      }),
    };
  });
}
