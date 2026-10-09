import { headers } from "next/headers";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv, offlineCopyOn } from "@/lib/env";
import { myNeedsUpdating, myShifts } from "@/lib/portal/my-shifts";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { parseHost } from "@/lib/tenancy/host";
import { LogoutButton } from "./logout-button";
import { MyShiftsView } from "./my-shifts-view";
import { OfflineCopy } from "./offline-copy";
import { refreshSessionAction } from "./session-actions";
import { SessionKeeper } from "./session-keeper";
import { btn, page } from "./ui/classes";
import { Icon } from "./ui/icons";

// The root URL serves two sites: the ShiftDesk home page on the base domain, and each firm's
// portal on <slug>.<base domain> or the firm's own domain, where a logged-in worker sees My shifts
// (docs/screens.md, `/`). Any host that isn't the base domain is a firm's page: requireWorker()
// finds the firm (a name that isn't a firm's, or a custom domain not verified, is the 404 page).
// My shifts ends with the links to every other page (in the view), then a quieter "Log out".
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const match = parseHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  if (match && match.kind !== "apex") {
    const { firm, worker, session } = await requireWorker();
    const view = (await searchParams).view === "past" ? "past" : "upcoming";
    const now = new Date();
    const [shifts, needs, urgent] = await Promise.all([
      myShifts({ firm }, worker.id, view),
      myNeedsUpdating({ firm }, worker.id),
      openShiftsFor({ firm, clock: { now: () => now } }, worker.id, { urgent: true }),
    ]);
    return (
      <main className={page.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <OfflineCopy enabled={offlineCopyOn(appEnv())} renderedAt={now.getTime()} />
        <MyShiftsView
          firstName={worker.firstName}
          voice={{ name: firm.name, signOff: firm.signOff }}
          timeZone={firm.timezone}
          now={now}
          view={view}
          shifts={shifts}
          needs={needs}
          urgentCount={urgent.shifts.length}
        />
        <LogoutButton
          kind="worker"
          after="/login?out=1"
          className={`${btn.secondary} mt-6 w-full`}
          icon={<Icon name="logout" />}
        />
      </main>
    );
  }
  return (
    <main className={page.staff}>
      <h1 className="text-3xl font-bold">ShiftDesk</h1>
      <p className="mt-2">Staff portal coming soon.</p>
    </main>
  );
}
