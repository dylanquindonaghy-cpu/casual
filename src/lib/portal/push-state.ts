// What the profile's "Notifications on this phone" shows (docs/screens.md, `/profile`). Browser-
// safe: no imports. Decided in the browser: whether it can push, whether it's an iPhone not yet
// on the home screen (iPhone push only works from there), what the worker has allowed, and
// whether this phone is already subscribed.

export type PushState =
  | "no_key" // the firm's web push isn't switched on (no VAPID key)
  | "unsupported"
  | "add_to_home_screen"
  | "blocked" // notifications denied in the browser
  | "on"
  | "off";

export function pushSettingState(device: {
  hasKey: boolean;
  supported: boolean;
  iPhoneNotOnHomeScreen: boolean;
  permission: "granted" | "denied" | "default";
  subscribed: boolean;
}): PushState {
  if (!device.hasKey) return "no_key";
  if (device.iPhoneNotOnHomeScreen) return "add_to_home_screen";
  if (!device.supported) return "unsupported";
  if (device.permission === "denied") return "blocked";
  return device.subscribed && device.permission === "granted" ? "on" : "off";
}

// The VAPID public key (base64url) as the bytes pushManager.subscribe wants.
export function keyBytes(base64url: string): Uint8Array {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
