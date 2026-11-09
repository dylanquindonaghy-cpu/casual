import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { page } from "@/app/ui/classes";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv } from "@/lib/env";
import { myStrikes } from "@/lib/portal/my-strikes";
import { hasTextSender, workerLoginWay } from "@/lib/portal/login-way";
import { myProfile } from "@/lib/portal/profile";
import { myTravel } from "@/lib/portal/travel";
import { unseenAnswers } from "@/lib/portal/request-answers";
import { refreshSessionAction } from "../session-actions";
import { HomeScreenHint } from "../home-screen-hint";
import { SessionKeeper } from "../session-keeper";
import { ProfileView } from "./profile-view";
import { CasualTabBar } from "../casual-tab-bar";
import { CasualTop } from "../casual-top-bar";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const { firm, worker, session } = await requireWorker();
  const profile = await myProfile({ firm }, worker.id);
  if (!profile) notFound();
  const strikes = await myStrikes({ firm }, worker.id);
  const travel = await myTravel({ firm }, worker.id);
  // The office's answers to her requests she hasn't seen: My requests' count (28.11; 28.2's count,
  // the tab bar's too).
  const answers = await unseenAnswers({ firm }, worker.id);
  return (
    <>
      <CasualTop firm={firm} worker={worker} />
      <main className={page.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <ProfileView
          profile={profile}
          signOff={firm.signOff}
          push={{ publicKey: appEnv().VAPID_PUBLIC_KEY ?? null, firmName: firm.name }}
          strikes={strikes}
          travel={travel}
          loginWay={await workerLoginWay(firm.id, worker.id)}
          textSender={hasTextSender()}
          answersCount={answers}
        />
        <HomeScreenHint />
        <CasualTabBar firm={firm} workerId={worker.id} current="profile" />
      </main>
    </>
  );
}
