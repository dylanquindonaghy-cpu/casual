import type { Metadata } from "next";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { officeMenu } from "../office-menu";
import { GuideView } from "./guide-view";

export const metadata: Metadata = { title: "How-to guide" };

// The office's how-to guide ("How-to guide" in the menu; docs/ui-design.md "Guides"). Every office
// role can open it; it shows each role only the parts it can open. The words are in guide-view.tsx.
export default async function GuidePage() {
  const { firm, officeUser } = await requireOfficeArea("guide");
  return (
    <GuideView firmName={firm.name} role={officeUser.role} menu={officeMenu(officeUser.role)} />
  );
}
