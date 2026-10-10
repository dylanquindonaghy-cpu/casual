import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, h2, headingGap, meta, nums, page, rows, sectionGap } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { appEnv } from "@/lib/env";
import {
  ENQUIRY_VIEWS,
  LIST_MAX,
  officeEnquiries,
  type EnquiryRow,
  type EnquiryView,
} from "@/lib/office/enquiries";
import {
  AI_BANNER,
  CHANNEL_WORDS,
  countsLine,
  OUTCOME_TONES,
  OUTCOME_WORDS,
  PAY_LOCK,
  VIEW_LABELS,
  whoName,
} from "@/lib/office/enquiries-copy";
import { officeRequestQueue } from "@/lib/office/request-queue";
import { timeOnDay } from "@/lib/portal/format";
import { RequestQueueView } from "./request-queue-view";

export const metadata: Metadata = { title: "Enquiries" };

// Enquiries (docs/office-v2.md 3.6; docs/screens.md `/office/enquiries`; 12D.1): what casuals and
// strangers sent the shifts line in the last 90 days and what came of it, the ones that need a
// person, the requests made in the app (the old Requests page) and pay. Views are links. Each row
// opens the message's own page. Admins and resourcers.

const EMPTY: Record<Exclude<EnquiryView, "app">, string> = {
  all: "No messages to the shifts line in the last 90 days.",
  person: "Nothing needs a person. Messages the shifts line can't answer show here.",
  pay: "No pay messages in the last 90 days.",
};

const isView = (v: unknown): v is EnquiryView =>
  typeof v === "string" && (ENQUIRY_VIEWS as readonly string[]).includes(v);
const hrefOf = (view: EnquiryView) =>
  view === "all" ? "/office/enquiries" : `/office/enquiries?view=${view}`;

// Their words, on one line and cut short for the list (the full text is on the message's page).
const preview = (text: string | null) => {
  if (text === null) return null;
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
};

function Row({ r, timeZone }: { r: EnquiryRow; timeZone: string }) {
  const words = preview(r.text);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icon name={r.channel} className="shrink-0 text-ink-muted" />
        <span className="sr-only">{CHANNEL_WORDS[r.channel]}:</span>
        <Link
          href={`/office/enquiries/${r.messageId}`}
          className="font-semibold underline-offset-4 hover:underline"
        >
          {whoName(r.who)}
        </Link>
        <StatusChip tone={OUTCOME_TONES[r.outcome]}>{OUTCOME_WORDS[r.outcome]}</StatusChip>
        <span className={`${meta} ${nums} ml-auto`}>{timeOnDay(r.at, timeZone)}</span>
      </div>
      <p className="mt-1 break-words">
        {words === null ? (
          <span className="text-ink-muted">
            {r.channel === "voice"
              ? "(A voicemail we couldn't turn into text.)"
              : "(A photo or file, with no text.)"}
          </span>
        ) : (
          <>“{words}”</>
        )}
      </p>
      {r.outcome === "pay" && <p className={`${meta} mt-1`}>{PAY_LOCK}</p>}
    </li>
  );
}

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("enquiries");
  const { view: viewParam } = await searchParams;
  const view: EnquiryView = isView(viewParam) ? viewParam : "all";
  const list = await officeEnquiries({ firm, officeUserId: officeUser.id }, view);
  if (!list) notFound();
  const queue =
    view === "app"
      ? await officeRequestQueue({ firm }, (await readSessionToken("office")) ?? "")
      : null;
  if (view === "app" && !queue) notFound();
  const now = new Date();
  return (
    <main className={page.office}>
      <PageHeader eyebrow={<>{firm.name} office</>} title="Enquiries" />
      <p className={`${nums} -mt-2`}>{countsLine(list.today, list.needPerson, now)}</p>
      {appEnv().AI_TRANSPORT === "none" && (
        <p className="mt-4 rounded-md border-l-4 border-attention bg-attention-soft px-3 py-2 text-attention-ink">
          {AI_BANNER}
        </p>
      )}

      <nav aria-label="Show" className="mt-6 flex flex-wrap gap-2">
        {ENQUIRY_VIEWS.map((v) => (
          <Link
            key={v}
            href={hrefOf(v)}
            aria-current={v === view ? "page" : undefined}
            className={v === view ? `${btn.primary} rounded-full` : `${btn.secondary} rounded-full`}
          >
            {VIEW_LABELS[v]}
            {v === "person" && (
              <>
                {" "}
                <span className={nums}>({list.needPerson.count})</span>
              </>
            )}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="view-heading" className={sectionGap.office}>
        <h2 id="view-heading" className={h2}>
          {VIEW_LABELS[view]}
        </h2>
        {view === "app" && queue ? (
          <div className={headingGap}>
            <RequestQueueView queue={queue} />
          </div>
        ) : list.rows.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>
            {EMPTY[view as Exclude<EnquiryView, "app">]}
          </p>
        ) : (
          <>
            <ul role="list" className={`${rows} ${headingGap}`}>
              {list.rows.map((r) => (
                <Row key={r.messageId} r={r} timeZone={list.timeZone} />
              ))}
            </ul>
            {list.more && (
              <p className={`${meta} mt-3`}>
                Showing the {view === "person" ? "oldest" : "latest"} {LIST_MAX}.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
