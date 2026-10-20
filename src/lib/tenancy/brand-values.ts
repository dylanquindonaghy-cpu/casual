// The checks and colours behind a firm's brand (src/lib/tenancy/brand.ts), pure and on their own so
// the owner's script (scripts/firm-brand-owner.ts) can use them without the app's database layer.

export const DEFAULT_BRAND_COLOUR = "#0f172a"; // slate-900, the app's own

const HEX = /^#[0-9a-fA-F]{6}$/;

// A logo address that's safe to put in an <img>: https only, no user name or password in it, at
// most 500 characters. Anything else: no logo.
export function safeLogoUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    // As stored and shown: percent-encoding can make it longer than what was typed.
    return url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

export const isBrandColour = (raw: unknown): raw is string =>
  typeof raw === "string" && HEX.test(raw);

// WCAG 2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// The firm's colour (or the default) and black or white text on it, whichever contrasts more:
// for any colour that's at least 4.58:1 (WCAG AA for normal text is 4.5:1). `own`: the firm set a
// colour of its own (then its pages use it for their main action too: src/app/layout.tsx).
export function brandColours(raw: unknown): { background: string; text: string; own: boolean } {
  const own = isBrandColour(raw);
  const background = own ? raw.toLowerCase() : DEFAULT_BRAND_COLOUR;
  const text =
    contrastRatio(background, "#ffffff") >= contrastRatio(background, "#000000")
      ? "#ffffff"
      : "#000000";
  return { background, text, own };
}
