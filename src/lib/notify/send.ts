import { activeFirmId, type FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { errorCode } from "../jobs/firm-job";
import type { MessagingTransport } from "../messaging";
import { ChannelRefusedError } from "../messaging/transport";
import { forgetPushTarget, pushTargets } from "../push/subscriptions";
import type { PushPayload, PushTransport } from "../push/transport";
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
//   (free). A phone the push service says is gone is forgotten and logged.
//
// The caller claims its own record (offer, reminder, notice) in a committed transaction before
// calling, sends with no transaction open, then pushes and logs its event in a short one (claim →
// send → record): a retried job never sends twice.

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

// The push to each phone the worker turned notifications on for, all at once; how many took it.
// A phone the push service says is gone, or whose address isn't a push service's (refused), is
// forgotten and logged. One that failed this time (a refusal, a time-out: PUSH_TIMEOUT_MS) is kept,
// and the log line names the firm, the push service's host and a code, never the address (it
// addresses one person's phone). Each push is cut off at PUSH_TIMEOUT_MS, so the phones together
// hold this transaction that long at most (pushing outside it: PLAN.md Parking lot).
export async function pushToWorker(
  tx: FirmTx,
  deps: Pick<NotifyDeps, "push"> & { logger?: Logger },
  workerId: string,
  payload: PushPayload,
): Promise<number> {
  const targets = await pushTargets(tx, workerId);
  // The path only: the service worker opens it on whichever address the phone subscribed on
  // (a firm's custom domain included).
  const results = await Promise.all(targets.map((target) => deps.push.send(target, payload)));
  let pushes = 0;
  for (const [i, sent] of results.entries()) {
    const target = targets[i];
    if (!target) continue;
    if (sent.status === "gone" || sent.status === "refused") {
      await forgetPushTarget(tx, target.id);
      await recordEvent(tx, {
        actorType: "system",
        action: "push.forgotten",
        entityType: "push_subscription",
        entityId: target.id,
        data: { reason: sent.status === "gone" ? "gone" : "not_a_push_service" },
      });
    } else if (sent.status === "sent") {
      pushes += 1;
    } else if (sent.status === "failed") {
      (deps.logger ?? log).warn("push not delivered", {
        firmId: activeFirmId(),
        host: pushHost(target.endpoint),
        code: sent.code,
      });
    }
  }
  return pushes;
}
