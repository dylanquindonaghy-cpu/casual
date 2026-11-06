import { systemClock } from "../auth/clock";
import { addDays, localDateOf, mondayOf } from "../time/zoned";
import type { WeekBooking } from "./home-week";
import { myRecord, type MyRecordRow } from "./my-record";
import { myShifts, type MyShift, type PortalContext } from "./my-shifts";
import { myStrikes } from "./my-strikes";
import { openShiftsFor, type OpenShiftsList } from "./open-shifts";
import { myProfile, type Profile } from "./profile";
import { UPDATES_MAX } from "./home-copy";

// What Home's new parts read (Phase 30.1; docs/screens.md "### 30.1"), for the logged-in casual
// only, inside her firm, through the loaders her other pages already use (never a second reading of
// the same rows):
// - her qualifications, other qualifications on file, right to work, staff photo and reliability:
//   Profile's own loader (myProfile), so Home and Profile never disagree (the office's "in hand"
//   included);
// - her strikes that still count: Profile's (myStrikes);
// - her latest UPDATES_MAX entries: her shift record's (myRecord);
// - her bookings this week and next: Booked's own lists (myShifts upcoming, which the page already
//   has, and past, for the days of this week already worked).
// Server only.

type Ctx = PortalContext & { firm: { id: string; timezone: string } };

export interface MyHome {
  profile: Profile | null;
  strikes: { counting: number; liveDays: number; shown: boolean };
  updates: MyRecordRow[];
  week: WeekBooking[];
}

export async function myHome(ctx: Ctx, workerId: string, upcoming: MyShift[]): Promise<MyHome> {
  const now = (ctx.clock ?? systemClock).now();
  const [profile, strikes, record, past] = await Promise.all([
    myProfile(ctx, workerId),
    myStrikes(ctx, workerId),
    myRecord(ctx, workerId),
    myShifts(ctx, workerId, "past"),
  ]);
  return {
    profile,
    strikes: {
      counting: strikes.counting,
      liveDays: strikes.liveDays,
      // As Profile: with strikes off and none given before, there's nothing to say (P3.4).
      shown: strikes.enabled || strikes.strikes.length > 0,
    },
    updates: record.rows.slice(0, UPDATES_MAX),
    week: weekBookings([...past, ...upcoming], now, ctx.firm.timezone),
  };
}

// Her bookings that start this week or next (Monday to Sunday, the firm's calendar), each once.
export function weekBookings(shifts: readonly MyShift[], now: Date, timeZone: string) {
  const from = mondayOf(localDateOf(now, timeZone));
  const to = addDays(from, 14);
  const seen = new Set<string>();
  return shifts
    .filter((s) => {
      const day = localDateOf(s.startsAt, timeZone);
      if (day < from || day >= to || seen.has(s.assignmentId)) return false;
      seen.add(s.assignmentId);
      return true;
    })
    .map((s) => ({ shiftId: s.shiftId, role: s.role, startsAt: s.startsAt, endsAt: s.endsAt }));
}

// Urgent's count, as /urgent counts it: the urgent ones in her list of shifts she can take, unless
// that list was cut at the rules' limit (`truncated`), when the urgent board's own list is read.
export async function urgentCount(
  ctx: PortalContext,
  workerId: string,
  open: OpenShiftsList,
): Promise<number> {
  if (!open.truncated) return open.shifts.filter((s) => s.isUrgent).length;
  return (await openShiftsFor(ctx, workerId, { urgent: true })).shifts.length;
}
