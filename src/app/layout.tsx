import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShiftDesk",
  description: "Your shifts, answered instantly.",
  // Opens full screen when added to a phone's home screen (the name is in app/manifest.ts).
  appleWebApp: { capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="bg-white text-lg text-slate-900 antialiased">{children}</body>
    </html>
  );
}
