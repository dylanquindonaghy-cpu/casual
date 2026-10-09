import { eq, sql } from "drizzle-orm";
import { firms } from "../db/schema";
import { withFirm } from "../db/scoped";
import type { OfficeContext } from "../office/office-context";
import { retentionSettings, type RetentionSettings } from "./retention-settings";

// The firm's retention settings, for the office's Data requests page ("How long we keep things").
export async function firmRetention(ctx: OfficeContext): Promise<RetentionSettings> {
  return (ctx.run ?? withFirm)(ctx.firm.id, async (tx) => {
    const [firm] = await tx
      .select({ settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    return retentionSettings(firm?.settings ?? {});
  });
}
