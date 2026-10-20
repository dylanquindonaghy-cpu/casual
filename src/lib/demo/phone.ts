import { officeUsers, workers } from "../db/schema";
import { activeFirmId, type FirmTx } from "../db/scoped";
import { parseOutbox, readOutboxTail, type OutboxMessage } from "./outbox";

// The Demo phone page's messages (16.1; ADR-025): what this firm sent its own people (its casuals
// by mobile or email, its office team by email), newest first, at most `limit`. The outbox holds
// every firm's messages, each line stamped with the firm whose job sent it
// (src/lib/tenancy/job-firm.ts): only lines stamped with this firm's id count, so a casual who
// works for two firms (one number in both) sees each firm's texts on that firm's page alone. And
// only to someone this firm has, read inside its withFirm transaction (their name comes from
// there); a line with no firm, or to a number nobody here has, is never shown.

export interface DemoPhoneMessage {
  at: Date;
  // "Text", "WhatsApp" or "Email" on the page.
  channel: OutboxMessage["channel"];
  // Who it went to, as the firm knows them, and the number or address it went to.
  toName: string;
  to: string;
  subject?: string;
  body: string;
  attachments: string[];
}

export async function demoPhoneMessages(
  tx: FirmTx,
  outboxFile: string,
  limit = 50,
): Promise<DemoPhoneMessage[]> {
  // The firm this transaction is scoped to: the same one RLS reads the people for.
  const firmId = activeFirmId();
  if (!firmId) throw new Error("demoPhoneMessages runs inside withFirm");
  const people = new Map<string, string>();
  const casuals = await tx
    .select({
      first: workers.firstName,
      last: workers.lastName,
      mobile: workers.mobileE164,
      email: workers.email,
    })
    .from(workers);
  for (const c of casuals) {
    const name = `${c.first} ${c.last}`;
    if (c.mobile) people.set(c.mobile, name);
    if (c.email) people.set(c.email.toLowerCase(), name);
  }
  const office = await tx
    .select({ name: officeUsers.name, email: officeUsers.email })
    .from(officeUsers);
  for (const o of office) people.set(o.email.toLowerCase(), o.name);

  const all = parseOutbox(await readOutboxTail(outboxFile));
  const mine: DemoPhoneMessage[] = [];
  for (let i = all.length - 1; i >= 0 && mine.length < limit; i -= 1) {
    const m = all[i] as OutboxMessage;
    if (m.firmId !== firmId) continue;
    const key = m.channel === "email" ? m.to.toLowerCase() : m.to;
    const toName = people.get(key);
    if (toName === undefined) continue;
    mine.push({
      at: m.at,
      channel: m.channel,
      toName,
      to: m.to,
      ...(m.subject !== undefined ? { subject: m.subject } : {}),
      body: m.body,
      attachments: m.attachments,
    });
  }
  return mine;
}
