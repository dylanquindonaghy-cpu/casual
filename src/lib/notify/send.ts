import { activeFirmId, type FirmTx } from "../db/scoped";
import { passesLogCheck, recordEvent } from "../events/record";
import { errorCode } from "../jobs/firm-job";
import type { MessagingTransport } from "../messaging";
import { ChannelRefusedError, NoTextSenderError } from "../messaging/transport";
import { forgetPushTarget, pushTargets, type PushTarget } from "../push/subscriptions";
import {
  pushFailureCode,
  type PushPayload,
  type PushSendResult,
  type PushTransport,
} from "../push/transport";
import { log, type Logger } from "../log";

const pushHost = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
};

// One message to a worker (docs/messaging-templates.md, "Notification policy"), the same way for
// every sender. Since Phase 26.9 (decision 4; Phase 15's "Texts only") no message to a casual goes
// by WhatsApp: deliverToWorker (below; P2.4) puts a push first, then their chosen way (a text, or an
// email), then an email when no text can go (sendTextOrEmail).
//
// sendToWorker is the shifts line's own reply (src/lib/inbound/reply.ts, the office's reply on
// Enquiries): an answer on the channel the casual wrote on, from the number they wrote to.
// - A text never goes to a worker who replied STOP (`smsAllowed` false: workers.sms_opted_out_at is
//   set): nothing goes (failed, `sms_opted_out`). Until Phase 26.9 they got WhatsApp instead.
// - A WhatsApp to the Twilio shifts line (which never went live) is answered by WhatsApp; one the
//   provider refuses (ChannelRefusedError) or with no WhatsApp sender (NoTextSenderError) goes by
//   text at once, unless they replied STOP. Any other failure (a timeout, an outage) might already
//   have arrived, so it's never sent again: the caller records it as failed.
// sendText is a text alone, the way every other message to a casual goes when it goes by text.
//
// The caller claims its own record (offer, reminder, notice) in a committed transaction before
// calling, pushes and sends with no transaction open, then records the outcome and logs its event
// in a short one (claim → push or send → record): a retried job never sends twice.

export interface NotifyDeps {
  transport: MessagingTransport;
  push: PushTransport;
}

// The channel a shifts-line conversation is on (the message the casual sent).
export type LineChannel = "whatsapp" | "sms";
// How a casual wants messages when no app notification reaches them (workers.notify_channel).
export type WorkerChannel = "sms" | "email";

// Whether a worker may be sent texts: not after they replied STOP (workers.sms_opted_out_at).
export const smsAllowedFor = (w: { smsOptedOutAt: Date | string | null }) =>
  w.smsOptedOutAt === null;

// A message's words: `whatsapp` is the full wording (an email's body too; named for WhatsApp,
// which carried it until Phase 26.9), `sms` the short one for a text (the same words when the doc
// has no SMS version).
export interface MessageText {
  whatsapp: string;
  sms: string;
}

type SendOutcome<C> =
  | { ok: true; channel: C; providerMessageId: string; fellBackFrom?: LineChannel }
  | { ok: false; channel: C; code: string };

// The shifts line's reply on the casual's own channel (above). Holds no transaction. `from` is the
// firm's shifts line (null when it has none yet): every message to a worker goes from it
// (tests/unit/notify.from-line.test.ts holds every sender to this).
export async function sendToWorker(
  deps: Pick<NotifyDeps, "transport">,
  input: {
    mobile: string;
    channel: LineChannel;
    smsAllowed: boolean; // false: they replied STOP (never a text)
    body: MessageText;
    from: string | null;
  },
): Promise<SendOutcome<LineChannel>> {
  if (input.channel === "sms") return sendText(deps, input);
  const from = input.from ? { from: input.from } : {};
  try {
    const { providerMessageId } = await deps.transport.send({
      channel: "whatsapp",
      to: input.mobile,
      ...from,
      body: input.body.whatsapp,
    });
    return { ok: true, channel: "whatsapp", providerMessageId };
  } catch (error) {
    // No WhatsApp sender, or the number isn't on WhatsApp: nothing was sent, so a text may go.
    const noSender = error instanceof NoTextSenderError;
    if (!(error instanceof ChannelRefusedError || noSender)) {
      return { ok: false, channel: "whatsapp", code: sendFailureCode(error) };
    }
    if (!input.smsAllowed) {
      return { ok: false, channel: "whatsapp", code: noSender ? NO_TEXT_SENDER : "sms_opted_out" };
    }
    const text = await sendText(deps, input);
    return text.ok ? { ...text, fellBackFrom: "whatsapp" } : text;
  }
}

