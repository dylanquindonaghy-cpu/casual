import { eq, sql, type SQL } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { strangerTextsOff } from "../inbound/opt-out";
import { signOffFor } from "../tenancy/sign-off";
import { wallTimeOf, zonedToUtc } from "../time/zoned";
import {
  enquiryOutcome,
  forAPerson,
  replyPlan,
  type CloseReason,
  type Outcome,
  type ReplyPlan,
} from "./enquiry-rules";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// Enquiries (docs/office-v2.md 3.6; docs/screens.md `/office/enquiries`; 12D.1): every message to
// the shifts line in the last 90 days (a WhatsApp, a text, a voicemail's words; a bare call is
// not one), with its replies (`reply_to`), its office question (`requests.message_id`) and what the
// log says about it. There is no enquiries table. Reads only, inside the firm (RLS scopes every row
// to it). Server only.
//
// Need a person is worked out, never stored (NEEDS_PERSON): a message for a person (the casual
// asked for the office, nothing sorted it, or the number isn't a casual's) with no
// `enquiry.closed`, no `enquiry.answered` whose reply didn't then fail, and, if it has a question,
// that question still open.
//
// The office never sees more of a casual's home than the district: nothing here reads their travel
// area (the checks that use it are 12D.2's, recorded as minutes only).

export const ENQUIRY_DAYS = 90; // the messages' retention (retention.message_days' default)
export const LIST_MAX = 100;
const CONVERSATION_MAX = 5; // later messages from the same number shown on a message's page
const IN_APP_HOURS = 24; // a booking or cancellation this soon after a reply was "done in the app"
const UNCONFIRMED_MS = 15 * 60_000; // an office reply still "sending" this long after: unconfirmed

export const ENQUIRY_VIEWS = ["all", "person", "app", "pay"] as const;
export type EnquiryView = (typeof ENQUIRY_VIEWS)[number];

type Channel = "whatsapp" | "sms" | "voice";
type HandledAs = "keyword" | "ai" | "office" | "unknown" | "opt_out";
type Intent = "shifts" | "cancel" | "pay" | "office";

// A message for a person that nobody has dealt with (the alias is the message's). The reply and
// close actions use it too (src/lib/office/enquiry-actions.ts).
export const needsPerson = (m: string): SQL =>
  sql.raw(`(
    (${m}.handled_as = 'unknown' or ${m}.intent = 'office')
    and not exists (select 1 from events c
                     where c.firm_id = ${m}.firm_id and c.entity_id = ${m}.id
                       and c.action = 'enquiry.closed')
    and not exists (select 1 from events a
                     where a.firm_id = ${m}.firm_id and a.entity_id = ${m}.id
                       and a.action = 'enquiry.answered'
                       and not exists (select 1 from events f
                                        where f.firm_id = a.firm_id and f.entity_id = a.entity_id
                                          and f.action = 'enquiry.reply_failed'
                                          and f.data ->> 'replyId' = a.data ->> 'replyId'))
    and not exists (select 1 from requests q
                     where q.firm_id = ${m}.firm_id and q.message_id = ${m}.id
                       and q.status not in ('open', 'escalated'))
  )`);

// The casual booked or cancelled a shift in the app within a day after this message.
const doneInApp = (m: string): SQL =>
  sql.raw(`exists (
    select 1 from events d
     where d.firm_id = ${m}.firm_id
       and d.created_at > ${m}.created_at
       and d.created_at <= ${m}.created_at + interval '${IN_APP_HOURS} hours'
       and d.action in ('shift.assigned', 'shift.cancelled') and d.data ->> 'by' = 'worker'
       and d.data ->> 'workerId' = ${m}.worker_id::text)`);

// An inbound message to the shifts line, in the window, that is an enquiry (a call's own row,
// handled with no label, isn't: its voicemail is a row of its own).
const isEnquiry = (m: string, since: Date): SQL =>
  sql`${sql.raw(m)}.direction = 'in' and ${sql.raw(m)}.created_at > ${since}
      and not (${sql.raw(m)}.handled_at is not null and ${sql.raw(m)}.handled_as is null)`;

