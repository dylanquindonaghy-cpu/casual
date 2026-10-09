// Shared staff-portal wording (docs/screens.md copy rules). Browser-safe: no imports.

// The answer when a tap fails. With no network at all, the browser knows, and says so; with weak
// signal it can't tell, and the general words are still true.
export function tryAgainText(online: boolean = isOnline()): string {
  return online ? "Something went wrong. Try again." : "No signal. Try again when you have signal.";
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}