// A text, and nothing else: never to a casual who replied STOP (`sms_opted_out`, nothing tried);
// NO_TEXT_SENDER when there's no text sender (nothing was sent: the caller may email instead).
export async function sendText(
  deps: Pick<NotifyDeps, "transport">,
  input: { mobile: string; smsAllowed: boolean; body: MessageText; from: string | null },
): Promise<SendOutcome<"sms">> {
  if (!input.smsAllowed) return { ok: false, channel: "sms", code: "sms_opted_out" };
  try {
    const { providerMessageId } = await deps.transport.send({
      channel: "sms",
      to: input.mobile,
      ...(input.from ? { from: input.from } : {}),
      body: input.body.sms,
    });
    return { ok: true, channel: "sms", providerMessageId };
  } catch (error) {
    return { ok: false, channel: "sms", code: sendFailureCode(error) };
  }
}

// What sendToWorker says when there's no text sender at all (P2.5): nothing was tried.
export const NO_TEXT_SENDER = "no_text_sender";

// The code a failed send logs: NO_TEXT_SENDER when there was no text sender at all, else the
// error's (errorCode). Every sender that sends a WhatsApp or text itself (the login link and code,
// the shifts line's unknown-number reply and STOP or START answer) logs it the same way, so the
// send-failure alert can leave it out (src/lib/ops/tick.ts).
export const sendFailureCode = (error: unknown): string =>
  error instanceof NoTextSenderError ? NO_TEXT_SENDER : errorCode(error);

// Nothing could carry the message: no phone took a push, no text can go, and we hold no email
// address for them (P2.4). Logged as the sender's failure, so the office can see who wasn't reached.
export const NO_CHANNEL = "no_channel";

// How a message went: a push, a text or an email (and "whatsapp" on the shifts line's own replies
// and on records from before Phase 26.9).
export type DeliveryChannel = LineChannel | "push" | "email";

// One message to a casual, every way it can reach them, in order (Phase 26.9, decision 4; P2.4;
// docs/messaging-templates.md "How a message reaches a casual"):
// 1. a push to the phones they turned notifications on for (free): delivered once one phone takes
//    it, and nothing else goes;
// 2. else their chosen way (`text.channel`, workers.notify_channel): a text, or an email to the
//    address the firm holds for them (one who chose email whose address has gone gets a text);
// 3. a text that can't go because there's no text sender (NoTextSenderError) or they replied STOP
//    goes by email instead, when the firm holds an address for them (its subject from
//    docs/messaging-templates.md "Email to casuals", its body the message's own words);
// 4. else not sent: NO_CHANNEL (no text sender) or `sms_opted_out` (STOP).
// A text or email that fails, or might have arrived, is the sender's failure: never sent another
// way, which could send it twice. Never by WhatsApp.
// Holds no transaction (the push reads the phones in a short one of its own, as pushToWorker always
// has). The caller records what came of the push (recordPushes) whatever the outcome: a phone found
// gone is forgotten either way. A message with no push words (the licence messages) starts at 2:
// sendTextOrEmail.
//
// The office's change and cancellation notices (`proofOfNotice`: Dylan, 2026-10-29) are the record
// of the notice the casual was given (golden rule 12; the Employment Rights Act): a push taken
// shows only that the push service took it, and it expires unseen once the shift starts. So for
// them the text or email (2 to 4) goes as well as the push, never instead of it. One that can't go
// while a phone took the push still counts as told, by push, and says why the message didn't go
// (`alsoFailed`).
export interface Delivery {
  workerId: string;
  push: PushPayload;
  text: {
    mobile: string;
    channel: WorkerChannel; // their choice: a text or an email
    smsAllowed: boolean; // false: they replied STOP (never a text)
    body: MessageText;
    from: string | null;
  };
  email: { to: string; subject: string; body: string } | null;
  proofOfNotice?: true;
}

export type TextOrEmail =
  | {
      ok: true;
      channel: DeliveryChannel;
      providerMessageId: string | null; // none for a push (an email's: emailMessageId)
      // Not their chosen way: "sms" when a text couldn't go (STOP) and it went by email; "email"
      // when they chose email but the firm no longer holds an address, so it went by text.
      fellBackFrom?: WorkerChannel | LineChannel;
    }
  | { ok: false; channel: DeliveryChannel | null; code: string };

