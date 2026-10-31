import { and, eq } from "drizzle-orm";
import { loginByEmail } from "../auth/login-channel";
import { firms, workers } from "../db/schema";
import { withFirm, type FirmTx, type WithFirm } from "../db/scoped";
import { appEnv, type AppEnv } from "../env";

// How a casual's login link and pay-page code reach them, as the login, pay, help and profile pages
// say it (P2.7; docs/screens.md "How login links and codes go"). The job decides each send itself,
// by the same two facts (src/lib/auth/login-channel.ts): "message" while there's a text sender
// (WhatsApp or text, the words as before); else "email" when the firm has switched
// `login_by_email` on; else "off": nothing can be sent, and the pages say so instead of promising a
// link.
export type LoginWay = "message" | "email" | "off";

export function loginWay(textSender: boolean, settings: Record<string, unknown>): LoginWay {
  if (textSender) return "message";
  return loginByEmail(settings) ? "email" : "off";
}

// Whether the worker has a text sender: the web app reads MESSAGING_TRANSPORT for this only, and
// Compose gives it the worker's value (deploy/docker-compose.yml). Only "none" means no sender.
export function textSenderIn(env: Pick<AppEnv, "MESSAGING_TRANSPORT">): boolean {
  return env.MESSAGING_TRANSPORT !== "none";
}

export function hasTextSender(): boolean {
  return textSenderIn(appEnv());
}

async function firmSettings(tx: FirmTx, firmId: string): Promise<Record<string, unknown>> {
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, firmId));
  return firm?.settings ?? {};
}

// The firm's way, for the login and help pages (open without logging in).
export async function firmLoginWay(
  firmId: string,
  run: WithFirm = withFirm,
  textSender: boolean = hasTextSender(),
): Promise<LoginWay> {
  if (textSender) return "message";
  return run(firmId, async (tx) => loginWay(textSender, await firmSettings(tx, firmId)));
}

// One casual's way, for the pay page's code: "email" only when the firm holds an address for them
// (the job sends nothing otherwise: no_channel), else "off".
export async function workerLoginWay(
  firmId: string,
  workerId: string,
  run: WithFirm = withFirm,
  textSender: boolean = hasTextSender(),
): Promise<LoginWay> {
  if (textSender) return "message";
  return run(firmId, async (tx) => {
    const way = loginWay(textSender, await firmSettings(tx, firmId));
    if (way !== "email") return way;
    const [worker] = await tx
      .select({ email: workers.email })
      .from(workers)
      .where(and(eq(workers.firmId, firmId), eq(workers.id, workerId)));
    return worker?.email ? "email" : "off";
  });
}
