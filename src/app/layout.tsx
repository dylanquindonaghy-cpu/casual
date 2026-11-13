import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import { showsDemo } from "@/lib/demo/firms";
import { FRAME_FAILS_COOKIE, frameFailsOnce } from "@/lib/e2e/fails-once";
import { appEnv } from "@/lib/env";
import { brandStyle } from "@/lib/tenancy/brand-values";
import { getCurrentBrand } from "@/lib/tenancy/current-brand";
import { findCurrentFirm } from "@/lib/tenancy/current-firm";
import { BrandBar } from "./brand-bar";
import { DemoBar } from "./demo-bar";
import { SkipToMenu } from "./skip-to-menu";
import { fontVariables } from "./fonts";
import { THEME_COOKIE, themeFromCookie } from "./theme";
import "./globals.css";

// The tab's title and the home screen's name are the firm's ("Acme Events shifts", as in
// app/manifest.ts); "ShiftDesk" on the platform's own address. A page can name itself first
// (`metadata = { title: "Shifts" }` gives "Shifts · Acme Events shifts"); pages that don't keep
// the plain title. Opens full screen from a phone's home screen.
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getCurrentBrand();
  const title = brand ? `${brand.name} shifts` : "ShiftDesk";
  return {
    title: { default: title, template: `%s · ${title}` },
    description: "Your shifts, answered instantly.",
    appleWebApp: { capable: true, statusBarStyle: "default", title },
  };
}

// Both colour schemes are supported (the browser draws its own controls and scrollbars to match).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

// Every firm page opens with the firm's bar (its logo, name and colour); the platform's own
// address has none. Under the office shell (src/app/office/office-shell.tsx) the page is a
// column, so the shell fills the window below the bar.
// The theme comes from the sd-theme cookie (src/app/theme.ts), written onto <html> here so the
// page arrives in its colours; with no cookie, the device decides.
// On a demo server (DEMO_MODE=on) every page of a demo firm starts with the demo bar (16.1).
// Phase 30.2: after them, "Skip to the menu", seen only when focused on a casual page from 1024px.
// Round 8's look (Phase 26; the casual app's since Phase 27.6): <body>'s plain ground (bg-canvas)
// is under every page with nothing drawn over it (Phase 27.7: the street pattern is gone), and
// nothing bends what's behind the glass (round 7's refraction filter and its Chromium-only switch
// are gone).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  // The browser test of the whole-page error screen (only in the e2e run; otherwise nothing).
  await frameFailsOnce(async () => jar.get(FRAME_FAILS_COOKIE)?.value);
  const brand = await getCurrentBrand();
  const theme = themeFromCookie(jar.get(THEME_COOKIE)?.value);
  const demoMode = appEnv().DEMO_MODE;
  const firm = demoMode === "on" ? await findCurrentFirm() : null;
  const demo = showsDemo(demoMode, firm?.id ?? null);
  // A firm's own colour, worked out for each theme (Phase 18; globals.css body[data-firm-colour]):
  // checked #rrggbb values only, never raw input (src/lib/tenancy/brand-values.ts).
  const firmColours = brand ? (brandStyle(brand) as CSSProperties | undefined) : undefined;
  return (
    // suppressHydrationWarning: the client's pages (Phase 36.3) are light with no theme picked, so
    // their layout's one-line script writes data-theme="light" here before the page is drawn
    // (src/app/client/layout.tsx); this element's own attributes only.
    <html lang="en-GB" data-theme={theme} className={fontVariables} suppressHydrationWarning>
      <body
        style={firmColours}
        data-firm-colour={firmColours ? "" : undefined}
        className="bg-canvas text-base text-ink antialiased has-[[data-shell=office]]:flex has-[[data-shell=office]]:min-h-dvh has-[[data-shell=office]]:flex-col"
      >
        {demo && <DemoBar />}
        {brand && <BrandBar brand={brand} />}
        {/* The first link on a firm's page (the firm's bar has none; only a demo server's bar
            comes before it): from 1024px, the keyboard's way to the casual app's rail, shown
            only where there is one (src/app/skip-to-menu.tsx). */}
        {brand && <SkipToMenu />}
        {children}
      </body>
    </html>
  );
}