export type Delivered = TextOrEmail & {
  push: PushOutcome;
  // A notice that went by push only: why its text or email didn't go (proofOfNotice).
  alsoFailed?: { channel: DeliveryChannel | null; code: string };
};

export async function deliverToWorker(
  inFirm: InFirm,
  deps: NotifyDeps,
  delivery: Delivery,
): Promise<Delivered> {
  const push = await pushToWorker(inFirm, deps, delivery.workerId, delivery.push);
  const pushed = { ok: true, channel: "push", providerMessageId: null, push } as const;
  if (push.pushes > 0 && !delivery.proofOfNotice) return pushed;
  const sent = await sendTextOrEmail(deps, delivery);
  if (!sent.ok && push.pushes > 0) {
    return { ...pushed, alsoFailed: { channel: sent.channel, code: sent.code } };
  }
  return { ...sent, push };
}

// An email's id as the action log keeps it: its Message-ID ("<31fa7821-…@example.test>") holds the
// sending host after an "@", which the log refuses as an address (src/lib/events/record.ts), so
// only the part before it; none if that isn't a plain id, or if the log would refuse it anyway (a
// long run of digits reads as a phone number): the record of an email that went must never fail.
export const emailMessageId = (id: string): string | null => {
  const local = /^<?([A-Za-z0-9._-]{1,100})@/.exec(id)?.[1] ?? id;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(local)) return null;
  return passesLogCheck({ providerMessageId: local }) ? local : null;
};

// Steps 2 to 4 of deliverToWorker: their chosen way (a text, or an email), a text that can't go
// (no text sender, or STOP) by email instead, else NO_CHANNEL or `sms_opted_out`.
export async function sendTextOrEmail(
  deps: Pick<NotifyDeps, "transport">,
  delivery: Pick<Delivery, "text" | "email">,
): Promise<TextOrEmail> {
  // Never with a transaction open: an email can take seconds, holding a connection meanwhile.
  if (activeFirmId() !== undefined) {
    throw new Error(
      "sendTextOrEmail must be called with no transaction open (src/lib/notify/send.ts)",
    );
  }
  const email = delivery.email;
  if (delivery.text.channel === "email" && email) return sendEmail(deps, email);
  const text = await sendText(deps, delivery.text);
  const chose = delivery.text.channel === "email" ? { fellBackFrom: "email" as const } : {};
  if (text.ok) return { ...text, ...chose };
  // Nothing was sent: no text sender, or they replied STOP.
  const noSender = text.code === NO_TEXT_SENDER;
  if (!noSender && text.code !== "sms_opted_out") return text;
  if (!email) return noSender ? { ok: false, channel: null, code: NO_CHANNEL } : text;
  const sent = await sendEmail(deps, email);
  return sent.ok && !noSender ? { ...sent, fellBackFrom: "sms" } : sent;
}

async function sendEmail(
  deps: Pick<NotifyDeps, "transport">,
  email: NonNullable<Delivery["email"]>,
): Promise<TextOrEmail> {
  try {
    const { providerMessageId } = await deps.transport.send({
      channel: "email",
      to: email.to,
      subject: email.subject,
      body: email.body,
    });
    return { ok: true, channel: "email", providerMessageId: emailMessageId(providerMessageId) };
  } catch (error) {
    return { ok: false, channel: "email", code: errorCode(error) };
  }
}

// What pushing to a worker's phones came to (pushToWorker), recorded in the sender's outcome
// transaction (recordPushes).
export interface PushOutcome {
  pushes: number; // how many phones took it
  forget: { target: PushTarget; reason: "gone" | "not_a_push_service" }[];
  failed: { host: string; code: string }[];
  readFailed?: string; // the phones couldn't be read (a code): nothing was pushed
}

// A code that's safe to log: a Postgres SQLSTATE or the error's class, never anything else from it
// (an error's name could hold a push address).
const safeCode = (error: unknown) => {
  const code = errorCode(error);
  return /^[0-9A-Z]{5}$|^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(code) ? code : "unknown";
};

// A firm's withFirm, bound to the firm: each sender's own `inFirm`.
export type InFirm = <T>(fn: (tx: FirmTx) => Promise<T>) => Promise<T>;

