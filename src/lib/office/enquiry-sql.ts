import { sql, type SQL } from "drizzle-orm";

// Enquiries' "needs a person", as SQL over a row with `firm_id`, `id`, `channel`, `handled_as` and
// `intent`: a message to the shifts line or an email to the staffing inbox (Phase 25.5) for a
// person (they asked for one, nothing sorted it, or the number isn't a casual's) that nobody has
// dealt with: not closed, not answered by a reply that didn't fail, and its question (if any) not
// answered. An email that isn't from a casual is left for the firm's own inbox, where it already
// is: never a person's here. Kept apart from Enquiries' loader so the inbox's summary job can use it
// (src/lib/email/summary.ts); the reply and close actions use it too
// (src/lib/office/enquiry-actions.ts).
export const needsPerson = (m: string): SQL =>
  sql.raw(`(
    ((${m}.handled_as = 'unknown' and ${m}.channel <> 'email') or ${m}.intent = 'office')
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
