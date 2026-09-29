import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { appEnv } from "@/lib/env";
import { errorCode } from "@/lib/jobs/firm-job";
import { log } from "@/lib/log";
import { brandColours, firmBrand } from "@/lib/tenancy/brand";
import { firmForHost } from "@/lib/tenancy/firm";

// The web app manifest (/manifest.webmanifest): what a phone calls the portal on its home screen
// ("Acme Events shifts") and that it opens at My shifts, full screen. Per firm, from the host.
// The theme colour is the firm's brand colour. Icons from the firm's logo: parked in PLAN.md.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const firm = await firmForHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  const name = firm ? `${firm.name} shifts` : "ShiftDesk";
  // The phone's bar in the firm's colour (the default if it has none, or it can't be read).
  const brand = firm
    ? await firmBrand({ firm }).catch((err: unknown) => {
        log.error("manifest: couldn't read the firm's brand", {
          firmId: firm.id,
          code: errorCode(err),
        });
        return null;
      })
    : null;
  return {
    name,
    short_name: firm?.name ?? "ShiftDesk",
    description: "Your shifts, answered instantly.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: brand?.background ?? brandColours(null).background,
  };
}
