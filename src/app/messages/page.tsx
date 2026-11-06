import type { Metadata } from "next";
import { page } from "@/app/ui/classes";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv } from "@/lib/env";
import { readMessageAboutPay, readMessageOffice } from "@/lib/portal/message-office";
import { messageAboutShift, openMessages } from "@/lib/portal/messages";
import { ABOUT_PAY_LINE, aboutLine, READY_SENTENCES } from "@/lib/portal/messages-copy";
import { portalUrl } from "@/lib/tenancy/portal-url";
import { CasualTabBar } from "../casual-tab-bar";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { Composer } from "./composer";
import { MessagesView } from "./messages-view";

export const metadata: Metadata = { title: "Messages" };

// Messages (P8; Phase 25.6): read with the office's replies marked read, so the tab's count is
// gone by the time the bar shows. Opened about a shift (Phase 28.6; 28.2's link,
// /messages?shift={id}&about={pay|late|started|other}): the About line and a ready sentence in the
// box, only for a shift a message sent now would keep (messageAboutShift); anything else, and the
// page is as it was. Opened about her pay with no shift (/messages?about=pay, Pay's "Message the
// office"; the guardrails review of 28.10): "About: your pay" and an empty box, and what she sends
// goes to a person.
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ shift?: string | string[]; about?: string | string[] }>;
}) {
  const { firm, worker, session } = await requireWorker();
  const params = await searchParams;
  const asked = readMessageOffice(params);
  const [thread, shift] = await Promise.all([
    openMessages({ firm }, worker.id),
    asked ? messageAboutShift({ firm }, worker.id, asked.shift) : null,
  ]);
  const about =
    asked && shift
      ? {
          shiftId: shift.shiftId,
          line: aboutLine(shift, firm.timezone),
          sentence: READY_SENTENCES[asked.about],
        }
      : !asked && readMessageAboutPay(params)
        ? { shiftId: null, line: ABOUT_PAY_LINE, sentence: "" }
        : null;
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <MessagesView
        thread={thread}
        now={new Date()}
        timeZone={firm.timezone}
        linkOrigin={new URL(portalUrl(firm.slug, appEnv().APP_BASE_DOMAIN)).origin}
        composer={<Composer answered={thread.answered} about={about} />}
      />
      <CasualTabBar firm={firm} workerId={worker.id} current="messages" />
    </main>
  );
}
