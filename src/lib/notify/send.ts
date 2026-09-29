import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { errorCode } from "../jobs/firm-job";
import type { MessagingTransport } from "../messaging";
import { ChannelRefusedError } from "../messaging/transport";
import { forgetPushTarget, pushTargets } from "../push/subscriptions";
import type { PushPayload, PushTransport } from "../push/transport";

// One message to a worker (docs/messaging-templates.md, "Notification policy"), the same way for
// every sender (offer waves, shift reminders):
//
// - by the channel the worker chose (WhatsApp or text message), with that channel's text (a text
//   message has its own short copy where docs/messaging-templates.md gives one);
// - a WhatsApp the provider refuses (ChannelRefusedError: the number isn't on WhatsApp) goes by
//   text at once. Any other failure (a timeout, an outage) might already have arrived, so it's
//   never sent again: the caller records it as failed. (Falling back when a WhatsApp isn't
//   delivered within 60 seconds needs Twilio's delivery reports: parked with Twilio.)
// - once the message has gone, a push to each phone the worker turned notifications on for
//   (free). A phone the push service says is gone is forgotten and logged.
//
// The caller writes its own record (offer, reminder) before calling, and its own event after.

export interface NotifyDeps {
  transport: MessagingTransport;
  push: PushTransport;
}

export type WorkerChannel = "whatsapp" | "sms";

// A message's text for each channel (the same text for both when the doc has no SMS version).
export interface MessageText {
  whatsapp: string;
  sms: string;
}

export type NotifyResult =
  | {
      ok: true;
      channel: WorkerChannel; // how it went (after any fallback)
      providerMessageId: string;
      pushes: number;
      fellBackFrom?: WorkerChannel;
    }
  | { ok: false; channel: WorkerChannel; code: string };

// The message only, by the worker's channel with the WhatsApp-to-text fallback. Holds no
// transaction, so a caller can send between its own (the reminder job records each reminder before
// and after sending, so a failure afterwards can't undo the record of a message that went).
export async function sendToWorker(
  deps: Pick<NotifyDeps, "transport">,
  input: { mobile: string; channel: WorkerChannel; body: MessageText },
): Promise<
  | { ok: true; channel: WorkerChannel; providerMessageId: string; fellBackFrom?: WorkerChannel }
  | { ok: false; channel: WorkerChannel; code: string }
> {
  let channel = input.channel;
  let providerMessageId: string;
  try {
    try {
      ({ providerMessageId } = await deps.transport.send({
        channel,
        to: input.mobile,
        body: input.body[channel],
      }));
    } catch (error) {
      if (!(error instanceof ChannelRefusedError) || channel !== "whatsapp") throw error;
      channel = "sms";
      ({ providerMessageId } = await deps.transport.send({
        channel,
        to: input.mobile,
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

// The push to each phone the worker turned notifications on for; how many took it. A phone the
// push service says is gone is forgotten and logged.
export async function pushToWorker(
  tx: FirmTx,
  deps: Pick<NotifyDeps, "push">,
  workerId: string,
  payload: PushPayload,
): Promise<number> {
  let pushes = 0;
  for (const target of await pushTargets(tx, workerId)) {
    // The path only: the service worker opens it on whichever address the phone subscribed on
    // (a firm's custom domain included).
    const sent = await deps.push.send(target, payload);
    if (sent.status === "gone") {
      await forgetPushTarget(tx, target.id);
      await recordEvent(tx, {
        actorType: "system",
        action: "push.forgotten",
        entityType: "push_subscription",
        entityId: target.id,
        data: { reason: "gone" },
      });
    } else if (sent.status === "sent") pushes += 1;
  }
  return pushes;
}

// Both, for a caller that sends inside its transaction (offer waves): the message, then the push
// once it has gone.
export async function notifyWorker(
  tx: FirmTx,
  deps: NotifyDeps,
  input: {
    workerId: string;
    mobile: string;
    channel: WorkerChannel;
    body: MessageText;
    push: PushPayload;
  },
): Promise<NotifyResult> {
  const sent = await sendToWorker(deps, input);
  if (!sent.ok) return sent;
  return { ...sent, pushes: await pushToWorker(tx, deps, input.workerId, input.push) };
}
