// Logging out from the browser (src/app/logout-button.tsx): a plain request to /api/logout, which
// works from any build of the page from now on (audit L92: an action's id changes with each build).
// Browser-safe: no imports (tests/unit/client-boundary.test.ts); the page's own steps are passed in.

export type LogoutOutcome = "done" | "no_signal" | "error";

const WAIT_MS = 10_000;

// Either the request never got anywhere, or no answer came within the limit (weak venue signal can
// hang rather than fail). In both it may or may not have reached us.
export async function logOut(
  kind: "worker" | "office",
  waitMs: number = WAIT_MS,
): Promise<LogoutOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
      credentials: "same-origin",
      signal: AbortSignal.timeout(waitMs),
    });
  } catch {
    return "no_signal";
  }
  return response.ok ? "done" : "error";
}

// The whole of logging out on this phone, in order: the offline copy goes first (even with no
// signal, a shared phone must not keep it), then this phone's alerts, then the session. Once the
// server has ended the session, the copy is deleted once more: a load of My shifts that started in
// between (the session was still live, so it was answered with the page) is never kept (the
// review of audit M27).
export async function logOutOfThisPhone(
  kind: "worker" | "office",
  steps: {
    clearCopy: () => Promise<boolean>;
    forgetPush: () => Promise<void>;
    logOut: (kind: "worker" | "office") => Promise<LogoutOutcome>;
  },
): Promise<{ outcome: LogoutOutcome; copyCleared: boolean }> {
  const copyCleared = await steps.clearCopy();
  await steps.forgetPush();
  const outcome = await steps.logOut(kind);
  if (outcome === "done") await steps.clearCopy();
  return { outcome, copyCleared };
}

// What the button says when it couldn't log out (docs/screens.md, "Log out"): short, and only what
// we know (audit L91).
export function logoutProblemText(
  kind: "worker" | "office",
  outcome: "no_signal" | "error",
  copyCleared: boolean,
): string {
  if (outcome === "error") return "Logging out didn't work. Try again.";
  const kept =
    kind === "worker" && copyCleared ? " Your shifts are no longer kept on this phone." : "";
  return `No signal. You may still be logged in.${kept} Try again when you have signal.`;
}
