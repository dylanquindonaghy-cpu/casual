import Link from "next/link";
import { headers } from "next/headers";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv } from "@/lib/env";
import { credentialNotices, myShifts } from "@/lib/portal/my-shifts";
import { parseHost } from "@/lib/tenancy/host";
import { LogoutButton } from "./logout-button";
import { MyShiftsView } from "./my-shifts-view";
import { logoutAction, refreshSessionAction } from "./session-actions";
import { SessionKeeper } from "./session-keeper";

// The root URL serves two sites: the ShiftDesk home page on the base domain, and each firm's
// portal on <slug>.<base domain>, where a logged-in worker sees My shifts (docs/screens.md, `/`).
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const match = parseHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  if (match?.kind === "firm") {
    const { firm, worker, session } = await requireWorker();
    const view = (await searchParams).view === "past" ? "past" : "upcoming";
    const [shifts, notices] = await Promise.all([
      myShifts({ firm }, worker.id, view),
      credentialNotices({ firm }, worker.id),
    ]);
    return (
      <main className="mx-auto max-w-md p-6">
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <MyShiftsView
          firstName={worker.firstName}
          voice={{ name: firm.name, signOff: firm.signOff }}
          timeZone={firm.timezone}
          now={new Date()}
          view={view}
          shifts={shifts}
          notices={notices}
        />
        <Link
          href="/pay"
          className="mt-8 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
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
