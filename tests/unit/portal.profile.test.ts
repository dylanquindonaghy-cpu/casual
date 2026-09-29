import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { say } from "@/app/profile/availability-form";
import { savedText } from "@/app/profile/notification-form";
import { ProfileView, ukMobile } from "@/app/profile/profile-view";
import { NOTIFY_CHANNELS } from "@/lib/db/schema/people";
import type { Profile } from "@/lib/portal/profile";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/portal/profile-kinds";

// The profile page (docs/screens.md, `/profile`): what the worker sees about themselves, and the
// answer to each change in plain words.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const profile = (over: Partial<Profile> = {}): Profile => ({
  firstName: "Sam",
  lastName: "Booker",
  mobile: "+447700900123",
  email: null,
  notifyChannel: "whatsapp",
  offerAlerts: true,
  textsOff: false,
  credentials: [],
  unavailable: [],
  today: "2026-11-02",
  ...over,
});
const render = (p: Profile) =>
  renderToStaticMarkup(
    createElement(ProfileView, { profile: p, signOff: "Acme Events Shift Team" }),
  );

describe("the notification choices", () => {
  it("match the database's", () => {
    expect([...CHANNELS]).toEqual([...NOTIFY_CHANNELS]);
    expect(Object.keys(CHANNEL_LABELS)).toEqual([...CHANNELS]);
  });
});

