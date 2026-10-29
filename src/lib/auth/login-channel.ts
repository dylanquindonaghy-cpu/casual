import { z } from "zod";
import type { MessagingTransport } from "../messaging";

// How a casual's login link and pay-page code go (P2.6; PLAN.md "Connecting the firm's systems"
// 16), decided in the job's claim, before the token or code is made: by WhatsApp when there's a
// text sender; else by email, when the firm has switched `login_by_email` on (`npm run
// firm:settings`) and holds an address for them; else not at all (logged as a failed send,
// `no_channel`). Off by default: the login and pay pages still tell casuals to look on WhatsApp
// until they're reworded after the UI chat (P2.7). Office users always get theirs by email.

const loginByEmailSchema = z.boolean();

// The firm's setting: anything but `true` is off.
export function loginByEmail(settings: Record<string, unknown>): boolean {
  const parsed = loginByEmailSchema.safeParse(settings.login_by_email);
  return parsed.success ? parsed.data : false;
}

export type LoginChannel = "whatsapp" | "email";

export function loginChannel(o: {
  transport: Pick<MessagingTransport, "texts">;
  settings: Record<string, unknown>;
  email: string | null;
}): LoginChannel | null {
  if (o.transport.texts !== false) return "whatsapp";
  return loginByEmail(o.settings) && o.email ? "email" : null;
}
