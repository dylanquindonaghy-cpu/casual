import { z } from "zod";
import type { MessagingTransport } from "../messaging";

// How a casual's login link and pay-page code go (P2.6; Phase 26.9), decided in the job's claim,
// before the token or code is made: by text when there's a text sender and they haven't replied
// STOP (by WhatsApp until Phase 26.9); else by email, when the firm has switched `login_by_email`
// on (`npm run firm:settings`, off by default) and holds an address for them; else not at all
// (logged as a failed send, `no_channel`). A text that finds no text sender when it goes (a firm
// with no Webex key of its own) goes by email under the same rule (`loginEmailAllowed`). Their
// choice for shift messages doesn't apply: they asked for the link. The login, pay, help and profile
// pages say which way it goes (P2.7: src/lib/portal/login-way.ts). Office users always get theirs
// by email.

const loginByEmailSchema = z.boolean();

// The firm's setting: anything but `true` is off.
export function loginByEmail(settings: Record<string, unknown>): boolean {
  const parsed = loginByEmailSchema.safeParse(settings.login_by_email);
  return parsed.success ? parsed.data : false;
}

export type LoginChannel = "sms" | "email";

export function loginChannel(o: {
  transport: Pick<MessagingTransport, "texts">;
  settings: Record<string, unknown>;
  email: string | null;
  smsAllowed: boolean; // false: they replied STOP
}): LoginChannel | null {
  if (o.transport.texts !== false && o.smsAllowed) return "sms";
  return loginEmailAllowed(o.settings, o.email) ? "email" : null;
}

// Whether a link or code may go by email: the firm has login by email on and holds their address.
export const loginEmailAllowed = (
  settings: Record<string, unknown>,
  email: string | null,
): email is string => loginByEmail(settings) && !!email;
