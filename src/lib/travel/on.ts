import { eq, sql } from "drizzle-orm";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { travelSettings } from "./settings";

// Whether the current firm has travel areas switched on (`travel.enabled`, 13.4; off by default:
// src/lib/travel/settings.ts). Inside the firm's transaction.
export async function travelOn(tx: FirmTx): Promise<boolean> {
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return travelSettings(firm?.settings ?? {}).enabled;
}
