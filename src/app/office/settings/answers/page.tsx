import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, h2, headingGap, meta, muted, notice, page, row, rows } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { PageHeader } from "@/app/ui/page-header";
import { Slip } from "@/app/ui/slip";
import { StatusChip } from "@/app/ui/status-chip";
import { ANSWER_CHANNELS } from "@/lib/answers/switches";
import { requireOfficeArea } from "@/lib/auth/current-office";
import {
  ANSWERS_INTRO,
  ANSWERS_TITLE,
  BUILT_IN,
  BUILT_IN_SIDE,
  CHANNEL_LABELS,
  CHANNELS_INTRO,
  CHANNELS_TITLE,
  channelUsesText,
  lastEditedText,
  MASTER_OFF,
  savedText,
  UNANSWERED_EMPTY,
  UNANSWERED_INTRO,
  UNANSWERED_TITLE,
  usesText,
  YOURS_EMPTY,
} from "@/lib/office/answers-copy";
import { officeAnswersPage } from "@/lib/office/answers-page";
import { CHANNEL_WORDS } from "@/lib/office/enquiries-copy";
import { timeOnDay } from "@/lib/portal/format";
import { preview } from "../../enquiries/enquiry-row";
import { AnswerSwitch, ChannelSwitch } from "./answer-switches";
import { AnswerWords } from "./answer-words";

export const metadata: Metadata = { title: "Automatic answers" };

// Settings → Automatic answers (Phase 35.3; docs/screens.md "## Phase 35", "The office's page";
// the approved mock-up). Admins only (others: not found; checked here, in the loader and again in
// every change). The three switches (where the library answers), the firm's answers with their own
// switches and uses in the last 7 days, the built-in answers (fixed words, no switch), and the
// latest questions that went to a person, each with "Make this an answer". From 1024px two
// columns: the switches and the questions at the left, the answers at the right; on a phone one
// column, the answers after the switches.
export default async function AnswersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("answers");
  const data = await officeAnswersPage({ firm, officeUserId: officeUser.id });
  if (!data) notFound();
  const { saved } = await searchParams;
  const justSaved = typeof saved === "string" ? data.answers.find((a) => a.id === saved) : null;
  const tz = data.timeZone;
  return (
    <main className={page.office}>
      <PageHeader back={{ href: "/office/settings", label: "Settings" }} title={ANSWERS_TITLE}>
        <p className="max-w-prose">{ANSWERS_INTRO}</p>
      </PageHeader>

      {justSaved && (
        <Slip tone="done" role="status" className="mb-6 max-w-2xl">
          <p>{savedText(justSaved.name, justSaved.isOn)}</p>
        </Slip>
      )}

      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-6">
        <section aria-labelledby="channels" className={`${card} lg:col-start-1 lg:row-start-1`}>
          <h2 id="channels" className={h2}>
            {CHANNELS_TITLE}
          </h2>
          <p className={`${meta} mt-1`}>{CHANNELS_INTRO}</p>
          <ul role="list" className="mt-4 flex flex-col gap-3">
            {ANSWER_CHANNELS.map((c) => (
              <li key={c}>
                <ChannelSwitch
                  channel={c}
                  on={data.switches[c]}
                  label={CHANNEL_LABELS[c]}
                  line={channelUsesText(data.switches[c], data.answeredLast7Days[c])}
                />
              </li>
            ))}
          </ul>
          {!data.autoReplies && (
            <p className={`${notice} mt-4 text-sm`} data-master-off>
              {MASTER_OFF}
            </p>
          )}
        </section>

        <div className="flex flex-col gap-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:gap-6">
          <section aria-labelledby="yours">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="yours" className={h2}>
                Your answers
              </h2>
              <Link href="/office/settings/answers/new" className={btn.primary}>
                <Icon name="plus" />
                Add an answer
              </Link>
            </div>
            {data.answers.length === 0 ? (
              <p className={`${card} ${headingGap} text-ink-muted`}>{YOURS_EMPTY}</p>
            ) : (
              <ul role="list" className={`${rows} ${headingGap}`}>
                {data.answers.map((a) => (
                  <li key={a.id} className={`${row} flex flex-col gap-2`} data-answer={a.name}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-semibold break-words">
                        {a.name}
                        {!a.isOn && <StatusChip tone="quiet">Off</StatusChip>}
                      </h3>
                      <AnswerSwitch id={a.id} name={a.name} on={a.isOn} />
                      <Link
                        href={`/office/settings/answers/${a.id}`}
                        className={btn.small}
                        aria-label={`Edit ${a.name}`}
                      >
                        Edit
                      </Link>
                    </div>
                    {a.examples.length > 0 && (
                      <p className="text-sm break-words text-ink-muted">
                        {a.examples.map((x) => `“${x}”`).join(", ")}
                      </p>
                    )}
                    <AnswerWords body={a.body} />
                    <p className={`${meta} flex flex-wrap gap-x-4 gap-y-1`}>
                      <span>{usesText(a.usesLast7Days)}</span>
                      <span>{lastEditedText(a, tz)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="built-in">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="built-in" className={h2}>
                Built in
              </h2>
              <span className={meta}>{BUILT_IN_SIDE}</span>
            </div>
            <ul role="list" className={`${rows} ${headingGap}`}>
              {BUILT_IN.map((b) => (
                <li key={b.key} className={`${row} flex flex-col gap-1`}>
                  <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                    {b.name}
                    <StatusChip tone="quiet">Built in</StatusChip>
                  </h3>
                  <p className="text-sm text-ink-muted">Keywords: {b.asks}</p>
                  <p>{b.does}</p>
                  <p className={meta}>{usesText(data.builtInLast7Days[b.key])}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section aria-labelledby="unanswered" className="lg:col-start-1 lg:row-start-2">
          <h2 id="unanswered" className={h2}>
            {UNANSWERED_TITLE}
          </h2>
          <p className={`${muted} mt-1`}>{UNANSWERED_INTRO}</p>
          {data.unanswered.length === 0 ? (
            <p className={`${card} ${headingGap} text-ink-muted`}>{UNANSWERED_EMPTY}</p>
          ) : (
            <ul role="list" className={`${rows} ${headingGap}`}>
              {data.unanswered.map((q) => (
                <li key={q.id} className={`${row} flex flex-col gap-2`}>
                  <p className="break-words">“{preview(q.text)}”</p>
                  <p className={`${meta} tabular-nums`}>
                    {CHANNEL_WORDS[q.channel]} · {timeOnDay(q.at, tz)}
                  </p>
                  <p className="flex flex-wrap gap-2">
                    <Link href={`/office/settings/answers/new?from=${q.id}`} className={btn.small}>
                      Make this an answer
                    </Link>
                    <Link href={`/office/enquiries/${q.id}`} className={btn.small}>
                      Open it
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
