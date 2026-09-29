import { notFound } from "next/navigation";
import { requireWorker } from "@/lib/auth/current-worker";
import { myProfile } from "@/lib/portal/profile";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { ProfileView } from "./profile-view";

export default async function ProfilePage() {
  const { firm, worker, session } = await requireWorker();
  const profile = await myProfile({ firm }, worker.id);
  if (!profile) notFound();
  return (
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <ProfileView profile={profile} signOff={firm.signOff} />
    </main>
  );
}
