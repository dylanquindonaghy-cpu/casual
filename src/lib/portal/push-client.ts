// The browser's side of this phone's web push subscription (profile, logout, login). Browser-
// safe: no imports. Never throws and never waits long: logging in or out must not depend on it.

const WAIT_MS = 1500;
const within = <T>(p: Promise<T>): Promise<T | undefined> =>
  Promise.race([p, new Promise<undefined>((resolve) => setTimeout(resolve, WAIT_MS))]);

// Logging out or in on a shared phone: this phone stops getting the last worker's alerts. The
// server forgets it (best effort) and the browser drops the subscription.
export async function forgetThisPhonesPush(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await within(navigator.serviceWorker.getRegistration());
    const subscription = await within(
      registration?.pushManager.getSubscription() ?? Promise.resolve(null),
    );
    if (!subscription) return;
    await within(
      fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => undefined),
    );
    await within(subscription.unsubscribe());
  } catch {
    // Nothing to forget.
  }
}
