import { Client } from "pg";
import { isBrandColour, safeLogoUrl } from "../src/lib/tenancy/brand-values";

// Setting a firm's brand (Phase 8, `npm run firm:brand`, scripts/firm-brand.ts): its name, logo
// address, colour and sign-off. As the owner, like the shifts line (scripts/shifts-line-owner.ts):
// the app role can only read firms. RLS is forced for the owner too, so the change runs with the
// firm set for its transaction only; kept out of src/ on purpose (scripts/invariants.sh,
// invariant 5). Every value is checked before it's saved; the change is logged
// `firm.branding_changed` with the names of the fields that changed, never their values.

export interface BrandChanges {
  name?: string;
  colour?: string; // "#1d4ed8" or "1d4ed8"
  logo?: string | null; // an https:// address, or null for none
  signOff?: string | null; // "{something} Shift Team", or null for "[Firm name] Shift Team"
}

export type SetBrandResult =
  | { status: "saved"; fields: string[] }
  | { status: "unchanged" }
  | { status: "no_firm" }
  | { status: "bad"; field: "name" | "colour" | "logo" | "signOff" };

// Golden rule 8: messages are signed "[Firm name] Shift Team". A firm may shorten the name part
// ("Acme Shift Team" for "Acme Events Ltd"), in letters, digits, spaces and & ' . - ; the rest is
// fixed, so it's never a person's name.
const SIGN_OFF = /^[\p{L}\p{N}&'.\- ]{1,48} Shift Team$/u;
const NAME = /^[^\p{Cc}]{2,80}$/u;

// Spaces around trimmed and runs of spaces made one; checked after, so a new line or tab (a
// control character) is refused, not quietly turned into a space.
const tidy = (s: string) => s.trim().replace(/ {2,}/g, " ");

// The event (the office's action log: src/lib/office/log-types.ts and event-words.ts).
const BRANDING_CHANGED = "firm.branding_changed";

export async function setFirmBrand(
  adminUrl: string,
  slug: string,
  changes: BrandChanges,
): Promise<SetBrandResult> {
  // Every value given is checked, an empty one too (`--logo "$LOGO"` with nothing in it must not
  // quietly remove the logo); null alone means "none" / "the default".
  const name = changes.name === undefined ? undefined : tidy(changes.name);
  if (name !== undefined && !NAME.test(name)) return { status: "bad", field: "name" };
  const colour =
    changes.colour === undefined
      ? undefined
      : `#${changes.colour.trim().replace(/^#/, "")}`.toLowerCase();
  if (colour !== undefined && !isBrandColour(colour)) return { status: "bad", field: "colour" };
  const logo =
    changes.logo === undefined || changes.logo === null
      ? changes.logo
      : safeLogoUrl(changes.logo.trim());
  if (changes.logo !== undefined && changes.logo !== null && logo === null) {
    return { status: "bad", field: "logo" };
  }
  const signOff =
    changes.signOff === undefined || changes.signOff === null
      ? changes.signOff
      : tidy(changes.signOff);
  if (typeof signOff === "string" && !SIGN_OFF.test(signOff)) {
    return { status: "bad", field: "signOff" };
  }

  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    const { rows: found } = await owner.query<{ id: string }>(
      "select id::text as id from firms where slug = $1",
      [slug],
    );
    const firmId = found[0]?.id;
    if (!firmId) return { status: "no_firm" };

    await owner.query("begin");
    try {
      await owner.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
      // Read and change in one transaction, the row held, so two runs at once can't both work
      // from the same old values.
      const { rows } = await owner.query<{
        name: string;
        logo: string | null;
        colour: string | null;
        sign_off: string | null;
      }>(
        `select name, brand_logo_url as logo, brand_primary_color as colour,
                settings ->> 'sign_off' as sign_off
           from firms where id = $1 for update`,
        [firmId],
      );
      const firm = rows[0];
      if (!firm) throw new Error("the firm's row wasn't there inside its own transaction");
      // A rename with the old name's default sign-off stored: the stored one goes, so messages
      // are signed with the new name ("[Firm name] Shift Team") unless a sign-off is given.
      const renamed = name !== undefined && name !== firm.name;
      const newSignOff =
        signOff === undefined && renamed && firm.sign_off === `${firm.name} Shift Team`
          ? null
          : signOff;
      const fields = [
        renamed ? "name" : null,
        colour !== undefined && colour !== firm.colour?.toLowerCase() ? "colour" : null,
        logo !== undefined && logo !== firm.logo ? "logo" : null,
        newSignOff !== undefined && (newSignOff ?? null) !== (firm.sign_off ?? null)
          ? "signOff"
          : null,
      ].filter((f): f is string => f !== null);
      if (fields.length === 0) {
        await owner.query("rollback");
        return { status: "unchanged" };
      }
      const updated = await owner.query(
        `update firms set
           name = coalesce($2, name),
           brand_primary_color = case when $3::boolean then $4 else brand_primary_color end,
           brand_logo_url = case when $5::boolean then $6 else brand_logo_url end,
           settings = case
             when not $7::boolean then settings
             when $8::text is null then settings - 'sign_off'
             else jsonb_set(settings, '{sign_off}', to_jsonb($8::text))
           end
         where id = $1`,
        [
          firmId,
          fields.includes("name") ? name : null,
          fields.includes("colour"),
          colour ?? null,
          fields.includes("logo"),
          logo ?? null,
          fields.includes("signOff"),
          newSignOff ?? null,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("the firm's row wasn't updated");
      await owner.query(
        `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
         values ($1, 'system', $2, 'firm', $1, $3)`,
        [firmId, BRANDING_CHANGED, JSON.stringify({ fields })],
      );
      await owner.query("commit");
      return { status: "saved", fields };
    } catch (err) {
      await owner.query("rollback").catch(() => undefined);
      throw err;
    }
  } finally {
    await owner.end();
  }
}
