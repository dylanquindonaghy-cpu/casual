import type { Metadata } from "next";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { LinkLogin } from "./link-login";

// Never tell another site which page this was.
export const metadata: Metadata = { referrer: "no-referrer" };

export default async function LinkPage() {
  const firm = await getCurrentFirm();
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">Log in to {firm.name}</h1>
      <LinkLogin firmName={firm.name} />
    </main>
  );
}
