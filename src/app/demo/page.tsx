import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { demoViewFor } from "@/lib/demo/firms";
import { demoPhoneMessages } from "@/lib/demo/phone";
import { appEnv } from "@/lib/env";
import { getCurrentFirm, withCurrentFirm } from "@/lib/tenancy/current-firm";
import { portalUrl } from "@/lib/tenancy/portal-url";
import { page } from "../ui/classes";
import { AutoRefresh } from "./auto-refresh";
import { DemoPhoneView } from "./demo-phone-view";

export const metadata: Metadata = { title: "Demo phone" };

// The Demo phone (docs/screens.md `/demo`; 16.1, ADR-025): only in demo mode, and only on one of
// the made-up demo firms' addresses; anywhere else it's the not-found page, as if it didn't exist.
// No login of its own: on a demo server the whole site needs the demo's password
// (src/lib/demo/gate.ts), and the people are made up. The messages are the ones this firm sent its
// own people (src/lib/demo/phone.ts).
export default async function DemoPhonePage() {
  const env = appEnv();
  const outbox = env.CONSOLE_OUTBOX_FILE;
  if (env.DEMO_MODE !== "on" || !outbox) notFound();
  const firm = await getCurrentFirm();
  if (demoViewFor(env.DEMO_MODE, firm.id) !== "demo") notFound();
  const messages = await withCurrentFirm((tx) => demoPhoneMessages(tx, outbox));
  return (
    <main className={page.staff}>
      <DemoPhoneView
        firmName={firm.name}
        messages={messages}
        linkOrigin={new URL(portalUrl(firm.slug, env.APP_BASE_DOMAIN)).origin}
      />
      <AutoRefresh seconds={4} />
    </main>
  );
}
