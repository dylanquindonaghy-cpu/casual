import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { nums, page } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireClient } from "@/lib/client/current-client";
import { FORM_KINDS, isFormKind, type FormKind, type SessionChoice } from "@/lib/client/form";
import {
  clock,
  eventWhenLine,
  FORM_TITLE,
  sessionChoiceLabel,
  urgentBox,
} from "@/lib/client/page-copy";
import { clientEvents, clientFormChoices } from "@/lib/client/reads";
import { KIND_WORDS, sentWords } from "@/lib/client/words";
import { roleLabel } from "@/lib/portal/format";
import { localDateOf } from "@/lib/time/zoned";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "New request" };

// "Ask for a change" (from an event: `?event=`, a session: `&session=`, a kind: `&kind=`) and "New
// request" (Phase 36.4; docs/screens.md "## Phase 36", "36.3 and 36.4 screens"). The sessions
// offered are their contract's still to come and not cancelled (from an event, only its own); the
// venues and roles a new event may use are the contract's and the firm's. Anything in the address
// that isn't theirs is ignored. The form itself: ./request-form.tsx.
export default async function NewClientRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; session?: string; event?: string }>;
}) {
  const s = await requireClient();
  const q = await searchParams;
  const ctx = { firm: s.firm, clientContactId: s.contact.id };
  const [events, choices] = await Promise.all([clientEvents(ctx), clientFormChoices(ctx)]);
  if (!events || !choices) notFound();
  const tz = choices.timeZone;
  const now = new Date().getTime();
  const askedSession = typeof q.session === "string" ? q.session : "";
  const event =
    events.find((e) => e.eventId === q.event) ??
    events.find((e) => e.sessions.some((x) => x.shiftId === askedSession)) ??
    null;
  const sessions: SessionChoice[] = (event ? [event] : events).flatMap((e) =>
    e.sessions
      .filter((x) => !x.cancelled && x.startsAt.getTime() > now)
      .map((x) => ({
        shiftId: x.shiftId,
        eventId: e.eventId,
        label: event ? sessionChoiceLabel(x, tz) : `${e.name} · ${sessionChoiceLabel(x, tz)}`,
        startsAt: x.startsAt.getTime(),
        places: x.places,
        booked: x.booked,
        date: localDateOf(x.startsAt, tz),
        start: clock(x.startsAt, tz),
        end: clock(x.endsAt, tz),
      })),
  );
  const kinds: FormKind[] = event ? FORM_KINDS.filter((k) => k !== "new_event") : [...FORM_KINDS];
  const initialKind = isFormKind(q.kind) && kinds.includes(q.kind) ? q.kind : "";
  const initialSession = sessions.some((x) => x.shiftId === askedSession) ? askedSession : "";
  const title = event ? FORM_TITLE.change : FORM_TITLE.new;
  return (
    <main className={page.officeForm}>
      <PageHeader
        back={
          event
            ? { href: `/client/events/${event.eventId}`, label: event.name }
            : { href: "/client", label: "Your events" }
        }
        title={title}
      >
        {event ? (
          <p className={`text-ink-muted ${nums}`}>
            {event.name} · {eventWhenLine(event, tz)}
          </p>
        ) : (
          <p className="max-w-prose text-ink-muted">
            A new event, or a change to one you have. {s.firm.name} answers here and by email.
          </p>
        )}
      </PageHeader>
      <RequestForm
        kinds={kinds}
        initialKind={initialKind}
        sessions={sessions}
        initialSession={initialSession}
        venues={choices.venues}
        roles={choices.roles.map((r) => ({ code: r, label: roleLabel(r) }))}
        timeZone={tz}
        {...(event ? { eventId: event.eventId } : {})}
        words={{
          kinds: KIND_WORDS,
          firmName: s.firm.name,
          sent: { plain: sentWords(s.firm.name, false), urgent: sentWords(s.firm.name, true) },
          urgent: urgentBox(s.firm.name),
        }}
      />
    </main>
  );
}
