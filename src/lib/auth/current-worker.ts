import { redirect } from "next/navigation";
import { cache } from "react";
import type { FirmDirectoryEntry } from "../db/directory";
import { getCurrentFirm } from "../tenancy/current-firm";
import { readWorkerSessionToken } from "./session-cookie";
import { isSteppedUp } from "./step-up";
import { currentWorker, type WorkerSession } from "./worker-login";

// The logged-in worker for this request, looked up inside this host's firm (a session from
// another firm is invisible there, so it simply isn't found).
export const getWorkerSession = cache(
  async (): Promise<(WorkerSession & { firm: FirmDirectoryEntry }) | null> => {
    const firm = await getCurrentFirm();
    const token = await readWorkerSessionToken();
    if (!token) return null;
    const found = await currentWorker({ firm }, token);
    return found ? { ...found, firm } : null;
  },
);

// For pages only: it redirects to /login. Server actions must not use it (an action's redirect
// renders without the firm's Host header); they call getWorkerSession() and return a result.
export async function requireWorker(): Promise<WorkerSession & { firm: FirmDirectoryEntry }> {
  const session = await getWorkerSession();
  if (!session) redirect("/login");
  return session;
}

// For pay data (Phase 3): the worker's session only if it passed the step-up code in the last
// 30 minutes. Every loader and action that returns or changes pay data must call this itself,
// not rely on the page having shown the code gate.
export async function steppedUpWorker(): Promise<
  (WorkerSession & { firm: FirmDirectoryEntry }) | null
> {
  const session = await getWorkerSession();
  return session && isSteppedUp(session.session, new Date()) ? session : null;
}