// The push to each phone the worker turned notifications on for, all at once: the first way a
// message goes (P2.4; before, it went after the message). The phones are read in a short transaction of their own and pushed with none open:
// each push is cut off at PUSH_TIMEOUT_MS, and a slow push service holds no database connection
// meanwhile (the worker's pool is shared by every job). It never throws, so a push can't stop the
// record of a message that went: a push that throws counts as failed, and phones that can't be read
// are noted, with nothing pushed. The one exception is a caller with a transaction open, a bug
// that would hold it across the pushes: that throws at once, before anything is pushed.
export async function pushToWorker(
  inFirm: InFirm,
  deps: Pick<NotifyDeps, "push">,
  workerId: string,
  payload: PushPayload,
): Promise<PushOutcome> {
  return pushToTargets(inFirm, deps, (tx) => pushTargets(tx, workerId), payload, "pushToWorker");
}

// The same for any list of browsers (`read`, in its own short transaction): a worker's phones, or an
// office user's browsers (Phase 26.4, src/lib/office/alerts.ts).
export async function pushToTargets(
  inFirm: InFirm,
  deps: Pick<NotifyDeps, "push">,
  read: (tx: FirmTx) => Promise<PushTarget[]>,
  payload: PushPayload,
  caller = "pushToTargets",
): Promise<PushOutcome> {
  if (activeFirmId() !== undefined) {
    throw new Error(`${caller} must be called with no transaction open (src/lib/notify/send.ts)`);
  }
  const outcome: PushOutcome = { pushes: 0, forget: [], failed: [] };
  let targets: PushTarget[];
  try {
    targets = await inFirm(read);
  } catch (error) {
    return { ...outcome, readFailed: safeCode(error) };
  }
  // The path only: the service worker opens it on whichever address the phone subscribed on
  // (a firm's custom domain included).
  // Each push inside a promise, so one that throws, even before it returns one, is a failed push.
  const results = await Promise.all(
    targets.map((target) =>
      Promise.resolve()
        .then(() => deps.push.send(target, payload))
        .catch((error: unknown): PushSendResult => ({
          status: "failed",
          code: pushFailureCode(error),
        })),
    ),
  );
  for (const [i, sent] of results.entries()) {
    const target = targets[i];
    if (!target) continue;
    if (sent.status === "gone" || sent.status === "refused") {
      outcome.forget.push({
        target,
        reason: sent.status === "gone" ? "gone" : "not_a_push_service",
      });
    } else if (sent.status === "sent") {
      outcome.pushes += 1;
    } else if (sent.status === "failed") {
      outcome.failed.push({ host: pushHost(target.endpoint), code: sent.code });
    }
  }
  return outcome;
}

// In the sender's outcome transaction: a phone the push service says is gone, or whose address isn't
// a push service's (refused), is forgotten and logged, but only while it still has the keys that
// were pushed to (a new login on that phone may have taken it over since). One that failed this time
// (a refusal, a time-out: PUSH_TIMEOUT_MS) is kept, and the log line names the firm, the push
// service's host and a code, never the address (it addresses one person's phone). Nothing here
// can roll back the sender's record. Returns how many phones took it (none when nothing was
// pushed: `outcome` null).
export async function recordPushes(
  tx: FirmTx,
  outcome: PushOutcome | null,
  logger: Logger = log,
  // Whose browsers they were: a worker's phones (push_subscriptions), or an office user's
  // (office_push_subscriptions, Phase 26.4).
  whose: {
    forget: (tx: FirmTx, target: PushTarget) => Promise<boolean>;
    entityType: string;
    action: string;
  } = { forget: forgetPushTarget, entityType: "push_subscription", action: "push.forgotten" },
): Promise<number> {
  if (!outcome) return 0;
  if (outcome.readFailed) {
    logger.warn("push not tried", { firmId: activeFirmId(), code: outcome.readFailed });
  }
  for (const { target, reason } of outcome.forget) {
    // In a savepoint: one that fails (a deadlock with a save on the same phone) is logged and kept,
    // and never rolls back the record of the message that went.
    try {
      await tx.transaction(async (sp) => {
        if (!(await whose.forget(sp, target))) return;
        await recordEvent(sp, {
          actorType: "system",
          action: whose.action,
          entityType: whose.entityType,
          entityId: target.id,
          data: { reason },
        });
      });
    } catch (error) {
      logger.warn("push phone not forgotten", { firmId: activeFirmId(), code: safeCode(error) });
    }
  }
  for (const failed of outcome.failed) {
    logger.warn("push not delivered", {
      firmId: activeFirmId(),
      host: failed.host,
      code: failed.code,
    });
  }
  return outcome.pushes;
}
