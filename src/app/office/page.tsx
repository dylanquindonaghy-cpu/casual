import Link from "next/link";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess, ROLE_LABELS } from "@/lib/auth/roles";
import { LogoutButton } from "../logout-button";
import { SessionKeeper } from "../session-keeper";
import { officeLogoutAction, refreshOfficeSessionAction } from "./session-actions";

// The office dashboard. The Today view arrives in Phase 5 (docs/screens.md).
export default async function OfficeHome() {
  const { firm, officeUser, session } = await requireOfficeArea("dashboard");
  return (
    <main className="mx-auto max-w-2xl p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshOfficeSessionAction} />
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Hello {officeUser.name}</h1>
      <p className="mt-2">You&apos;re logged in as {ROLE_LABELS[officeUser.role]}.</p>
      <p className="mt-2">Your dashboard will appear here.</p>
      {canAccess(officeUser.role, "team") && (
        <Link href="/office/team" className="mt-6 inline-block underline">
          Office team
        </Link>
      )}
      <LogoutButton action={officeLogoutAction} after="/office/login?out=1" />
    </main>
  );
}
