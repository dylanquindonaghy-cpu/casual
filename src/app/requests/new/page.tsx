import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { emptyBox, page, staffBtn } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireWorker } from "@/lib/auth/current-worker";
import { roleLabel, shiftWhen } from "@/lib/portal/format";
import { myMarkedShift } from "@/lib/portal/my-shifts";
import { ATTENDANCE_TITLE, CANT_ASK_ABOUT_MARK } from "@/lib/portal/request-kinds";
import { requestableShifts } from "@/lib/portal/requests";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { AttendanceForm } from "./attendance-form";
import { RequestForm } from "./request-form";
import { CasualTabBar } from "../../casual-tab-bar";

type Params = Promise<Record<string, string | string[] | undefined>>;

const PAST_PATH = "/shifts?view=past";
const single = (v: string | string[] | undefined) => (Array.isArray(v) ? undefined : v);
const isAttendance = (params: Record<string, string | string[] | undefined>) =>
  single(params.kind) === "attendance";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Params;
}): Promise<Metadata> {
  return { title: isAttendance(await searchParams) ? ATTENDANCE_TITLE : "New request" };
}

// New request (docs/screens.md, `/requests/new`, "### 28.9"): for one of the worker's upcoming
// shifts, each a two-line choice card (?shift=<id> preselects it, when it's theirs).
//
// "Tell the office what happened" (?shift=<id>&kind=attendance, "### 28.13"): from a marked row on
// Booked's Past 90 days, for that one session, only while it's hers, marked worked or not attended
// and started in the last 90 days (myMarkedShift; askAboutMark checks it again when she sends).
// Anything else says it can't find it, with the way back to her past shifts. On the Shifts tab,
// where she came from.
export default async function NewRequestPage({ searchParams }: { searchParams: Params }) {
  const { firm, worker, session } = await requireWorker();
  const params = await searchParams;
  const asked = z.uuid().safeParse(single(params.shift));

  if (isAttendance(params)) {
    const marked = asked.success ? await myMarkedShift({ firm }, worker.id, asked.data) : null;
    return (
      <main className={page.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <PageHeader title={ATTENDANCE_TITLE} />
        {marked ? (
          <AttendanceForm
            shift={{
              shiftId: marked.shiftId,
              when: shiftWhen(marked.startsAt, marked.endsAt, firm.timezone),
              what: `${roleLabel(marked.role)}${marked.siteName ? ` at ${marked.siteName}` : ""}`,
              mark: marked.mark,
            }}
          />
        ) : (
          <p className={emptyBox}>{CANT_ASK_ABOUT_MARK}</p>
        )}
        <Link href={PAST_PATH} className={`${staffBtn.secondary} mt-8`}>
          Back to my shifts
        </Link>
        <CasualTabBar firm={firm} workerId={worker.id} current="shifts" />
      </main>
    );
  }

  const shifts = await requestableShifts({ firm }, worker.id);
  const preselected =
    asked.success && shifts.some((s) => s.shiftId === asked.data) ? asked.data : null;
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <PageHeader title="New request" />
      {shifts.length === 0 ? (
        <p className={emptyBox}>You have no upcoming shifts to ask about.</p>
      ) : (
        <RequestForm shifts={shifts} preselected={preselected} />
      )}
      <Link href="/requests" className={`${staffBtn.secondary} mt-8`}>
        Back to my requests
      </Link>
      <CasualTabBar firm={firm} workerId={worker.id} current="profile" />
    </main>
  );
}
