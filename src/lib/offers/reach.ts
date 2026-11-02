// How an offer will reach a casual, and why (Phase 26.9, off-1 and off-5; decision 4): the same
// order as the sender (src/lib/notify/send.ts deliverToWorker), worked out before it goes, for the
// office's offer list. Pure.
//
// 1. An app notification, when a phone of theirs has notifications on.
// 2. Else their chosen way: an email when they chose it and the firm holds their address.
// 3. Else a text, while there's a text sender and they haven't replied STOP.
// 4. Else an email when the firm holds their address (no text sender, or STOP).
// 5. Else nothing can reach them.
// A push that a phone doesn't take falls to 2 to 4 when it's sent; the list can't know that ahead.

export type Reach =
  | { how: "push" }
  | { how: "sms" } // no app notifications on their phone
  | { how: "email"; why: "chose_email" | "texts_off" | "no_text_sender" }
  | { how: "none" };

export function reachOf(
  c: {
    phones: number; // their phones with notifications on
    channel: "sms" | "email"; // their choice
    smsAllowed: boolean; // false: they replied STOP
    hasEmail: boolean; // the firm holds an address for them
  },
  textSender: boolean,
): Reach {
  if (c.phones > 0) return { how: "push" };
  if (c.channel === "email" && c.hasEmail) return { how: "email", why: "chose_email" };
  if (textSender && c.smsAllowed) return { how: "sms" };
  if (c.hasEmail) return { how: "email", why: c.smsAllowed ? "no_text_sender" : "texts_off" };
  return { how: "none" };
}
