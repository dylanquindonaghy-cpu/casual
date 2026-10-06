import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { FRAME_FAILS_COOKIE, frameFailsOnce } from "@/lib/e2e/fails-once";
import { getCurrentBrand } from "@/lib/tenancy/current-brand";
import { BrandBar } from "./brand-bar";
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

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Every firm page opens with the firm's bar (its logo, name and colour); the platform's own
// address has none. Under the office shell (src/app/office/office-shell.tsx) the page is a
// column, so the shell fills the window below the bar.
export default async function RootLayout({ children }: { children: ReactNode }) {
  // The browser test of the whole-page error screen (only in the e2e run; otherwise nothing).
  await frameFailsOnce(async () => (await cookies()).get(FRAME_FAILS_COOKIE)?.value);
  const brand = await getCurrentBrand();
  return (
    <html lang="en-GB">
      <body className="bg-white text-lg text-slate-900 antialiased has-[[data-shell=office]]:flex has-[[data-shell=office]]:min-h-dvh has-[[data-shell=office]]:flex-col">
        {brand && <BrandBar brand={brand} />}
        {children}
      </body>
    </html>
  );
}
