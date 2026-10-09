import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { say } from "@/app/profile/availability-form";
import { savedText } from "@/app/profile/notification-form";
import { ProfileView, ukMobile } from "@/app/profile/profile-view";
import { NOTIFY_CHANNELS } from "@/lib/db/schema/people";
import type { Profile } from "@/lib/portal/profile";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/portal/profile-kinds";
import { EVERY_STATUS } from "../helpers/qualifications";

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
  qualifications: [],
  rightToWork: { checked: false, checkedOn: null },
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

  it("shows each qualification's status, date line and what it means; red when it stops her (12F.1)", () => {
    const html = render(profile({ qualifications: EVERY_STATUS }));
    const page = text(html);
    expect(page).toContain("Qualifications");
    expect(page).toContain(
      "SIA close protection licence Suspended · Suspended You can't take close protection officer shifts. Contact the office.",
    );
    expect(page).toContain(
      "First aid at work certificate Expired · Expired 1 Oct Until it's renewed you won't see response team lead shifts. Send the new details to the office.",
    );
    expect(page).toContain(
      "CSAS accreditation Missing · Needed for CSAS officer shifts You won't see CSAS officer shifts until the office has it.",
    );
    expect(page).toContain(
      "SIA door supervisor licence Expiring soon · Expires 20 Nov Renew it before then to keep getting door supervisor shifts. Send the new details to the office.",
    );
    expect(page).toContain(
      "SIA security guard licence Applied for · Applied for, not issued yet Send it to the office when it arrives.",
    );
    expect(page).toContain("Level 2 spectator safety qualification Valid · No expiry date");
    // Only the expired and suspended ones are red. Never "credential" (staff-facing words).
    expect(html.match(/border-l-4 border-urgent bg-urgent-soft/g)).toHaveLength(2);
    expect(page.toLowerCase()).not.toContain("credential");
  });

  it("a valid one with a date says until when; a different year shows the year", () => {
    const page = text(
      render(
        profile({
          qualifications: [
            {
              type: "SIA_DS",
              name: "SIA door supervisor licence",
              status: "valid",
              expiresOn: "2029-01-01",
              neededFor: ["door_supervisor"],
            },
          ],
        }),
      ),
    );
    expect(page).toContain("SIA door supervisor licence Valid · Valid until 1 Jan 2029");
  });

  it("right to work: a status only, never 'you can't be booked'", () => {
    expect(text(render(profile()))).toContain("Right to work Not checked yet: ask the office");
    expect(
      text(render(profile({ rightToWork: { checked: true, checkedOn: "2026-01-12" } }))),
    ).toContain("Right to work Checked by the office on 12 Jan");
    expect(
      text(render(profile({ rightToWork: { checked: true, checkedOn: "2025-01-12" } }))),
    ).toContain("Checked by the office on 12 Jan 2025");
    expect(text(render(profile()))).not.toMatch(/can't be booked/);
  });

  it("says when her roles need no qualifications", () => {
    expect(text(render(profile()))).toContain("Your roles don't need any.");
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
