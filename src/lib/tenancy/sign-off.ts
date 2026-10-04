// Every message to staff ends with the firm's sign-off, "[Firm name] Shift Team" unless the
// firm set its own (golden rule 8). Never a person's name.
//
// A firm may shorten the name part ("Acme Shift Team" for "Acme Events Ltd"), in letters, digits,
// spaces and & ' . - ; the rest is fixed, so it always reads as a team. (It can't tell a firm's
// name from a person's: "Dave Smith Shift Team" passes. Only the owner sets it, with firm:brand,
// for the firm's own name.) Checked where it's set
// (scripts/firm-brand-owner.ts) and again here, where every message gets it (Phase 10, audit L31):
// a stored one that breaks the rule (a direct database edit, a settings screen built later) is
// never used; the default is.
export const SIGN_OFF_RULE = /^[\p{L}\p{N}&'.\- ]{1,48} Shift Team$/u;

// The firm's own sign-off, if it set one that keeps the rule.
export function ownSignOff(configured: unknown): string | null {
  if (typeof configured !== "string") return null;
  const trimmed = configured.trim();
  return SIGN_OFF_RULE.test(trimmed) ? trimmed : null;
}

export function signOffFor(firmName: string, configured: unknown): string {
  return ownSignOff(configured) ?? `${firmName} Shift Team`;
}
