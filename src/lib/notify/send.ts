import { activeFirmId, type FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { errorCode } from "../jobs/firm-job";
import type { MessagingTransport } from "../messaging";
import { ChannelRefusedError } from "../messaging/transport";
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
// every sender (offer waves, shift reminders):
//
// - by the channel the worker chose (WhatsApp or text message), with that channel's text (a text
//   message has its own short copy where docs/messaging-templates.md gives one);
// - a WhatsApp the provider refuses (ChannelRefusedError: the number isn't on WhatsApp) goes by
//   text at once. Any other failure (a timeout, an outage) might already have arrived, so it's
//   never sent again: the caller records it as failed. (Falling back when a WhatsApp isn't
//   delivered within 60 seconds needs Twilio's delivery reports: parked with Twilio.)
// - never a text to a worker who replied STOP (`smsAllowed` false: workers.sms_opted_out_at is
//   set): one who chose texts gets WhatsApp instead (`fellBackFrom: "sms"`), and a WhatsApp refused
//   for them isn't sent as a text (failed, code `sms_opted_out`). Every sender passes it.
// - once the message has gone, a push to each phone the worker turned notifications on for
//   (free), with no transaction open. A phone the push service says is gone is forgotten and logged.
//
// The caller claims its own record (offer, reminder, notice) in a committed transaction before
// calling, sends and pushes with no transaction open, then records the outcome and logs its event in
// a short one (claim → send → push → record): a retried job never sends twice.

export interface NotifyDeps {
  transport: MessagingTransport;
  push: PushTransport;
}

export type WorkerChannel = "whatsapp" | "sms";

// Whether a worker may be sent texts: not after they replied STOP (workers.sms_opted_out_at).
export const smsAllowedFor = (w: { smsOptedOutAt: Date | string | null }) =>
  w.smsOptedOutAt === null;

// A message's text for each channel (the same text for both when the doc has no SMS version).
export interface MessageText {
  whatsapp: string;
  sms: string;
}

// The message only, by the worker's channel with the WhatsApp-to-text fallback. Holds no
// transaction, so a caller can send between its own (the reminder job records each reminder before
// and after sending, so a failure afterwards can't undo the record of a message that went).
// `from` is the firm's shifts line (null when it has none yet): every message to a worker goes
// from it (tests/unit/notify.from-line.test.ts holds every sender to this).
export async function sendToWorker(
  deps: Pick<NotifyDeps, "transport">,
  input: {
    mobile: string;
    channel: WorkerChannel;
    smsAllowed: boolean; // false: they replied STOP (never a text)
    body: MessageText;
    from: string | null;
  },
): Promise<
  | { ok: true; channel: WorkerChannel; providerMessageId: string; fellBackFrom?: WorkerChannel }
  | { ok: false; channel: WorkerChannel; code: string }
> {
  let channel: WorkerChannel = input.smsAllowed ? input.channel : "whatsapp";
  let providerMessageId: string;
  const from = input.from ? { from: input.from } : {};
  try {
    try {
      ({ providerMessageId } = await deps.transport.send({
        channel,
        to: input.mobile,
        ...from,
        body: input.body[channel],
      }));
    } catch (error) {
      if (!(error instanceof ChannelRefusedError) || channel !== "whatsapp") throw error;
      if (!input.smsAllowed) return { ok: false, channel, code: "sms_opted_out" };
      channel = "sms";
      ({ providerMessageId } = await deps.transport.send({
        channel,
        to: input.mobile,
        ...from,
        body: input.body[channel],
      }));
    }
  } catch (error) {
    return { ok: false, channel, code: errorCode(error) };
  }
  return {
    ok: true,
    channel,
    providerMessageId,
    ...(channel !== input.channel ? { fellBackFrom: input.channel } : {}),
  };
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

// The push to each phone the worker turned notifications on for, all at once, once the message has
// gone (14.1). The phones are read in a short transaction of their own and pushed with none open:
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
  if (activeFirmId() !== undefined) {
    throw new Error(
      "pushToWorker must be called with no transaction open (src/lib/notify/send.ts)",
    );
  }
  const outcome: PushOutcome = { pushes: 0, forget: [], failed: [] };
  let targets: PushTarget[];
  try {
    targets = await inFirm((tx) => pushTargets(tx, workerId));
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
        if (!(await forgetPushTarget(sp, target))) return;
        await recordEvent(sp, {
          actorType: "system",
          action: "push.forgotten",
          entityType: "push_subscription",
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
