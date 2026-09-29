import { sql } from "drizzle-orm";
import { withFirm, type WithFirm } from "../db/scoped";
import { brandColours, safeLogoUrl } from "./brand-values";

export {
  brandColours,
  contrastRatio,
  DEFAULT_BRAND_COLOUR,
  isBrandColour,
  safeLogoUrl,
} from "./brand-values";

// A firm's brand on its portal and office pages (docs/architecture.md "Custom domains and
// branding"; Phase 8): its name, its logo (an https:// address on its own website) and its colour,
// with the text colour that reads best on it. Stored in firms (brand_logo_url, brand_primary_color:
// the database only accepts https:// and #rrggbb) and set by the owner (`npm run firm:brand`).
// Both are checked again here before they reach a page, and only ever reach it as a checked value
// (an <img> address, a React style colour): never raw into CSS or HTML.

export interface Brand {
  name: string;
  logoUrl: string | null;
  background: string; // #rrggbb: the firm's colour, or the default
  text: string; // #000000 or #ffffff, whichever reads better on it
}

// The firm's brand, from its own row (withFirm: another firm's is invisible).
export async function firmBrand(ctx: {
  firm: { id: string };
  run?: WithFirm;
}): Promise<Brand | null> {
  const { rows } = await (ctx.run ?? withFirm)(ctx.firm.id, (tx) =>
    tx.execute<{ name: string; logo: string | null; colour: string | null }>(sql`
      select name, brand_logo_url as logo, brand_primary_color as colour
        from firms where id = app_current_firm_id()`),
  );
  const row = rows[0];
  if (!row) return null;
  return { name: row.name, logoUrl: safeLogoUrl(row.logo), ...brandColours(row.colour) };
}
