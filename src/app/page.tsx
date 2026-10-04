import Link from "next/link";
import { headers } from "next/headers";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv, offlineCopyOn } from "@/lib/env";
import { credentialNotices, myShifts } from "@/lib/portal/my-shifts";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { parseHost } from "@/lib/tenancy/host";
import { HomeScreenHint } from "./home-screen-hint";
import { LogoutButton } from "./logout-button";
import { MyShiftsView } from "./my-shifts-view";
import { OfflineCopy } from "./offline-copy";
import { refreshSessionAction } from "./session-actions";
import { SessionKeeper } from "./session-keeper";

// The root URL serves two sites: the ShiftDesk home page on the base domain, and each firm's
// portal on <slug>.<base domain> or the firm's own domain, where a logged-in worker sees My shifts
// (docs/screens.md, `/`). Any host that isn't the base domain is a firm's page: requireWorker()
// finds the firm (a name that isn't a firm's, or a custom domain not verified, is the 404 page).
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const match = parseHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  if (match && match.kind !== "apex") {
    const { firm, worker, session } = await requireWorker();
    const view = (await searchParams).view === "past" ? "past" : "upcoming";
    const now = new Date();
    const [shifts, notices, urgent] = await Promise.all([
      myShifts({ firm }, worker.id, view),
      credentialNotices({ firm }, worker.id),
      openShiftsFor({ firm, clock: { now: () => now } }, worker.id, { urgent: true }),
    ]);
    return (
      <main className="mx-auto max-w-md p-6">
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <OfflineCopy enabled={offlineCopyOn(appEnv())} renderedAt={now.getTime()} />
        <MyShiftsView
          firstName={worker.firstName}
          voice={{ name: firm.name, signOff: firm.signOff }}
          timeZone={firm.timezone}
          now={now}
          view={view}
          shifts={shifts}
          notices={notices}
          urgentCount={urgent.shifts.length}
        />
        <HomeScreenHint />
        <Link
          href="/requests"
          className="mt-8 block w-full rounded-xl border-2 border-slate-900 px-4 py-4 text-center text-lg font-semibold"
        >
          My requests
        </Link>
        <Link
          href="/pay"
          className="mt-3 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
        >
          See your pay
        </Link>
        <Link
          href="/profile"
          className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-4 text-center text-lg font-semibold"
        >
          My profile
        </Link>
        <LogoutButton kind="worker" after="/login?out=1" />
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
