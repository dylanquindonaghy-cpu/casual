import type { TodayToMark } from "./today";

// "Who worked?"'s sessions to mark, one group per role, place and time (sessions copied from a sheet
// often come several alike), soonest-ended first as they came, each with how many people are left
// to mark: Needs attention's rows and, since Phase 24, the dashboard's cards.
export function toMarkGroups(list: TodayToMark[]): {
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  unmarked: number;
  sessions: TodayToMark[];
}[] {
  const groups = new Map<string, ReturnType<typeof toMarkGroups>[number]>();
  for (const t of list) {
    const key = [t.role, t.site ?? "", t.startsAt.getTime(), t.endsAt.getTime()].join("|");
    const g = groups.get(key);
    if (g) {
      g.unmarked += t.unmarked;
      g.sessions.push(t);
    } else {
      groups.set(key, {
        role: t.role,
        site: t.site,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        unmarked: t.unmarked,
        sessions: [t],
      });
    }
  }
  return [...groups.values()];
}
