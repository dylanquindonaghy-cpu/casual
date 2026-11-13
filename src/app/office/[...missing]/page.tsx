import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Any /office address that matches no page (Phase 37.6, w1-08): the office's own not-found
// (src/app/office/not-found.tsx), inside the office frame when someone is logged in, with "Back to
// the office", never the casual app's page. Every real office route is more specific and wins over
// this catch-all; deeper unknown addresses (/office/settings/nope) land here too.
export const metadata: Metadata = { title: "Page not found" };

export default function OfficeMissing(): never {
  notFound();
}