export interface EnquiryRow {
  messageId: string;
  at: Date;
  channel: Channel;
  text: string | null; // their words (null: a photo, or a voicemail not turned into text)
  who: Who;
  outcome: Outcome;
}

// Who sent it: one of the firm's casuals (active or not), a number nobody here has, or a withheld
// number.
export type Who =
  | { kind: "casual"; workerId: string; name: string; firstName: string; active: boolean }
  | { kind: "unknown"; from: string }
  | { kind: "withheld" };

export interface EnquiriesPage {
  timeZone: string;
  today: number; // enquiries since midnight, the firm's time
  needPerson: { count: number; oldestAt: Date | null };
  rows: EnquiryRow[]; // the view's (empty for "app": that view is the request queue)
  more: boolean;
}

type ListRow = {
  id: string;
  created_at: string | Date;
  channel: Channel;
  body: string | null;
  from_e164: string | null;
  handled_at: string | Date | null;
  handled_as: HandledAs | null;
  intent: Intent | null;
  worker_id: string | null;
  first_name: string | null;
  last_name: string | null;
  worker_status: string | null;
  waiting: boolean;
  in_app: boolean;
};

const whoOf = (
  r: Pick<ListRow, "worker_id" | "first_name" | "last_name" | "worker_status" | "from_e164">,
): Who =>
  r.worker_id && r.first_name !== null
    ? {
        kind: "casual",
        workerId: r.worker_id,
        name: `${r.first_name} ${r.last_name ?? ""}`.trim(),
        firstName: r.first_name,
        active: r.worker_status === "active",
      }
    : r.from_e164
      ? { kind: "unknown", from: r.from_e164 }
      : { kind: "withheld" };

const outcomeOf = (r: ListRow) =>
  enquiryOutcome({
    handled: r.handled_at !== null,
    handledAs: r.handled_as,
    intent: r.intent,
    waiting: r.waiting,
    doneInApp: r.in_app,
  });

const LIST_SELECT = sql`
  select m.id, m.created_at, m.channel, m.body, m.from_e164, m.handled_at, m.handled_as, m.intent,
         m.worker_id, w.first_name, w.last_name, w.status as worker_status,
         ${needsPerson("m")} as waiting, ${doneInApp("m")} as in_app
    from messages m
    left join workers w on w.firm_id = m.firm_id and w.id = m.worker_id
`;

async function firmTime(tx: FirmTx) {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return firm?.timezone ?? "Europe/London";
}

export async function loadEnquiries(
  tx: FirmTx,
  view: EnquiryView,
  now: Date,
): Promise<EnquiriesPage> {
  const timeZone = await firmTime(tx);
  const since = new Date(now.getTime() - ENQUIRY_DAYS * 86_400_000);
  const midnight = zonedToUtc({ ...wallTimeOf(now, timeZone), hour: 0, minute: 0 }, timeZone);
  const { rows: counts } = await tx.execute<{
    today: number;
    waiting: number;
    oldest: string | Date | null;
  }>(sql`
    select count(*) filter (where m.created_at >= ${midnight})::int as today,
           count(*) filter (where ${needsPerson("m")})::int as waiting,
           min(m.created_at) filter (where ${needsPerson("m")}) as oldest
      from messages m
     where ${isEnquiry("m", since)}
  `);
  const c = counts[0];
  let rows: ListRow[] = [];
  if (view !== "app") {
    const where =
      view === "person"
        ? sql`and ${needsPerson("m")}`
        : view === "pay"
          ? sql`and m.intent = 'pay'`
          : sql``;
    // Need a person: oldest first (first asked, first answered). The rest: newest first.
    const order = view === "person" ? sql`m.created_at, m.id` : sql`m.created_at desc, m.id`;
    ({ rows } = await tx.execute<ListRow>(sql`
      ${LIST_SELECT}
       where ${isEnquiry("m", since)} ${where}
       order by ${order}
       limit ${LIST_MAX + 1}
    `));
  }
  return {
    timeZone,
    today: c?.today ?? 0,
    needPerson: { count: c?.waiting ?? 0, oldestAt: c?.oldest ? new Date(c.oldest) : null },
    rows: rows.slice(0, LIST_MAX).map((r) => ({
      messageId: r.id,
      at: new Date(r.created_at),
      channel: r.channel,
      text: r.body,
      who: whoOf(r),
      outcome: outcomeOf(r),
    })),
    more: rows.length > LIST_MAX,
  };
}

