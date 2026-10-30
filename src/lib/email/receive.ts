import { and, eq, isNull, sql } from "drizzle-orm";
import { inboundEmails, workers } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import { prepareEmail } from "./prepare";

// Storing an email the firm's staffing inbox received (P7.2; golden rule 3): one inbound_emails
// row, keyed by its Message-ID within the firm (a provider may send the same webhook more than once:
// a repeat stores nothing). In the same transaction: the casual it's from (an active worker here
// with that address, and only one: two would leave it nobody's; and only when the provider says the
// address passed its checks, as anyone can put another's address in an email), and only then its
// subject and words, made ready first (prepare.ts: quoted history and signature off; attachments
// never kept).
// Its job comes with P7.4: until then it waits, stored.

export interface InboundEmail {
  messageId: string;
  from: string; // checked, lower case (address.ts)
  authenticated: boolean; // the provider: it passed DMARC, so it's that address's
  to: string; // the firm's inbox
  subject: string | null;
  text: string | null;
  attachments: number;
}

export function receiveEmail(
  firmId: string,
  email: InboundEmail,
  deps: { run?: WithFirm } = {},
): Promise<{ stored: boolean }> {
  return (deps.run ?? withFirm)(firmId, async (tx) => {
    const senders = !email.authenticated
      ? []
      : await tx
          .select({ id: workers.id })
          .from(workers)
          .where(
            and(
              eq(workers.email, email.from),
              eq(workers.status, "active"),
              isNull(workers.erasedAt),
            ),
          )
          .limit(2);
    const workerId = senders.length === 1 ? (senders[0]?.id ?? null) : null;
    const kept = prepareEmail({
      subject: email.subject,
      text: email.text,
      attachments: email.attachments,
      fromKnownCasual: workerId !== null,
    });
    const [row] = await tx
      .insert(inboundEmails)
      .values({
        firmId: sql`app_current_firm_id()`,
        providerMessageId: email.messageId,
        workerId,
        fromAddress: email.from,
        toAddress: email.to,
        subject: kept.subject,
        body: kept.body,
        attachments: kept.attachments,
      })
      .onConflictDoNothing({ target: [inboundEmails.firmId, inboundEmails.providerMessageId] })
      .returning({ id: inboundEmails.id });
    return { stored: row !== undefined };
  });
}
