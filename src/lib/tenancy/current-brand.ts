import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { errorCode } from "../jobs/firm-job";
import { log } from "../log";
import { type Brand, brandColours, firmBrand } from "./brand";
import { findCurrentFirm } from "./current-firm";

// The brand for this request's firm (src/lib/tenancy/brand.ts), once per page render; null on the
// platform's own address. The root layout draws it on every page, so a failure to read it (the
// database briefly down) mustn't break the layout: the page then shows its own error screen
// (src/app/error.tsx, which also notices a phone with no signal), not the bare global one. If the
// firm was found but its brand couldn't be read, its name in the default colours; if the firm
// couldn't be looked up at all, no bar.
export const getCurrentBrand = cache(async (): Promise<Brand | null> => {
  let firm: Awaited<ReturnType<typeof findCurrentFirm>> = null;
  try {
    firm = await findCurrentFirm();
    if (!firm) return null;
    return (await firmBrand({ firm })) ?? null;
  } catch (err) {
    // Next's own signals (a page rendered at build time reading the request's headers, a redirect,
    // a not-found) aren't failures: they go back to Next (audit L83; each `next build` used to log
    // about 30 of these as errors).
    unstable_rethrow(err);
    log.error("brand: couldn't read the firm's brand", {
      firmId: firm?.id ?? null,
      code: errorCode(err),
    });
    return firm ? { name: firm.name, logoUrl: null, ...brandColours(null) } : null;
  }
});
