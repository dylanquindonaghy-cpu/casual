"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { isoDay } from "@/lib/metrics/definitions";
import type { SaveFiguresResult, UpdateNowResult } from "@/lib/metrics/entry";
import {
  savePilotFigures,
  updatePilotFiguresNow,
  type OfficeContext,
} from "@/lib/office/quick-actions";
import { requestLog } from "@/lib/request";

// The pilot metrics page's forms (docs/screens.md `/office/reports/pilot`). The firm comes from the
// request's host and the office user from their session (an admin or resourcer: checked here, and
// again inside each change). Input is checked with zod first. Results are shown in place.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asOffice<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "pilot")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

const figures = z.record(z.string().max(40), z.string().max(40));

export async function saveFiguresAction(
  kind: unknown,
  weekStart: unknown,
  values: unknown,
): Promise<SaveFiguresResult | Common | { status: "bad_date" }> {
  const k = z.enum(["baseline", "tally"]).safeParse(kind);
  const week = isoDay.safeParse(weekStart);
  const v = figures.safeParse(values);
  if (!k.success || !v.success) return { status: "error" };
  if (!week.success) return { status: "bad_date" };
  return asOffice("save pilot figures", (ctx) => savePilotFigures(ctx, k.data, week.data, v.data));
}

export async function updateFiguresNowAction(): Promise<UpdateNowResult | Common> {
  return asOffice("update pilot figures", (ctx) => updatePilotFiguresNow(ctx));
}
