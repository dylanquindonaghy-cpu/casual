import type { Brand } from "@/lib/tenancy/brand";

// The firm's bar at the top of every portal and office page (Phase 8 branding; Phase 18's
// header; Phase 20): its logo, or its initial on the firm's colour (the band colour worked out in
// src/lib/tenancy/brand-values.ts, through the page's brand-bar tokens), then its name, on the
// page's own ground (no card, no line). The logo is decorative (the name is beside it), and the
// firm's site isn't told which page it's on. In the copy kept for when there's no signal, an
// "Offline" plate at its end (globals.css shows [data-offline-only] only there). The name lines up
// with the 448px staff column under it. Staff pages and logged-out office pages only: under the
// office shell (data-shell="office") the shell names the firm instead (docs/office-v2.md 3.1).
export function BrandBar({ brand }: { brand: Brand }) {
  const initial = brand.name.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "";
  return (
    <header
      data-testid="brand-bar"
      className="bg-canvas text-ink [body:has([data-shell=office])_&]:hidden"
    >
      <div className="mx-auto flex min-h-14 max-w-md items-center gap-3 px-4 py-2 sm:px-6">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a firm's own https logo, from any host (next/image would need each host listed)
          <img
            src={brand.logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-9 w-auto max-w-32 object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            data-testid="brand-mark"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-bar text-base font-semibold text-on-brand-bar"
          >
            {initial}
          </span>
        )}
        <span data-testid="brand-name" className="min-w-0 truncate text-lg font-semibold">
          {brand.name}
        </span>
        <span
          data-offline-only=""
          className="ml-auto rounded-full bg-ink px-2.5 text-sm leading-6 font-semibold text-on-ink"
        >
          Offline
        </span>
      </div>
    </header>
  );
}
