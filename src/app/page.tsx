import Link from "next/link";
import { headers } from "next/headers";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv } from "@/lib/env";
import { parseHost } from "@/lib/tenancy/host";
import { LogoutButton } from "./logout-button";
import { logoutAction, refreshSessionAction } from "./session-actions";
import { SessionKeeper } from "./session-keeper";

// The root URL serves two sites: the ShiftDesk home page on the base domain, and each firm's
// portal on <slug>.<base domain>, for logged-in workers. My shifts replaces the firm page in
// Phase 3.
export default async function Home() {
  const match = parseHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  if (match?.kind === "firm") {
    const { firm, worker, session } = await requireWorker();
    return (
      <main className="mx-auto max-w-md p-6">
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <p className="text-base text-slate-600">{firm.name}</p>
        <h1 className="text-3xl font-bold">Hello {worker.firstName}</h1>
        <p className="mt-2">Your shifts will appear here.</p>
        <Link
          href="/pay"
          className="mt-6 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
        >
          See your pay
        </Link>
        <LogoutButton action={logoutAction} after="/login?out=1" />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">ShiftDesk</h1>
      <p className="mt-2">Staff portal coming soon.</p>
    </main>
  );
}