// The menu's badge: how many need a person.
export async function needPersonCount(tx: FirmTx, now: Date): Promise<number> {
  const since = new Date(now.getTime() - ENQUIRY_DAYS * 86_400_000);
  const { rows } = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from messages m
     where ${isEnquiry("m", since)} and ${needsPerson("m")}
  `);
  return rows[0]?.n ?? 0;
}

// One message on the conversation: theirs, or a reply as they saw it.
export interface ConversationItem {
  id: string;
  direction: "in" | "out";
  channel: Channel;
  text: string | null;
  at: Date;
  // An office reply's state (an automatic reply is stored only once sent): sending until the
  // worker has sent it, then sent or failed.
  officeReply: { by: string | null; state: "sending" | "sent" | "failed" | "unconfirmed" } | null;
}

// "How it was answered", step by step, from logged facts only (docs/office-v2.md 3.6).
export interface EnquiryTimeline {
  received: { channel: Channel; at: Date; who: Who };
  sorted:
    | { how: "keyword" | "ai"; intent: Intent }
    | {
        how: "person";
        why: "asked" | "ai_asked" | "voicemail" | "no_text" | "not_sorted";
        // The AI's own reason, when it was logged (12D.2).
        ai?: "not_connected" | "no_answer" | "not_a_label";
      }
    | { how: "unknown"; repeat: boolean }
    | { how: "opt_out" }
    | { how: "not_yet" };
  reply: { how: "automatic"; intent: Intent | "unknown_number" | "voicemail" } | { how: "none" };
  sent:
    | { how: "sent"; channel: "whatsapp" | "sms"; at: Date; fellBackFrom: string | null }
    | { how: "failed"; channel: string; code: string; at: Date }
    | { how: "none" };
  then: ThenFact[];
}

export type ThenFact =
  | {
      kind: "office_reply";
      by: string | null;
      at: Date;
      channel: "whatsapp" | "sms";
      form: "free_text" | "template";
      // unconfirmed: still "sending" 15 minutes on (the job stopped part-way: it may have gone,
      // and it's never sent again).
      state: "sending" | "sent" | "failed" | "unconfirmed";
      code: string | null;
      fellBackFrom: string | null;
    }
  | { kind: "closed"; by: string | null; at: Date; reason: CloseReason }
  | {
      kind: "request";
      by: string | null;
      at: Date;
      status: "approved" | "declined" | "auto_resolved";
    }
  | { kind: "in_app"; action: "booked" | "cancelled"; at: Date; shift: ShiftName | null };

export interface ShiftName {
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
}

export interface EnquiryDetail {
  timeZone: string;
  messageId: string;
  ref: string; // the message's reference (a question's own when it has one)
  at: Date;
  channel: Channel;
  text: string | null;
  who: Who;
  outcome: Outcome;
  forAPerson: boolean;
  waiting: boolean;
  pay: boolean;
  voicemail: boolean;
  question: { requestId: string; ref: string; status: string } | null;
  conversation: ConversationItem[];
  timeline: EnquiryTimeline;
  plan: ReplyPlan; // how a reply from the office would go now
  firm: { name: string; signOff: string };
  // What the personal reply was built from (its `enquiry.checks` entry, 12D.2), or null: no such
  // reply, or one sent before 12D.2 ("No checks recorded").
  built: BuiltReply | null;
}

// A session the entry names, as the office reads it.
export interface SessionName {
  shiftId: string;
  role: string;
  eventName: string | null;
  siteName: string | null;
  startsAt: Date;
  endsAt: Date;
}

export interface BuiltReply {
  template: string;
  sent: boolean | null;
  area: { maxMinutes: number } | null;
  offered: {
    shiftId: string;
    session: SessionName | null; // null: deleted since
    car: number | null;
    publicTransport: number | null;
    checks: { code: string; passed: boolean; detail: Record<string, unknown> }[];
  }[];
  more: number;
  notOffered: {
    shiftId: string;
    session: SessionName | null;
    reasons: { code: string; type?: string; from?: string; to?: string }[];
  }[];
  notOfferedMore: number;
  notChecked: number; // considered past the sessions read, so not checked one by one
  bookings: string[];
  named: (SessionName | null)[]; // each booking's session (null: gone since)
  // The qualifications the entry names: their names for people.
  names: Record<string, string>;
}

type EventRow = {
  id: string;
  action: string;
  data: Record<string, unknown>;
  created_at: string | Date;
  actor_name: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : null);
const AI_REASONS = ["not_connected", "no_answer", "not_a_label"] as const;
const aiReason = (v: unknown) =>
  AI_REASONS.find((r) => r === v) as (typeof AI_REASONS)[number] | undefined;

export async function loadEnquiry(
  tx: FirmTx,
  messageId: string,
  now: Date,
): Promise<EnquiryDetail | null> {
  const since = new Date(now.getTime() - ENQUIRY_DAYS * 86_400_000);
  const { rows: found } = await tx.execute<
    ListRow & {
      to_e164: string;
      notify_channel: "whatsapp" | "sms" | null;
      sms_opted_out_at: string | Date | null;
    }
  >(sql`
    select m.id, m.created_at, m.channel, m.body, m.from_e164, m.to_e164, m.handled_at,
           m.handled_as, m.intent, m.worker_id, w.first_name, w.last_name,
           w.status as worker_status, w.notify_channel, w.sms_opted_out_at,
           ${needsPerson("m")} as waiting, ${doneInApp("m")} as in_app
      from messages m
      left join workers w on w.firm_id = m.firm_id and w.id = m.worker_id
     where m.id = ${messageId} and ${isEnquiry("m", since)}
  `);
  const m = found[0];
  if (!m) return null;
  const [firm] = await tx
    .select({ name: firms.name, timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const timeZone = firm?.timezone ?? "Europe/London";
  const at = new Date(m.created_at);

  // Their message, its replies, then up to 5 later messages from the same number to this line
  // (with their replies), in time order.
  const { rows: talk } = await tx.execute<{
    id: string;
    direction: "in" | "out";
    channel: Channel;
    body: string | null;
    created_at: string | Date;
    provider_message_id: string;
  }>(sql`
    with later as (
      select l.id from messages l
       where l.direction = 'in' and l.from_e164 = ${m.from_e164} and l.to_e164 = ${m.to_e164}
         and (l.created_at, l.id) > (${at}::timestamptz, ${m.id}::uuid)
         and not (l.handled_at is not null and l.handled_as is null)
       order by l.created_at, l.id
       limit ${m.from_e164 === null ? 0 : CONVERSATION_MAX}
    ), shown as (
      select ${m.id}::uuid as id union all select id from later
    )
    select x.id, x.direction, x.channel, x.body, x.created_at, x.provider_message_id
      from messages x
     where x.id in (select id from shown) or x.reply_to in (select id from shown)
     order by x.created_at, x.id
  `);

  // What the log says about this message, oldest first, with the office person's name.
  const { rows: events } = await tx.execute<EventRow>(sql`
    select e.id::text as id, e.action, e.data, e.created_at, o.name as actor_name
      from events e
      left join office_users o
        on o.firm_id = e.firm_id and e.actor_type = 'office' and o.id = e.actor_id
     where e.entity_id = ${m.id}
       and (e.action like 'message.%' or e.action like 'enquiry.%')
     order by e.id
  `);
  const { rows: questions } = await tx.execute<{
    id: string;
    status: string;
    resolved_at: string | Date | null;
    resolver: string | null;
    payload: Record<string, unknown>;
  }>(sql`
    select q.id, q.status, q.resolved_at, o.name as resolver, q.payload
      from requests q
      left join office_users o on o.firm_id = q.firm_id and o.id = q.resolved_by
     where q.message_id = ${m.id}
  `);
  const question = questions[0] ?? null;

  // The office's replies: the row is stored when the office sends it; its outcome is logged
  // against it (by its id). One still "sending" 15 minutes on is unconfirmed: the job stopped
  // part-way, so it may have gone, and it's never sent again.
  type ReplyState = "sending" | "sent" | "failed" | "unconfirmed";
  const replies = new Map<
    string,
    {
      at: Date;
      by: string | null;
      state: ReplyState;
      code: string | null;
      channel: "whatsapp" | "sms";
      fellBackFrom: string | null;
      form: "free_text" | "template";
    }
  >();
  const then: ThenFact[] = [];
  for (const e of events) {
    const replyId = str(e.data.replyId);
    const reply = replyId ? replies.get(replyId) : undefined;
    if (e.action === "enquiry.answered" && replyId) {
      replies.set(replyId, {
        at: new Date(e.created_at),
        by: e.actor_name,
        state: "sending",
        code: null,
        channel: e.data.channel === "sms" ? "sms" : "whatsapp",
        fellBackFrom: null,
        form: e.data.form === "template" ? "template" : "free_text",
      });
    } else if (e.action === "enquiry.reply_sent" && reply) {
      reply.state = "sent";
      if (e.data.channel === "sms") reply.channel = "sms";
      reply.fellBackFrom = str(e.data.fellBackFrom);
    } else if (e.action === "enquiry.reply_failed" && reply) {
      reply.state = "failed";
      reply.code = str(e.data.code) ?? "unknown";
    } else if (e.action === "enquiry.closed") {
      then.push({
        kind: "closed",
        by: e.actor_name,
        at: new Date(e.created_at),
        reason: (str(e.data.reason) ?? "other") as CloseReason,
      });
    }
  }
  for (const r of replies.values()) {
    if (r.state === "sending" && now.getTime() - r.at.getTime() > UNCONFIRMED_MS) {
      r.state = "unconfirmed";
    }
    then.push({ kind: "office_reply", ...r });
  }
  // A question answered on its own (the request queue, before Enquiries), not by a reply here.
  const answeredHere = events.some(
    (e) => e.action === "enquiry.answered" || e.action === "enquiry.closed",
  );
  if (
    question &&
    !answeredHere &&
    (question.status === "approved" ||
      question.status === "declined" ||
      question.status === "auto_resolved") &&
    question.resolved_at
  ) {
    then.push({
      kind: "request",
      by: question.resolver,
      at: new Date(question.resolved_at),
      status: question.status,
    });
  }
  // Done in the app: the first booking or cancellation they made within a day of the message.
  if (m.in_app && m.worker_id) {
    const { rows: acts } = await tx.execute<{
      action: string;
      created_at: string | Date;
      shift_id: string | null;
      role: string | null;
      site: string | null;
      starts_at: string | Date | null;
    }>(sql`
      select d.action, d.created_at, s.id as shift_id, s.role, si.name as site, s.starts_at
        from events d
        left join shifts s on s.firm_id = d.firm_id and s.id::text = d.data ->> 'shiftId'
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
       where d.created_at > ${at}
         and d.created_at <= ${at}::timestamptz + make_interval(hours => ${IN_APP_HOURS})
         and d.action in ('shift.assigned', 'shift.cancelled') and d.data ->> 'by' = 'worker'
         and d.data ->> 'workerId' = ${m.worker_id}
       order by d.created_at, d.id
       limit 1
    `);
    const act = acts[0];
    if (act) {
      then.push({
        kind: "in_app",
        action: act.action === "shift.assigned" ? "booked" : "cancelled",
        at: new Date(act.created_at),
        shift:
          act.shift_id && act.role && act.starts_at
            ? {
                shiftId: act.shift_id,
                role: act.role,
                site: act.site,
                startsAt: new Date(act.starts_at),
              }
            : null,
      });
    }
  }
  then.sort((a, b) => a.at.getTime() - b.at.getTime());

  const received = events.find((e) => e.action === "message.received");
  const built = await builtReply(
    tx,
    events.findLast((e) => e.action === "enquiry.checks"),
  );
  const handledAs = m.handled_as;
  const intent = m.intent;
  const sorted: EnquiryTimeline["sorted"] =
    m.handled_at === null
      ? { how: "not_yet" }
      : handledAs === "keyword" && intent
        ? intent === "office"
          ? { how: "person", why: "asked" }
          : { how: "keyword", intent }
        : handledAs === "ai" && intent
          ? intent === "office"
            ? { how: "person", why: "ai_asked" }
            : { how: "ai", intent }
          : handledAs === "unknown"
            ? { how: "unknown", repeat: received?.data.repeat === true }
            : handledAs === "opt_out"
              ? { how: "opt_out" }
              : m.channel === "voice"
                ? { how: "person", why: "voicemail" }
                : m.body === null
                  ? { how: "person", why: "no_text" }
                  : {
                      how: "person",
                      why: "not_sorted",
                      ...(aiReason(received?.data.aiFallback)
                        ? { ai: aiReason(received?.data.aiFallback) }
                        : {}),
                    };

  // The automatic reply: the first one logged against the message.
  const replied = events.find(
    (e) => e.action === "message.replied" || e.action === "message.reply_failed",
  );
  const reply: EnquiryTimeline["reply"] = !replied
    ? { how: "none" }
    : {
        how: "automatic",
        intent:
          replied.data.reply === "unknown_number"
            ? "unknown_number"
            : m.channel === "voice" && intent === "office"
              ? "voicemail"
              : ((str(replied.data.intent) as Intent | null) ?? "office"),
      };
  const sent: EnquiryTimeline["sent"] = !replied
    ? { how: "none" }
    : replied.action === "message.replied"
      ? {
          how: "sent",
          channel: replied.data.channel === "sms" ? "sms" : "whatsapp",
          at: new Date(replied.created_at),
          fellBackFrom: str(replied.data.fellBackFrom),
        }
      : {
          how: "failed",
          channel: str(replied.data.channel) ?? "whatsapp",
          code: str(replied.data.code) ?? "unknown",
          at: new Date(replied.created_at),
        };

  const who = whoOf(m);
  const { plan } = await replyPlanFor(tx, m, now);

  return {
    timeZone,
    messageId: m.id,
    ref: (question?.id ?? m.id).slice(0, 8).toUpperCase(),
    at,
    channel: m.channel,
    text: m.body,
    who,
    outcome: outcomeOf(m),
    forAPerson: forAPerson({ handledAs, intent }),
    waiting: m.waiting,
    pay: intent === "pay",
    voicemail: m.channel === "voice",
    question: question
      ? {
          requestId: question.id,
          ref: question.id.slice(0, 8).toUpperCase(),
          status: question.status,
        }
      : null,
    conversation: talk.map((x) => {
      const office = x.direction === "out" ? replies.get(x.id) : undefined;
      return {
        id: x.id,
        direction: x.direction,
        channel: x.channel,
        text: x.body,
        at: new Date(x.created_at),
        officeReply: office ? { by: office.by, state: office.state } : null,
      };
    }),
    timeline: {
      received: { channel: m.channel, at, who },
      sorted,
      reply,
      sent,
      then,
    },
    plan,
    firm: {
      name: firm?.name ?? "",
      signOff: signOffFor(firm?.name ?? "", firm?.settings.sign_off),
    },
    built,
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
// An ISO time as the log writes them ("2026-11-09T09:00:00.000Z"), and a yyyy-mm-dd date.
const isTime = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(v) &&
  !Number.isNaN(Date.parse(v));
const isDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
// A check's fields the page reads as times or dates (src/lib/rules/eligibility.ts).
const TIME_FIELDS = ["startsAt", "withStart", "withEnd"];
const DATE_FIELDS = ["expiresOn", "until"];

// The `enquiry.checks` entry, read defensively (it's the log's: never trusted to be well formed),
// with the sessions and qualifications it names.
async function builtReply(tx: FirmTx, entry: EventRow | undefined): Promise<BuiltReply | null> {
  if (!entry) return null;
  const d = entry.data;
  // The log is read as untrusted: a check whose times or dates don't read as such is shown as
  // one we can't read, never guessed at (and never a page that fails to load).
  const offered = list(d.offered).map((o) => {
    const x = obj(o);
    return {
      shiftId: str(x.shiftId) ?? "",
      car: num(x.car),
      publicTransport: num(x.publicTransport),
      checks: list(x.checks).map((c) => {
        const { code, passed, ...detail } = obj(c);
        const readable =
          TIME_FIELDS.every((k) => detail[k] == null || isTime(detail[k])) &&
          DATE_FIELDS.every((k) => detail[k] == null || isDate(detail[k]));
        return readable
          ? { code: str(code) ?? "", passed: passed === true, detail }
          : { code: "unreadable", passed: passed === true, detail: {} };
      }),
    };
  });
  const notOffered = list(d.notOffered).map((n) => {
    const x = obj(n);
    return {
      shiftId: str(x.shiftId) ?? "",
      reasons: list(x.reasons).map((r) => {
        const y = obj(r);
        return {
          code: str(y.code) ?? "",
          ...(str(y.type) ? { type: str(y.type) ?? "" } : {}),
          ...(isTime(y.from) ? { from: y.from } : {}),
          ...(isTime(y.to) ? { to: y.to } : {}),
        };
      }),
    };
  });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // The booking a cancel reply named: its session.
  const bookings = list(d.bookings).filter(
    (b): b is string => typeof b === "string" && uuid.test(b),
  );
  const bookedShift = new Map<string, string>();
  if (bookings.length > 0) {
    const { rows } = await tx.execute<{ id: string; shift_id: string }>(sql`
      select a.id::text as id, a.shift_id::text as shift_id from assignments a
       where a.firm_id = app_current_firm_id()
         and a.id in (${sql.join(
           bookings.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
    `);
    for (const r of rows) bookedShift.set(r.id, r.shift_id);
  }
  const ids = [
    ...new Set([...[...offered, ...notOffered].map((x) => x.shiftId), ...bookedShift.values()]),
  ].filter((id) => uuid.test(id));
  const sessions = new Map<string, SessionName>();
  if (ids.length > 0) {
    const { rows } = await tx.execute<{
      id: string;
      role: string;
      event_name: string | null;
      site_name: string | null;
      starts_at: string | Date;
      ends_at: string | Date;
    }>(sql`
      select s.id::text as id, s.role, e.name as event_name, si.name as site_name, s.starts_at,
             s.ends_at
        from shifts s
        left join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
       where s.firm_id = app_current_firm_id()
         and s.id in (${sql.join(
           ids.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
    `);
    for (const r of rows) {
      sessions.set(r.id, {
        shiftId: r.id,
        role: r.role,
        eventName: r.event_name,
        siteName: r.site_name,
        startsAt: new Date(r.starts_at),
        endsAt: new Date(r.ends_at),
      });
    }
  }
  const types = new Set<string>();
  for (const o of offered) {
    for (const c of o.checks) if (typeof c.detail.type === "string") types.add(c.detail.type);
  }
  for (const n of notOffered) for (const r of n.reasons) if (r.type) types.add(r.type);
  const names: Record<string, string> = {};
  if (types.size > 0) {
    const { rows } = await tx.execute<{ code: string; name: string }>(sql`
      select code, name from credential_types
       where firm_id = app_current_firm_id()
         and code in (${sql.join(
           [...types].map((t) => sql`${t}`),
           sql`, `,
         )})
    `);
    for (const r of rows) names[r.code] = r.name;
  }
  const area = obj(d.area);
  return {
    template: str(d.template) ?? "",
    sent: typeof d.sent === "boolean" ? d.sent : null,
    area: num(area.maxMinutes) !== null ? { maxMinutes: num(area.maxMinutes) ?? 0 } : null,
    offered: offered.map((o) => ({ ...o, session: sessions.get(o.shiftId) ?? null })),
    more: num(d.more) ?? 0,
    notOffered: notOffered.map((n) => ({ ...n, session: sessions.get(n.shiftId) ?? null })),
    notOfferedMore: num(d.notOfferedMore) ?? 0,
    notChecked: num(d.notChecked) ?? 0,
    bookings,
    named: bookings.map((b) => {
      const shiftId = bookedShift.get(b);
      return shiftId ? (sessions.get(shiftId) ?? null) : null;
    }),
    names,
  };
}

// How the office's reply to this message would go now (src/lib/office/enquiry-rules.ts
// `replyPlan`), with the firm's shifts line it would go from. The reply action uses it too.
export async function replyPlanFor(
  tx: FirmTx,
  m: {
    channel: Channel;
    from_e164: string | null;
    worker_id: string | null;
    notify_channel: "whatsapp" | "sms" | null;
    sms_opted_out_at: string | Date | null;
  },
  now: Date,
): Promise<{ plan: ReplyPlan; line: string | null }> {
  const [firm] = await tx
    .select({ line: firms.shiftsLineE164 })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const line = firm?.line ?? null;
  // Their latest WhatsApp to the line as it is now: WhatsApp's 24 hours run from it.
  const { rows: last } =
    m.from_e164 && line
      ? await tx.execute<{ at: string | Date | null }>(sql`
          select max(created_at) as at from messages
           where direction = 'in' and channel = 'whatsapp'
             and from_e164 = ${m.from_e164} and to_e164 = ${line} and created_at <= ${now}
        `)
      : { rows: [] };
  const casual =
    m.worker_id && m.notify_channel
      ? { notifyChannel: m.notify_channel, smsAllowed: m.sms_opted_out_at === null }
      : null;
  const plan = replyPlan({
    channel: m.channel,
    from: m.from_e164,
    line,
    casual,
    strangerTextsOff: !casual && m.from_e164 ? await strangerTextsOff(tx, m.from_e164) : false,
    lastWhatsAppAt: last[0]?.at ? new Date(last[0].at) : null,
    now,
  });
  return { plan, line };
}

// For an active admin or resourcer of the firm (checked inside the transaction), or null.
export async function officeEnquiries(
  ctx: OfficeContext,
  view: EnquiryView,
): Promise<EnquiriesPage | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "enquiries")) ? loadEnquiries(tx, view, now) : null,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function officeEnquiry(
  ctx: OfficeContext,
  messageId: string,
): Promise<EnquiryDetail | null> {
  if (!UUID.test(messageId)) return null;
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "enquiries"))
      ? loadEnquiry(tx, messageId, now)
      : null,
  );
}

// The Enquiries menu badge (admins and resourcers): how many need a person.
export async function enquiriesWaiting(ctx: OfficeContext): Promise<number | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "enquiries")) ? needPersonCount(tx, now) : null,
  );
}
