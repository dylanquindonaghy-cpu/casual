import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { firms, metricsDaily } from "../db/schema";
import type { WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeCanPlace, rosterId } from "../roster/book";
import { addDays, localDateOf } from "../time/zoned";
import {
  BASELINE_KEYS,
  BASELINE_METRICS,
  figureSchema,
  isoDay,
  TALLY_KEYS,
  type BaselineMetric,
} from "./definitions";
import { rollupFirm } from "./rollup";

// The office entering the pilot's own figures (docs/pilot-playbook.md), and updating the nightly
// ones on demand. Active admins and resourcers, checked inside each transaction.
// - saveFigures("baseline"): the week-0 baseline, for the week it was counted (day: its first
//   day). "tally": the week's own count of emails, calls, WhatsApp messages and resourcer hours
//   (day: that week's Monday). A blank figure leaves what's there. Each save is logged
//   (metrics.baseline_saved / metrics.tally_saved {weekStart, figures: [{metric, value}]}: numbers
//   only).
// - updateFiguresNow: the nightly rollup for today, straight away.

export type FigureKind = "baseline" | "tally";
const KEYS: Record<FigureKind, readonly BaselineMetric[]> = {
  baseline: BASELINE_KEYS,
  tally: TALLY_KEYS,
};

export const saveFiguresSchema = z.strictObject({
  kind: z.enum(["baseline", "tally"]),
  weekStart: isoDay,
  values: z.record(z.string().max(40), z.string().max(40)),
  by: z.strictObject({ type: z.literal("office"), id: rosterId }),
});
export type SaveFiguresInput = z.input<typeof saveFiguresSchema>;

export type SaveFiguresResult =
  | { status: "saved"; weekStart: string; count: number }
  | { status: "invalid"; problems: BaselineMetric[] } // figures that aren't a number in range
  | { status: "nothing" } // every figure blank
  | { status: "not_allowed" };

// The Monday of the week `day` is in.
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((weekday + 6) % 7));
}

export async function saveFigures(
  run: WithFirm,
  firmId: string,
  raw: SaveFiguresInput,
  deps: { clock?: Clock } = {},
): Promise<SaveFiguresResult> {
  const input = saveFiguresSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  const allowed = KEYS[input.kind];
  const problems: BaselineMetric[] = [];
  const values: Partial<Record<BaselineMetric, number>> = {};
  for (const key of allowed) {
    const text = input.values[key] ?? "";
    const parsed = figureSchema(BASELINE_METRICS[key].max).safeParse(text);
    if (!parsed.success) problems.push(key);
    else if (parsed.data !== "") values[key] = Number(parsed.data);
  }
  if (problems.length > 0) return { status: "invalid", problems };
  const entries = Object.entries(values) as [BaselineMetric, number][];
  if (entries.length === 0) return { status: "nothing" };
  const weekStart = input.kind === "tally" ? mondayOf(input.weekStart) : input.weekStart;

  return run(firmId, async (tx): Promise<SaveFiguresResult> => {
    if (!(await officeCanPlace(tx, input.by.id))) return { status: "not_allowed" };
    await tx
      .insert(metricsDaily)
      .values(
        entries.map(([metric, value]) => ({
          firmId,
          day: weekStart,
          kind: input.kind,
          metric,
          value: value.toFixed(2),
          recordedBy: input.by.id,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [metricsDaily.firmId, metricsDaily.kind, metricsDaily.day, metricsDaily.metric],
        set: { value: sql`excluded.value`, recordedBy: input.by.id, updatedAt: now },
      });
    await recordEvent(tx, {
      actorType: "office",
      actorId: input.by.id,
      action: input.kind === "baseline" ? "metrics.baseline_saved" : "metrics.tally_saved",
      entityType: "firm",
      entityId: firmId,
      // A list of {metric, value}: the log's checks refuse a field named after emails.
      data: { weekStart, figures: entries.map(([metric, value]) => ({ metric, value })) },
    });
    return { status: "saved", weekStart, count: entries.length };
  });
}

export type UpdateNowResult = { status: "updated"; days: number } | { status: "not_allowed" };

export async function updateFiguresNow(
  run: WithFirm,
  firmId: string,
  by: { type: "office"; id: string },
  deps: { clock?: Clock } = {},
): Promise<UpdateNowResult> {
  const now = (deps.clock ?? systemClock).now();
  return run(firmId, async (tx): Promise<UpdateNowResult> => {
    if (!(await officeCanPlace(tx, by.id))) return { status: "not_allowed" };
    const [firm] = await tx
      .select({ timezone: firms.timezone })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    const { days } = await rollupFirm(tx, localDateOf(now, firm?.timezone ?? "Europe/London"), now);
    return { status: "updated", days: days.length };
  });
}
