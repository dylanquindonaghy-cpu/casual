import type { Brand } from "@/lib/tenancy/brand";

// The firm's bar at the top of every portal and office page (Phase 8 branding): its logo, if it
// has one, and its name, on its colour with the text colour that reads best on it. The logo is
// decorative (the name is beside it), and the firm's site isn't told which page it's on.
export function BrandBar({ brand }: { brand: Brand }) {
  return (
    <div
      data-testid="brand-bar"
      className="px-4 py-2"
      style={{ backgroundColor: brand.background, color: brand.text }}
    >
      <div className="mx-auto flex min-h-10 max-w-2xl items-center gap-3">
        {brand.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a firm's own https logo, from any host (next/image would need each host listed)
          <img
            src={brand.logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-10 w-auto max-w-32 object-contain"
          />
        )}
        <span className="text-lg font-semibold">{brand.name}</span>
      </div>
    </div>
  );
}
