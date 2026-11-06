import { z } from "zod";

// "Message the office" about a session (Phase 28.2; 28.5, 28.6, 28.12, 28.13 build their links
// with it): one link contract, /messages?shift={id}&about={pay|late|started|other}. Messages reads
// it back with readMessageOffice(); anything that doesn't pass is ignored and the page works as
// before. Pure and browser-safe (no database code).
//
// Golden rule 9: a pay question about a session that has ended is a pay query for payroll, behind
// her pay code, never a message: messageOfficeHref() sends about=pay on an ended session to
// /pay/query?shift={id} (28.10 preselects it). A message about an ended session is never tagged
// either (src/lib/inbound/app.ts), so one typed by hand is sorted as any other.

export const MESSAGE_ABOUT = ["pay", "late", "started", "other"] as const;
export type MessageAbout = (typeof MESSAGE_ABOUT)[number];

export const messageAboutSchema = z.enum(MESSAGE_ABOUT);

// The query as Messages receives it (Next's searchParams: a value may come twice, as a list).
export const messageOfficeQuery = z.object({
  shift: z.uuid(),
  about: messageAboutSchema,
});
export type MessageOfficeQuery = z.infer<typeof messageOfficeQuery>;

const single = (value: unknown) => (Array.isArray(value) ? undefined : value);

// The session and topic from Messages' query, or null when either is missing or not allowed.
export function readMessageOffice(params: {
  shift?: string | string[];
  about?: string | string[];
}): MessageOfficeQuery | null {
  const parsed = messageOfficeQuery.safeParse({
    shift: single(params.shift),
    about: single(params.about),
  });
  return parsed.success ? parsed.data : null;
}

// "Message the office" about her pay, with no session (the guardrails review of 28.10): the way on
// from Pay and the pay query when the pay can't open (no way to send her a code) or a question is
// older than 90 days (src/lib/portal/pay-copy.ts MESSAGE_OFFICE). What she sends from Messages
// opened so is never sorted (src/lib/inbound/app.ts, reply.ts): it waits for a person, so it never
// gets the automatic pay link that would only send her back to Pay.
export const MESSAGES_ABOUT_PAY = "/messages?about=pay";

// Messages opened about her pay: ?about=pay and no ?shift= at all (one with a shift is
// readMessageOffice's). Anything else is false.
export function readMessageAboutPay(params: {
  shift?: string | string[];
  about?: string | string[];
}): boolean {
  return params.shift === undefined && single(params.about) === "pay";
}

// The Messages link for a session and topic. Throws on an id or topic that isn't allowed: links are
// built from the casual's own rows, never typed in.
export function messagesHref(shiftId: string, about: MessageAbout): string {
  const q = messageOfficeQuery.parse({ shift: shiftId, about });
  return `/messages?shift=${q.shift}&about=${q.about}`;
}

// The pay query for one of her sessions (payroll's, behind her pay code).
export function payQueryHref(shiftId: string): string {
  return `/pay/query?shift=${z.uuid().parse(shiftId)}`;
}

// Where "Message the office" goes for a session: the pay query for a pay question about one that
// has ended (golden rule 9), Messages otherwise.
export function messageOfficeHref(
  shift: { id: string; endsAt: Date },
  about: MessageAbout,
  now: Date,
): string {
  const topic = messageAboutSchema.parse(about);
  if (topic === "pay" && shift.endsAt.getTime() <= now.getTime()) return payQueryHref(shift.id);
  return messagesHref(shift.id, topic);
}
