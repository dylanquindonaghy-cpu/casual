"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import type { QueueOfficeOfferResult } from "@/lib/offers/office-offer";
import {
  markFilled,
  markUrgent,
  offerTo,
  openAgain,
  type OfficeContext,
} from "@/lib/office/quick-actions";
import { officeOfferPage, type OfferPage } from "@/lib/office/offer-page";
import { keepFlaggedBooking, type KeepResult } from "@/lib/office/worker-access";
import type { CloseShiftResult } from "@/lib/roster/close";
import type { SetUrgentResult } from "@/lib/roster/urgent";
import { requestLog } from "@/lib/request";

// The dashboard's quick actions. The firm comes from the request's host and the office user from their
// session (an admin or resourcer: checked here, and again inside each action with the database's
// view of the user). The browser sends only ids. Results are shown in place (no redirect()).

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asOffice<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "today")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

const id = z.uuid();

export async function setUrgentAction(
  shiftId: string,
  urgent: boolean,
): Promise<SetUrgentResult | Common> {
  if (!id.safeParse(shiftId).success || typeof urgent !== "boolean") return { status: "not_found" };
  return asOffice("set urgent", (ctx) => markUrgent(ctx, shiftId, urgent));
}

export async function closeShiftAction(shiftId: string): Promise<CloseShiftResult | Common> {
  if (!id.safeParse(shiftId).success) return { status: "not_found" };
  return asOffice("close shift", (ctx) => markFilled(ctx, shiftId));
}

export async function reopenShiftAction(shiftId: string): Promise<CloseShiftResult | Common> {
  if (!id.safeParse(shiftId).success) return { status: "not_found" };
  return asOffice("reopen shift", (ctx) => openAgain(ctx, shiftId));
}

// The dashboard's offer panel (Phase 24, 24.3): what the offer page shows for the session, read by
// the offer page's own loader (the same people, from the same rules), for the panel to show
// without leaving the dashboard.
export type OfferPanelResult =
  { status: "found"; page: OfferPage } | { status: "not_found" } | Common;

export async function offerPanelAction(shiftId: string): Promise<OfferPanelResult> {
  if (!id.safeParse(shiftId).success) return { status: "not_found" };
  return asOffice("offer panel", async (ctx): Promise<OfferPanelResult> => {
    const page = await officeOfferPage(
      { firm: ctx.firm },
      (await readSessionToken("office")) ?? "",
      shiftId,
    );
    return page ? { status: "found", page } : { status: "not_found" };
  });
}

export async function offerShiftAction(
  shiftId: string,
  workerId: string,
): Promise<QueueOfficeOfferResult | Common> {
  if (!id.safeParse(shiftId).success || !id.safeParse(workerId).success) {
    return { status: "not_found" };
  }
  return asOffice("office offer", (ctx) => offerTo(ctx, shiftId, workerId));
}

// "Keep the booking" on the dashboard's "Bookings to check": the booking stays, and isn't shown again
// unless the worker's status or a site block changes again.
export async function keepBookingAction(
  shiftId: string,
  workerId: string,
): Promise<KeepResult | Common> {
  if (!id.safeParse(shiftId).success || !id.safeParse(workerId).success) {
    return { status: "not_found" };
  }
  return asOffice("keep booking", (ctx) => keepFlaggedBooking(ctx, shiftId, workerId));
}
