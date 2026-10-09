import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PushSetting } from "@/app/profile/push-setting";
import { PushSettingView } from "@/app/profile/push-setting-view";
import { parseWorkerEnv } from "@/lib/env";
import { stopOfflineCopy } from "@/lib/portal/offline";
import { urgentPush } from "@/lib/messaging/templates";
import { keyBytes, pushSettingState } from "@/lib/portal/push-state";
import {
  createConsolePushTransport,
  getPushTransport,
  noPushTransport,
} from "@/lib/push/transport";
import { afterEach, vi } from "vitest";

// Web push on the profile and in offers: which state the profile shows, the key conversion, the
// push wording, and the console transport (the real sender isn't connected: PLAN.md Parking lot).

const device = (o: Partial<Parameters<typeof pushSettingState>[0]> = {}) => ({
  hasKey: true,
  supported: true,
  iPhoneNotOnHomeScreen: false,
  permission: "default" as const,
  subscribed: false,
  ...o,
});

describe("pushSettingState", () => {
  it("no key: not switched on for the firm yet", () => {
    expect(pushSettingState(device({ hasKey: false }))).toBe("no_key");
  });
  it("an iPhone not on the home screen is told to add it first", () => {
    expect(pushSettingState(device({ iPhoneNotOnHomeScreen: true, supported: false }))).toBe(
      "add_to_home_screen",
    );
  });
  it("otherwise by what the browser can do and the worker allowed", () => {
    expect(pushSettingState(device({ supported: false }))).toBe("unsupported");
    expect(pushSettingState(device({ permission: "denied" }))).toBe("blocked");
    expect(pushSettingState(device())).toBe("off");
    expect(pushSettingState(device({ permission: "granted", subscribed: true }))).toBe("on");
    expect(pushSettingState(device({ permission: "default", subscribed: true }))).toBe("off");
  });
});

describe("keyBytes", () => {
  it("turns a base64url key into its bytes", () => {
    expect([...keyBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("the push wording", () => {
  it("urgent offers: 'Urgent shift' / '{Role} needed at {site} {day} {start}.'", () => {
    expect(
      urgentPush({
        role: "door_supervisor",
        site: "Acme Demo Arena",
        day: "today",
        start: "19:00",
      }),
    ).toEqual({
      title: "Urgent shift",
      body: "Door supervisor needed at Acme Demo Arena today 19:00.",
    });
    expect(
      urgentPush({ role: "steward", site: null, day: "on Sat 7 Nov", start: "08:00" }).body,
    ).toBe("Steward needed on Sat 7 Nov 08:00.");
  });
});

describe("the console push transport", () => {
  it("prints the message and the push service's host, never the phone's address", async () => {
    const lines: string[] = [];
    const push = createConsolePushTransport((l) => lines.push(l));
    const result = await push.send(
      {
        id: "1",
        endpoint: "https://fcm.googleapis.com/fcm/send/secret-token-123",
        p256dh: "k",
        auth: "a",
      },
      {
        title: "Urgent shift",
        body: "Steward needed today 08:00.",
        url: "https://acme.example/shifts/1",
      },
    );
    expect(result).toEqual({ status: "sent" });
    expect(lines).toEqual([
      "[push] via fcm.googleapis.com: Urgent shift | Steward needed today 08:00. | https://acme.example/shifts/1",
    ]);
    expect(lines.join()).not.toContain("secret-token");
  });
});

describe("the profile's push setting", () => {
  it("without the firm's key, says so plainly (no JavaScript needed)", () => {
    const text = renderToStaticMarkup(
      createElement(PushSetting, { publicKey: null, firmName: "Acme Events" }),
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
    expect(text).toContain("Notifications on this phone");
    expect(text).toContain(
      "Phone notifications aren't switched on for Acme Events yet. You'll get messages by WhatsApp or text.",
    );
  });
  it("with a key, the phone decides after the page loads", () => {
    expect(
      renderToStaticMarkup(
        createElement(PushSetting, { publicKey: "k".repeat(87), firmName: "Acme" }),
      ),
    ).toBe("");
  });
});

describe("the push setting's words in every state", () => {
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
  const view = (o: Partial<Parameters<typeof PushSettingView>[0]>) =>
    text(
      renderToStaticMarkup(
        createElement(PushSettingView, { state: "off", firmName: "Acme Events", ...o }),
      ),
    );
  it("says what's happening and what to do", () => {
    expect(view({ state: "off" })).toContain(
      "Get urgent shift alerts on this phone, as well as by message. Turn on notifications",
    );
    expect(view({ state: "on" })).toContain(
      "Notifications are on for this phone. Turn off notifications",
    );
    expect(view({ state: "off", justTurnedOff: true })).toContain(
      "Notifications are off for this phone. You'll still get messages by WhatsApp or text.",
    );
    expect(view({ state: "blocked" })).toContain("You can allow them in your phone's settings.");
    expect(view({ state: "unsupported" })).toContain("This browser can't show notifications.");
    expect(view({ state: "add_to_home_screen" })).toContain(
      "On iPhone, add this page to your home screen first.",
    );
  });
});

describe("which push sender (PUSH_TRANSPORT)", () => {
  const worker = {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
    DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
    SESSION_SECRET: "a-real-looking-secret-of-32-characters-or-more",
    APP_BASE_DOMAIN: "localhost:3000",
  };
  it("console by default; none pushes nothing", async () => {
    expect(parseWorkerEnv(worker).PUSH_TRANSPORT).toBe("console");
    expect(getPushTransport({ PUSH_TRANSPORT: "none" })).toBe(noPushTransport);
    expect(
      await noPushTransport.send(
        { id: "1", endpoint: "e", p256dh: "k", auth: "a" },
        { title: "t", body: "b", url: "/" },
      ),
    ).toEqual({ status: "skipped" });
  });
  it("production may never print pushes instead of sending them", () => {
    expect(() =>
      parseWorkerEnv({ ...worker, NODE_ENV: "production", MESSAGING_TRANSPORT: "console" }),
    ).toThrow();
    const production = parseWorkerEnv.bind(null, { ...worker, NODE_ENV: "production" });
    expect(production).toThrow(/PUSH_TRANSPORT/);
  });
});

describe("turning the offline copy off", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("keeps a service worker that carries this phone's push notifications", async () => {
    const unregistered: string[] = [];
    const registration = (name: string, pushing: boolean) => ({
      pushManager: { getSubscription: async () => (pushing ? { endpoint: "e" } : null) },
      unregister: async () => {
        unregistered.push(name);
        return true;
      },
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => [registration("plain", false), registration("pushing", true)],
      },
    });
    vi.stubGlobal("caches", { delete: async () => true });
    await stopOfflineCopy();
    expect(unregistered).toEqual(["plain"]);
  });
});
