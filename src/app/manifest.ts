import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { appEnv } from "@/lib/env";
import { firmForHost } from "@/lib/tenancy/firm";

// The web app manifest (/manifest.webmanifest): what a phone calls the portal on its home screen
// ("Acme Events shifts") and that it opens at My shifts, full screen. Per firm, from the host.
// Icons come with firm branding (parked in PLAN.md).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const firm = await firmForHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  const name = firm ? `${firm.name} shifts` : "ShiftDesk";
  return {
    name,
    short_name: firm?.name ?? "ShiftDesk",
    description: "Your shifts, answered instantly.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a",
  };
}
