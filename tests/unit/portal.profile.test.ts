import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { say } from "@/app/profile/availability-form";
import { savedText } from "@/app/profile/notification-form";
import { ProfileView, ukMobile } from "@/app/profile/profile-view";
import { NOTIFY_CHANNELS } from "@/lib/db/schema/people";
import type { Profile } from "@/lib/portal/profile";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/portal/profile-kinds";
import { EVERY_STATUS, qual } from "../helpers/qualifications";

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
  rightToWork: { checked: false, checkedOn: null, expired: false },
  rolesWithoutRule: [],
  photo: { status: "missing", current: null, waiting: null },
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
    // docs/office-v2.md 4.6's words (12H.3; "To change these" before).
    expect(page).toContain("To change your name or number, ask the office.");
    expect(text(render(profile()))).toContain("Email: none");
    expect(ukMobile("+447700900123")).toBe("07700 900123");
    expect(ukMobile("+353861234567")).toBe("+353861234567");
  });

  it("shows each qualification's status, date line and what it means; red when it stops her (12F.1)", () => {
    const html = render(profile({ qualifications: EVERY_STATUS }));
    const page = text(html);
    expect(page).toContain("Qualifications");
    expect(page).toContain(
      "SIA close protection licence Suspended You can't take close protection officer shifts. Contact the office.",
    );
    expect(page).toContain(
      "First aid at work certificate Expired · Expired 1 Oct Until it's renewed you won't see response team lead shifts. Upload the new one. Upload a certificate",
    );
    expect(page).toContain(
      "CSAS accreditation Missing · Needed for CSAS officer shifts You won't see CSAS officer shifts until the office has it.",
    );
    expect(page).toContain(
      "SIA door supervisor licence Expiring soon · Expires 20 Nov Renew it before then to keep getting door supervisor shifts. Upload the new one. Upload a certificate",
    );
    expect(page).toContain(
      "SIA security guard licence Applied for · Not issued yet You won't see security officer shifts until it's issued. Upload it when it arrives. Upload a certificate",
    );
    expect(page).toContain("Level 2 spectator safety qualification Valid · No expiry date");
    // Her uploads (12F.2): turned down, with why; waiting for the office.
    expect(page).toContain(
      "PTS card Not accepted: too blurry to read · Sent 30 Oct Upload a new one so you can take track worker shifts. Upload a certificate",
    );
    expect(page).toContain(
      "CSCS card Being checked · Sent 31 Oct The office will check it soon. Until then you won't see labourer shifts. Upload a certificate",
    );
    // "Upload a certificate" for each one she may upload: never CSAS (the office records it), never
    // a suspended one (an upload can't lift it).
    const uploads = [...html.matchAll(/href="\/profile\/upload\/([A-Z0-9_]+)"/g)].map((m) => m[1]);
    expect(uploads).toEqual(["FIRST_AID", "PTS", "CSCS", "SIA_DS", "SIA_SG", "STEWARD_L2"]);
    // The expired, suspended and not accepted ones are red. Never "credential" (staff-facing words).
    expect(html.match(/border-l-4 border-urgent bg-urgent-soft/g)).toHaveLength(3);
    expect(page.toLowerCase()).not.toContain("credential");
  });

  it("a valid one with a date says until when; a different year shows the year", () => {
    const page = text(
      render(
        profile({
          qualifications: [
            qual({
              type: "SIA_DS",
              name: "SIA door supervisor licence",
              status: "valid",
              expiresOn: "2029-01-01",
              neededFor: ["door_supervisor"],
              appliedCounts: false,
              renewing: false,
            }),
          ],
        }),
      ),
    );
    expect(page).toContain("SIA door supervisor licence Valid · Valid until 1 Jan 2029");
  });

  it("right to work: a status only, never 'you can't be booked'", () => {
    expect(text(render(profile()))).toContain("Right to work Not checked yet: ask the office");
    expect(
      text(
        render(
          profile({ rightToWork: { checked: true, checkedOn: "2026-01-12", expired: false } }),
        ),
      ),
    ).toContain("Right to work Checked by the office on 12 Jan");
    expect(
      text(
        render(
          profile({ rightToWork: { checked: true, checkedOn: "2025-01-12", expired: false } }),
        ),
      ),
    ).toContain("Checked by the office on 12 Jan 2025");
    expect(text(render(profile()))).not.toMatch(/can't be booked/);
  });

  it("says when her roles need no qualifications", () => {
    expect(text(render(profile()))).toContain("Your roles don't need any.");
  });

  it("an expired right-to-work check, an application the rules accept, renewing, and a role with no rule (review)", () => {
    expect(
      text(render(profile({ rightToWork: { checked: false, checkedOn: null, expired: true } }))),
    ).toContain("Right to work The office's check has run out: ask the office");
    const page = text(
      render(
        profile({
          rolesWithoutRule: ["response_team_lead"],
          qualifications: [
            qual({
              type: "SIA_DS",
              name: "SIA door supervisor licence",
              status: "applied",
              expiresOn: null,
              neededFor: ["door_supervisor"],
              appliedCounts: true,
              renewing: false,
            }),
            qual({
              type: "STEWARD_L2",
              name: "Level 2 spectator safety qualification",
              status: "expiring_soon",
              expiresOn: "2026-11-20",
              neededFor: ["steward"],
              appliedCounts: false,
              renewing: true,
            }),
          ],
        }),
      ),
    );
    expect(page).toContain(
      "Response team lead shifts aren't set up yet, so you can't take them. Ask the office.",
    );
    expect(page).toContain(
      "You may be offered some door supervisor shifts while you wait. Upload it when it arrives.",
    );
    expect(page).toContain("You've applied to renew it. Upload the new one when it arrives.");
    expect(page).not.toContain("Your roles don't need any.");
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
      "Marked Wed 4 Nov as unavailable. You're booked that day: marking it doesn't cancel that shift. Cancel it under Shifts if you can't work it.",
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

describe("ProfileView: the staff photo (12F.2)", () => {
  const photo = {
    status: "waiting" as const,
    current: {
      id: "7c1d2e3f-0000-4000-8000-0000000000aa",
      uploadedOn: "2024-08-03",
      renewBy: "2027-08-03",
    },
    waiting: { id: "7c1d2e3f-0000-4000-8000-0000000000ab", uploadedOn: "2026-10-30" },
  };

  it("the current photo (72px, its alt text), its dates and status, and the one waiting", () => {
    const html = render(profile({ photo: { ...photo, status: "up_to_date", waiting: null } }));
    const page = text(html);
    expect(page).toContain("Staff photo");
    expect(html).toMatch(
      /<img src="\/files\/7c1d2e3f-0000-4000-8000-0000000000aa" alt="Staff photo of Sam Booker" width="72" height="72"/,
    );
    expect(page).toContain("Last uploaded 3 Aug 2024 · renew by 3 Aug 2027 Up to date");
    const waiting = text(render(profile({ photo })));
    expect(waiting).toContain("Waiting for the office to check");
    expect(waiting).toContain(
      "You sent a new one on 30 Oct. Until the office checks it, this one stays.",
    );
    // The waiting one is never shown as her photo.
    expect(render(profile({ photo }))).not.toContain("0000000000ab");
  });

  it("Upload a new photo: the front camera, with one line of the SIA's guidance", () => {
    const html = render(profile());
    const page = text(html);
    expect(page).toContain("No photo yet. Missing");
    expect(page).toContain(
      "Face the camera against a plain, light background, with nothing covering your face.",
    );
    expect(page).toContain("Upload a new photo");
    expect(html).toMatch(/<input type="file" accept="image\/\*" capture="user"/);
  });
});
