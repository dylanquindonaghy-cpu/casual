import { sql, type SQL } from "drizzle-orm";
import { UNSORTED_FOR_PERSON_MINUTES } from "./enquiry-rules";

// Enquiries' "needs a person", as SQL over a row with `firm_id`, `id`, `channel`, `handled_at`,
// `handled_as`, `intent` and `created_at`: a message to the shifts line or an email to the staffing
// inbox (Phase 25.5) for a person (they asked for one, nothing sorted it, or the number isn't a
// casual's; or, Wave 1 w1-04, the shifts line still hasn't sorted a message UNSORTED_FOR_PERSON_
// MINUTES after it came in, by `now`) that nobody has dealt with: not closed, not answered by a
// reply that didn't then fail, and its question (if any) not answered. An email that isn't from a
// casual is left for the firm's own inbox, where it already is: never a person's here; nor is an
// unsorted email counted by the 10 minutes (Parking lot). Kept apart from Enquiries' loader so the
// inbox's summary job can use it (src/lib/email/summary.ts); the reply and close actions use it
// too (src/lib/office/enquiry-actions.ts). Every row passed in must have `created_at`.
export const needsPerson = (m: string, now: Date): SQL => {
  const a = sql.raw(m);
  return sql`(
    ((${a}.handled_as = 'unknown' and ${a}.channel <> 'email') or ${a}.intent = 'office'
      or (${a}.handled_at is null and ${a}.channel <> 'email'
          and ${a}.created_at <= ${now}::timestamptz
                                 - make_interval(mins => ${sql.raw(String(UNSORTED_FOR_PERSON_MINUTES))})))
    and not exists (select 1 from events c
                     where c.firm_id = ${a}.firm_id and c.entity_id = ${a}.id
                       and c.action = 'enquiry.closed')
    and not exists (select 1 from events a
                     where a.firm_id = ${a}.firm_id and a.entity_id = ${a}.id
                       and a.action = 'enquiry.answered'
                       and not exists (select 1 from events f
                                        where f.firm_id = a.firm_id and f.entity_id = a.entity_id
                                          and f.action = 'enquiry.reply_failed'
                                          and f.data ->> 'replyId' = a.data ->> 'replyId'))
    and not exists (select 1 from requests q
                     where q.firm_id = ${a}.firm_id and q.message_id = ${a}.id
                       and q.status not in ('open', 'escalated'))
  )`;
};

// Who sent an unsorted message (w1-04), as SQL over a row with `firm_id`, `worker_id`,
// `handled_at`, `channel` and `from_e164`: its worker once the shifts line sorted it, else the
// number's worker (any status; one per number in a firm), the same look-up as the mark for a person
// (src/lib/inbound/for-a-person.ts). So an unsorted message names the casual whose number it came
// from, and the office's reply is planned for them. RLS and the firm_id join keep it to the firm.
export const senderWorker = (m: string): SQL => {
  const a = sql.raw(m);
  return sql`coalesce(${a}.worker_id,
    case when ${a}.handled_at is null and ${a}.channel not in ('app', 'email')
              and ${a}.from_e164 is not null
         then (select w2.id from workers w2
                where w2.firm_id = ${a}.firm_id and w2.mobile_e164 = ${a}.from_e164 limit 1)
    end)`;
};

// A request from the app waiting for an answer, as SQL over a `requests` row: open or escalated,
// and not a shifts-line question still with its message (Enquiries answers that one, with the
// message it came from). One rule for the request queue's list (request-queue.ts), Enquiries'
// "{n} requests to answer" count (enquiries.ts) and the office frame's count (Wave 1, w1-07: the
// top bar's Needs attention and the Enquiries badge, appRequestsWaiting), so they never disagree
// (the guardrails review, Phase 27.2). It must stay disjoint from needsPerson: a shifts-line
// question (`general` with its message) is needsPerson's, through its message, never this one's,
// so nothing is counted twice.
export const requestWaiting = (q: string): SQL =>
  sql.raw(
    `(${q}.status in ('open', 'escalated') and (${q}.type <> 'general' or ${q}.message_id is null))`,
  );
