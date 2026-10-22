import type { ReactNode } from "react";
import type { DemoPhoneMessage } from "@/lib/demo/phone";
import { meta, muted, staffCard, textLink } from "../ui/classes";
import { PageHeader } from "../ui/page-header";

// The Demo phone (docs/screens.md `/demo`; 16.1, ADR-025): on a demo server no text or email is
// really sent, so this page shows what would have been, as a phone and an inbox would: newest
// first, each with who it went to and when, its links tappable. Only links back to the firm's own
// address are links (`linkOrigin`); anything else stays text. Pure and hook-free (page.tsx reads
// the messages), so tests/unit/demo.phone-view.test.ts renders it.

const CHANNEL = { sms: "Text", whatsapp: "WhatsApp", email: "Email" } as const;

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// A UK mobile as people write it (07700 900122); anything else as it is.
export function displayNumber(e164: string): string {
  const uk = /^\+44(7\d{3})(\d{6})$/.exec(e164);
  return uk ? `0${uk[1]} ${uk[2]}` : e164;
}

// The message's words, its links to the firm's own address made tappable. A full stop or comma
// right after a link ends the sentence, not the link.
export function withLinks(body: string, linkOrigin: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    const start = match.index;
    if (start > last) parts.push(body.slice(last, start));
    let ours = false;
    try {
      ours = new URL(url).origin === linkOrigin;
    } catch {
      ours = false;
    }
    parts.push(
      ours ? (
        <a key={start} href={url} className={`${textLink} break-all font-semibold`}>
          {url}
        </a>
      ) : (
        url
      ),
    );
    last = start + url.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

export function DemoPhoneView({
  firmName,
  messages,
  linkOrigin,
}: {
  firmName: string;
  messages: DemoPhoneMessage[];
  linkOrigin: string;
}) {
  return (
    <>
      <PageHeader title="Demo phone">
        <p>
          This demo sends no real texts or emails. Everything {firmName} would send to its casuals
          and office team shows here instead, newest first.
        </p>
        <p>Tap a link to open it, as you would on a phone. New messages show up by themselves.</p>
      </PageHeader>
      {messages.length === 0 ? (
        <p className={muted}>No messages yet. Ask for a login link and it shows here.</p>
      ) : (
        <ul role="list" className="flex flex-col gap-4" aria-label="Messages, newest first">
          {messages.map((m, i) => (
            <li key={`${m.at.getTime()}-${i}`} className={staffCard}>
              <p className="font-semibold">
                {CHANNEL[m.channel]} to {m.toName}
              </p>
              <p className={meta}>
                {m.channel === "email" ? m.to : displayNumber(m.to)} ·{" "}
                <time dateTime={m.at.toISOString()}>{when.format(m.at)}</time>
              </p>
              {m.subject ? <p className="mt-3 font-semibold">{m.subject}</p> : null}
              <p className="mt-2 whitespace-pre-line break-words">
                {withLinks(m.body, linkOrigin)}
              </p>
              {m.attachments.length > 0 ? (
                <p className={`${meta} mt-2`}>Attached: {m.attachments.join(", ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
