import type { Metadata } from "next";
import { CHOOSER_COPY } from "@/lib/demo/start-copy";
import { staffDemoOffice } from "./gate";
import { ChooserView } from "./chooser-view";

export const metadata: Metadata = { title: CHOOSER_COPY.title };

// "Choose a view" (Phase 31.2; docs/screens.md "Phase 31"): on a demo server, for anyone logged in
// to the demo firm's office. Not logged in: the staffing login. Anywhere else: not found.
export default async function ChooseViewPage() {
  const { officeUser } = await staffDemoOffice();
  return <ChooserView name={officeUser.name} />;
}
