import { eq } from "drizzle-orm";
import { firms } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import { strikeSettings } from "../strikes/settings";
import { photoSettings } from "../uploads/settings";

// The firm's own numbers the help page states (docs/office-v2.md 4.7; 12H.3): the notice that
// avoids a strike, how long a strike counts, and how often a staff photo is renewed. Read inside
// the firm's own transaction (the help page is open without logging in; the firm comes from the
// address). Defaults when a setting isn't set, as everywhere else.

export interface HelpFacts {
  noticeHours: number; // strikes.notice_hours (48)
  liveDays: number; // strikes.live_days (90)
  photoRenewalMonths: number; // photo.renewal_months (36)
}

export async function helpFacts(firmId: string, run: WithFirm = withFirm): Promise<HelpFacts> {
  return run(firmId, async (tx) => {
    const [firm] = await tx
      .select({ settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, firmId));
    const settings = firm?.settings ?? {};
    const strikes = strikeSettings(settings);
    return {
      noticeHours: strikes.noticeHours,
      liveDays: strikes.liveDays,
      photoRenewalMonths: photoSettings(settings).renewalMonths,
    };
  });
}
