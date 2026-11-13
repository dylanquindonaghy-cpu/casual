import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, emptyBox, page, rows } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireClient } from "@/lib/client/current-client";
import { NO_REQUESTS, replyProblemText, REQUESTS_TITLE } from "@/lib/client/page-copy";
import { clientRequestList } from "@/lib/client/reads";
import { replySentWords } from "@/lib/client/words";
import { RequestLine } from "../../client-parts";
import { Slip } from "@/app/ui/slip";
import { ReplyForm } from "./reply-form";

export const metadata: Metadata = { title: "Your requests" };

// "Your requests" (Phase 36.4; docs/screens.md "## Phase 36", "36.3 and 36.4 screens"): every
// request on their contract, newest first (a colleague's too), each with its status (Waiting,
// Accepted, Declined, Question for you), what was asked, the office's reason or question, and for a
// question the box to answer it.
const PROBLEMS = {
  invalid: replyProblemText("invalid"),
  not_asked: replyProblemText("not_asked"),
  not_found: replyProblemText("not_found"),
  not_allowed: replyProblemText("not_allowed"),
  logged_out: replyProblemText("logged_out"),
  error: replyProblemText("error"),
};

export default async function ClientRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ answered?: string }>;
}) {
  const s = await requireClient();
  // The request just answered (the reply box adds it to the address): its "Sent" stays once the
  // page has refreshed and the reply box has gone (golden rule 11). Matched against this client's
  // own requests only.
  const { answered } = await searchParams;
  const requests = await clientRequestList({ firm: s.firm, clientContactId: s.contact.id });
  if (!requests) notFound();
  const now = new Date();
  return (
    <main className={page.office}>
      <PageHeader
        title={REQUESTS_TITLE}
        back={{ href: "/client", label: "Your events" }}
        actions={
          <Link href="/client/requests/new" className={btn.primary}>
            New request
          </Link>
        }
      >
        <p className="max-w-prose text-ink-muted">
          Newest first. {s.firm.name} answers each one here and by email.
        </p>
      </PageHeader>
      {requests.length === 0 ? (
        <p className={emptyBox}>{NO_REQUESTS}</p>
      ) : (
        <ul role="list" className={`${rows} max-w-3xl`} id="your-requests">
          {requests.map((r) => (
            <RequestLine
              key={r.id}
              r={r}
              firmName={s.firm.name}
              now={now}
              timeZone={s.firm.timezone}
            >
              {answered === r.id && r.status !== "asked" && (
                <Slip tone="done" role="status" title="Sent">
                  <p>{replySentWords(s.firm.name)}</p>
                </Slip>
              )}
              {r.status === "asked" && r.officeAnswer && (
                <ReplyForm
                  requestId={r.id}
                  question={r.officeAnswer}
                  firmName={s.firm.name}
                  sentWords={replySentWords(s.firm.name)}
                  problemWords={PROBLEMS}
                />
              )}
            </RequestLine>
          ))}
        </ul>
      )}
    </main>
  );
}
