"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { setNotificationSettings, setUnavailable } from "@/lib/portal/profile";
import {
  CHANNELS,
  type AvailabilityOutcome,
  type SettingsOutcome,
} from "@/lib/portal/profile-kinds";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// The profile's two changes. The firm comes from the request's host and the worker from their
// session; the browser sends only the day (and whether to mark or clear it), or the two settings.

export async function setUnavailableAction(day: string, on: boolean): Promise<AvailabilityOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const input = z
    .object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), on: z.boolean() })
    .safeParse({ day, on });
  if (!input.success) return { status: "invalid" };
  try {
    return await setUnavailable({ firm }, session.worker.id, input.data.day, input.data.on);
  } catch (error) {
    (await requestLog()).error("set unavailable failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

export async function saveNotificationSettingsAction(
  notifyChannel: string,
  offerAlerts: boolean,
): Promise<SettingsOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const input = z
    .object({ notifyChannel: z.enum(CHANNELS), offerAlerts: z.boolean() })
    .safeParse({ notifyChannel, offerAlerts });
  if (!input.success) return { status: "invalid" };
  try {
    return await setNotificationSettings({ firm }, session.worker.id, input.data);
  } catch (error) {
    (await requestLog()).error("save notification settings failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
