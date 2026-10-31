import type { Metadata } from "next";
import { page } from "@/app/ui/classes";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv } from "@/lib/env";
import { openMessages } from "@/lib/portal/messages";
import { portalUrl } from "@/lib/tenancy/portal-url";
import { CasualTabBar } from "../casual-tab-bar";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { Composer } from "./composer";
import { MessagesView } from "./messages-view";

export const metadata: Metadata = { title: "Messages" };

// Messages (P8; Phase 25.6): read with the office's replies marked read, so the tab's count is
// gone by the time the bar shows.
export default async function MessagesPage() {
  const { firm, worker, session } = await requireWorker();
  const thread = await openMessages({ firm }, worker.id);
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <MessagesView
        thread={thread}
        now={new Date()}
        timeZone={firm.timezone}
        linkOrigin={new URL(portalUrl(firm.slug, appEnv().APP_BASE_DOMAIN)).origin}
        composer={<Composer answered={thread.answered} />}
      />
      <CasualTabBar firm={firm} workerId={worker.id} current="messages" />
    </main>
  );
}