describe("ProfileView", () => {
  it("shows the contact details read-only, with who changes them", () => {
    const page = text(render(profile({ email: "sam.booker@example.com" })));
    expect(page).toContain("Sam Booker");
    expect(page).toContain("Mobile: 07700 900123");
    expect(page).toContain("Email: sam.booker@example.com");
    expect(page).toContain("To change these, ask the office.");
    expect(text(render(profile()))).toContain("Email: none");
    expect(ukMobile("+447700900123")).toBe("07700 900123");
    expect(ukMobile("+353861234567")).toBe("+353861234567");
  });

  it("shows each credential's status and expiry; an expired one in red, with what to do", () => {
    const html = render(
      profile({
        credentials: [
          {
            type: "SIA_DS",
            name: "SIA door supervisor licence",
            status: "valid",
            expiresOn: "2029-01-01",
            expired: false,
          },
          {
            type: "FIRST_AID",
            name: "first aid at work certificate",
            status: "valid",
            expiresOn: "2026-11-01",
            expired: true,
          },
          {
            type: "STEWARD_L2",
            name: "Level 2 spectator safety qualification",
            status: "valid",
            expiresOn: null,
            expired: false,
          },
          {
            type: "SIA_SG",
            name: "SIA security guard licence",
            status: "applied",
            expiresOn: null,
            expired: false,
          },
          {
            type: "SIA_CP",
            name: "SIA close protection licence",
            status: "suspended",
            expiresOn: "2028-01-01",
            expired: false,
          },
        ],
      }),
    );
    const page = text(html);
    expect(page).toContain("SIA door supervisor licence Valid · expires 1 Jan 2029");
    expect(page).toContain("First aid at work certificate Expired · expired 1 Nov");
    expect(page).toContain(
      "You can't take shifts that need it. Renew it and send the new details to the office.",
    );
    expect(page).toContain("Level 2 spectator safety qualification Valid · no expiry date");
    expect(page).toContain("SIA security guard licence Applied for");
    expect(page).toContain(
      "SIA close protection licence Suspended · expires 1 Jan 2028 You can't take shifts that need it. Contact the office.",
    );
    // Only the expired and suspended ones are red, and each says what to do.
    expect(html.match(/border-red-700/g)).toHaveLength(2);
    expect(page.match(/Renew it/g)).toHaveLength(1);
    expect(page.match(/Contact the office/g)).toHaveLength(1);
  });

  it("says when there are no credentials on file", () => {
    expect(text(render(profile()))).toContain(
      "None on file. Send yours to the office to be checked.",
    );
  });

  it("lists marked days with Remove, warns about a booked one, and limits the date picker", () => {
    const html = render(
      profile({
        unavailable: [
          { day: "2026-11-04", booked: true },
          { day: "2026-11-07", booked: false },
        ],
      }),
    );
    const page = text(html);
    expect(page).toContain("Days you can't work");
    expect(page).toContain(
      "Wed 4 Nov You're booked that day. Marking it doesn't cancel that shift.",
    );
    expect(page).toContain("Sat 7 Nov Remove");
    expect(page.match(/Remove/g)).toHaveLength(2);
    // Each Remove button is named for its day (a screen reader hears which).
    expect(html).toContain('aria-label="Remove Wed 4 Nov"');
    expect(html).toContain('aria-label="Remove Sat 7 Nov"');
    expect(page.match(/You're booked that day/g)).toHaveLength(1);
    expect(page).toContain("Mark as unavailable");
    expect(html).toMatch(/type="date"[^>]*min="2026-11-02"[^>]*max="2027-05-01"/);
    expect(text(render(profile()))).toContain("No days marked.");
  });

  it("says when texts are off (they replied STOP), and how to turn them back on", () => {
    expect(text(render(profile()))).not.toContain("Texts are off");
    expect(text(render(profile({ notifyChannel: "sms", textsOff: true })))).toContain(
      "Texts are off: you replied STOP to one of our texts. We'll send shift messages by WhatsApp. To turn texts back on, text START to our number.",
    );
  });

  it("shows the notification settings as saved", () => {
    const html = render(profile({ notifyChannel: "sms", offerAlerts: false }));
    const page = text(html);
    expect(page).toContain("Send shift messages by WhatsApp Text message");
    expect(page).toContain("Tell me about open shifts");
    expect(page).toContain("Save settings");
    // Each input's tag on its own, whatever order React writes the attributes in.
    const input = (h: string, match: string) =>
      (h.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(match)) ?? "";
    expect(input(html, 'value="sms"')).toContain('checked=""');
    expect(input(html, 'value="whatsapp"')).not.toContain('checked=""');
    expect(input(html, 'type="checkbox"')).not.toContain('checked=""');
    const defaults = render(profile());
    expect(input(defaults, 'value="whatsapp"')).toContain('checked=""');
    expect(input(defaults, 'type="checkbox"')).toContain('checked=""');
  });
});

describe("the answer to saving the settings", () => {
  it("says what was saved", () => {
    expect(savedText("sms", false)).toBe(
      "Saved. We'll send shift messages by text message. We won't tell you about open shifts.",
    );
    expect(savedText("whatsapp", true)).toBe(
      "Saved. We'll send shift messages by WhatsApp. We'll tell you about open shifts.",
    );
  });

  it("choosing texts while they're off (replied STOP) says what will really happen", () => {
    expect(savedText("sms", true, true)).toBe(
      "Saved. Texts are off, so we'll send shift messages by WhatsApp until you text START. We'll tell you about open shifts.",
    );
    expect(savedText("whatsapp", false, true)).toBe(
      "Saved. We'll send shift messages by WhatsApp. We won't tell you about open shifts.",
    );
  });
});

describe("the answer to marking a day", () => {
  it("confirms each change, and says when a booking falls on the day", () => {
    expect(say({ status: "added", day: "2026-11-04", bookedThatDay: false })).toEqual({
      text: "Marked Wed 4 Nov as unavailable.",
      alert: false,
    });
    expect(say({ status: "added", day: "2026-11-04", bookedThatDay: true }).text).toBe(
      "Marked Wed 4 Nov as unavailable. You're booked that day: marking it doesn't cancel that shift. Cancel it on My shifts if you can't work it.",
    );
    expect(say({ status: "removed", day: "2026-11-04" }).text).toBe(
      "Wed 4 Nov is available again.",
    );
  });

  it("says what to do when it can't", () => {
    expect(say({ status: "past" })).toEqual({
      text: "Choose today or a day after it.",
      alert: true,
    });
    expect(say({ status: "too_far" }).text).toBe("Choose a day in the next 6 months.");
    expect(say({ status: "too_many" }).text).toBe("You can mark up to 60 days. Remove one first.");
    expect(say({ status: "error" }).text).toBe("Something went wrong. Try again.");
    expect(say({ status: "already" }).alert).toBe(false);
  });
});
