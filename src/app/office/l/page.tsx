import type { Metadata } from "next";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { LinkLogin } from "../../l/link-login";
import { consumeOfficeLinkAction } from "./actions";

// Never tell another site which page this was.
export const metadata: Metadata = { referrer: "no-referrer" };

export default async function OfficeLinkPage() {
  const firm = await getCurrentFirm();
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">Log in to the {firm.name} office</h1>
      <LinkLogin
        firmName={firm.name}
        action={consumeOfficeLinkAction}
        home="/office"
        newLink="/office/login"
        prompt={`Tap the button to log in to the ${firm.name} office.`}
      />
    </main>
  );
}
