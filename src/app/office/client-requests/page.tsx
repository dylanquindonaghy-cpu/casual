import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { card, h2, meta, nums, page, tab, tabCount, tabCurrent, tabs } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import {
  acceptButton,
  acceptLines,
  answeredLine,
  fromLine,
  MINE_WORDS,
  NOT_FOUND_PANEL,
  OFFICE_INTRO,
  OFFICE_TITLE,
  officeEmpty,
} from "@/lib/client/office-copy";
import {
  officeClientRequestPreview,
  officeClientRequests,
  type AcceptPreview,
  type OfficeClientRequest,
} from "@/lib/client/queue";
import {
  CLIENT_STATUS_WORDS,
  KIND_WORDS,
  OFFICE_TAB_WORDS,
  OFFICE_TABS,
  plannerTabWords,
  URGENT_WORDS,
  type OfficeTab,
} from "@/lib/client/words";
import { updateWhen } from "@/lib/office/dashboard-map-copy";
import { RequestActions, type AcceptOptions } from "./request-actions";
import { areaMetadata } from "@/app/office/area-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return areaMetadata("client_requests", { title: "Client requests" });
}

// Client requests (Phase 36.4; the approved mock-up's "Client requests, laptop"; docs/screens.md
// "## Phase 36", "36.3 and 36.4 screens"): what clients sent from their logins. Tabs Waiting
// (urgent first), Accepted, Declined and "To do in {planner}", each with its count; "My contracts"
// and "All contracts" for someone who looks after contracts; the list, and beside it from 1024px
// (under it on a phone) the chosen request (`?request=`, the list's first by default): who asked,
// what, their note, "What accepting does" (worked out by code from the session as it is now) and
// the answers. Admins and resourcers.

const isTab = (v: unknown): v is OfficeTab =>
  typeof v === "string" && (OFFICE_TABS as readonly string[]).includes(v);

const hrefOf = (o: { tab: OfficeTab; scope: "mine" | "all"; request?: string }) => {
  const q = new URLSearchParams();
  if (o.tab !== "waiting") q.set("tab", o.tab);
  if (o.scope === "all") q.set("scope", "all");
  if (o.request) q.set("request", o.request);
  const s = q.toString();
  return s ? `/office/client-requests?${s}` : "/office/client-requests";
};

// The chip on a request: its urgency while it waits, else where it stands.
function RequestChip({ r }: { r: OfficeClientRequest }) {
  if (r.status === "waiting" && r.urgent)
    return <StatusChip tone="urgent">{URGENT_WORDS[r.urgent]}</StatusChip>;
  if (r.status === "waiting") return <StatusChip tone="attention">{KIND_WORDS[r.kind]}</StatusChip>;
  if (r.status === "asked") return <StatusChip tone="wait">You asked them</StatusChip>;
  if (r.status === "declined") return <StatusChip tone="quiet">Declined</StatusChip>;
  if (r.status === "done_in_planner" && !r.plannerDoneAt)
    return <StatusChip tone="attention">To do in the planner</StatusChip>;
  return <StatusChip tone="done">{CLIENT_STATUS_WORDS[r.status]}</StatusChip>;
}

// What the answer buttons need from "What accepting does".
function acceptOptions(a: AcceptPreview): AcceptOptions | null {
  const base = {
    label: acceptButton(a),
    offer: false,
    reason: null,
    confirm: null,
    venues: null,
    venue: "",
  };
  switch (a.kind) {
    case "gone":
      return null;
    case "places": {
      const more = a.change.after.places > a.change.before.places;
      const n = a.cancels.length;
      return {
        ...base,
        offer: more && a.offers === "now",
        confirm:
          n > 0
            ? `This cancels ${n === 1 ? "1 booking" : `${n} bookings`} with notice: ${a.cancels.map((c) => c.name).join(", ")}. Each is told.`
            : null,
      };
    }
    case "times":
      return {
        ...base,
        reason: "event_changed",
        confirm:
          a.booked.length > 0
            ? `This moves ${a.booked.length === 1 ? "1 person" : `${a.booked.length} people`} booked on it. Each is told.`
            : null,
      };
    case "cancel":
      return {
        ...base,
        reason: "event_cancelled",
        confirm:
          a.booked.length > 0
            ? `This cancels the session and ${a.booked.length === 1 ? "1 booking" : `${a.booked.length} bookings`} with notice. Each is told.`
            : "This cancels the session.",
      };
    case "new_event":
      return {
        ...base,
        venues: a.venues,
        venue:
          "siteId" in a.venue &&
          a.venues.some((v) => v.siteId === (a.venue as { siteId: string }).siteId)
            ? a.venue.siteId
            : "",
      };
    default:
      return base;
  }
}

export default async function ClientRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; scope?: string; request?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("client_requests");
  const q = await searchParams;
  const tabNow: OfficeTab = isTab(q.tab) ? q.tab : "waiting";
  const scope = q.scope === "all" ? "all" : "mine";
  const ctx = { firm, officeUserId: officeUser.id };
  const queue = await officeClientRequests(ctx, { tab: tabNow, scope });
  if (!queue) notFound();
  // Whether they look after any contracts (then "My contracts" and "All contracts" show).
  const looksAfter =
    scope === "mine"
      ? queue.mine
      : ((await officeClientRequests(ctx, { tab: tabNow, scope: "mine" }))?.mine ?? false);
  const askedFor = typeof q.request === "string" ? q.request : null;
  const chosenId = askedFor ?? queue.requests[0]?.id ?? null;
  const preview = chosenId ? await officeClientRequestPreview(ctx, chosenId) : null;
  const now = new Date();
  const tz = queue.timeZone;
  const tabWords = (t: OfficeTab) =>
    t === "planner" ? plannerTabWords(queue.plannerName) : OFFICE_TAB_WORDS[t];
  const r = preview?.request ?? null;
  const plannerToDo = r?.status === "done_in_planner" && r.plannerDoneAt === null;
  return (
    <main className={page.office}>
      <PageHeader title={OFFICE_TITLE}>
        <p className="max-w-prose">{OFFICE_INTRO}</p>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Show" className={tabs}>
          {OFFICE_TABS.map((t) => (
            <Link
              key={t}
              href={hrefOf({ tab: t, scope })}
              aria-current={t === tabNow ? "page" : undefined}
              className={t === tabNow ? tabCurrent : tab}
            >
              {tabWords(t)}
              {(t === "waiting" || t === "planner" || queue.counts[t] > 0) && (
                <>
                  {" "}
                  <span className={tabCount(t === tabNow)}>{queue.counts[t]}</span>
                </>
              )}
            </Link>
          ))}
        </nav>
        {looksAfter && (
          <nav aria-label="Contracts" className={tabs}>
            {(["mine", "all"] as const).map((sc) => (
              <Link
                key={sc}
                href={hrefOf({ tab: tabNow, scope: sc })}
                aria-current={sc === scope ? "page" : undefined}
                className={sc === scope ? tabCurrent : tab}
              >
                {MINE_WORDS[sc]}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby="list-heading">
          <h2 id="list-heading" className="sr-only">
            {tabWords(tabNow)}
          </h2>
          {queue.requests.length === 0 ? (
            <p className={`${card} text-ink-muted`}>{officeEmpty(tabNow, queue.plannerName)}</p>
          ) : (
            <ul
              role="list"
              className="glass flex flex-col gap-1 rounded-inner p-2"
              id="client-requests-list"
            >
              {queue.requests.map((x) => {
                const chosen = x.id === r?.id;
                return (
                  <li
                    key={x.id}
                    data-request={x.id}
                    className={`relative flex flex-col gap-2 rounded-row px-4 py-4 hover:bg-active ${chosen ? "glass-button outline-2 -outline-offset-2 outline-ink" : ""}`}
                  >
                    <p className="flex items-baseline gap-3">
                      <Link
                        href={`${hrefOf({ tab: tabNow, scope, request: x.id })}#request-panel`}
                        aria-current={chosen ? "true" : undefined}
                        scroll={false}
                        className="press min-w-0 font-semibold break-words text-ink underline-offset-4 before:absolute before:inset-0 before:rounded-row hover:underline"
                      >
                        {x.contractName}
                      </Link>
                      <span className={`ml-auto shrink-0 text-sm text-ink-muted ${nums}`}>
                        {updateWhen(x.createdAt, now, tz)}
                      </span>
                    </p>
                    <p>
                      <RequestChip r={x} />
                    </p>
                    <p className="break-words">{x.title}</p>
                    {answeredLine(x, tz) && <p className={meta}>{answeredLine(x, tz)}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {chosenId && (
          <section
            id="request-panel"
            aria-labelledby="request-title"
            data-chosen-request={r?.id}
            className="glass rounded-inner p-4 sm:p-6"
          >
            {!preview || !r ? (
              <p className="text-ink-muted" id="request-title">
                {NOT_FOUND_PANEL}
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                <header className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2
                      id="request-title"
                      className="text-2xl font-semibold tracking-heading text-balance break-words text-ink"
                    >
                      {r.title}
                    </h2>
                    <RequestChip r={r} />
                  </div>
                  <p className={`text-ink-muted ${nums}`}>{fromLine(r, tz)}</p>
                  <p className={meta}>Sent {updateWhen(r.createdAt, now, tz)}</p>
                </header>
                {r.payload && "text" in r.payload && (
                  <p className="break-words">
                    <b>They asked:</b> &ldquo;{r.payload.text}&rdquo;
                  </p>
                )}
                {r.note && (
                  <p className="break-words">
                    <b>Their note:</b> &ldquo;{r.note}&rdquo;
                  </p>
                )}
                {r.officeAnswer && (
                  <p className="break-words">
                    <b>
                      {r.status === "declined"
                        ? "Your reason:"
                        : r.status === "asked"
                          ? "You asked:"
                          : "Your word to them:"}
                    </b>{" "}
                    &ldquo;{r.officeAnswer}&rdquo;
                  </p>
                )}
                {(preview.canAnswer || plannerToDo) && (
                  <div>
                    <h3 className={h2}>
                      {plannerToDo ? "To do in your planner" : "What accepting does"}
                    </h3>
                    <ol className="mt-2 flex list-decimal flex-col gap-2 pl-6">
                      {acceptLines(r, preview.accept, tz).map((l, i) => (
                        <li key={i}>
                          <b>{l.label}:</b> {l.text}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <RequestActions
                  key={r.id}
                  requestId={r.id}
                  canAnswer={preview.canAnswer}
                  plannerToDo={plannerToDo}
                  accept={preview.canAnswer ? acceptOptions(preview.accept) : null}
                  stayOn={hrefOf({ tab: tabNow, scope, request: r.id })}
                />
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
