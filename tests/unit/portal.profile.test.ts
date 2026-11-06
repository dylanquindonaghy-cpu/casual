import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { say } from "@/app/profile/availability-form";
import { EmailText } from "@/app/profile/email-text";
import { NO_WAY_TEXT, NotificationForm, savedText } from "@/app/profile/notification-form";
import { officeLinkClass } from "@/app/profile/office-link";
import { ProfileView, textsOffText, ukMobile } from "@/app/profile/profile-view";
import { UploadForm } from "@/app/profile/upload-form";
import { OfficeRecordedNote } from "@/app/profile/upload/[type]/office-recorded";
import { NOTIFY_CHANNELS } from "@/lib/db/schema/people";
import { inHand } from "@/lib/portal/in-hand";
import type { Profile } from "@/lib/portal/profile";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/portal/profile-kinds";
import {
  chipTail,
  IN_HAND,
  meaning,
  MESSAGES_PATH,
  needsText,
  otherMeaning,
  otherShiftText,
  rightToWorkText,
} from "@/lib/portal/qualification-copy";
import { EVERY_STATUS, need, qual } from "../helpers/qualifications";

// The profile page (docs/screens.md, `/profile`): what the worker sees about themselves, and the
// answer to each change in plain words.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

// (28.11: an email address in pieces that break only after its @ or a dot, and a link inside a
// sentence, read as the words they are.)
const text = (html: string) =>
  html
    .replace(/<wbr\/>/g, "")
    .replace(/<span class="whitespace-nowrap">([^<]*)<\/span>/g, "$1")
    .replace(/<a [^>]*>([^<]*)<\/a>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const profile = (over: Partial<Profile> = {}): Profile => ({
  reliability: { kind: "new", counted: 0, counts: { worked: 0, noShows: 0, lateCancels: 0 } },
  firstName: "Sam",
  lastName: "Booker",
  mobile: "+447700900123",
  email: null,
  notifyChannel: "sms",
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
      "SIA close protection licence Suspended You can't take close protection officer shifts. Message the office.",
    );
    expect(page).toContain(
      "First aid at work certificate Expired · Expired 1 Oct Until it's renewed you won't see response team lead shifts. Upload the new one. Upload a new one",
    );
    expect(page).toContain(
      "CSAS accreditation Missing · Needed for CSAS officer shifts You won't see CSAS officer shifts until the office has it.",
    );
    expect(page).toContain(
      "SIA door supervisor licence Expiring soon · Expires 20 Nov Renew it before then to keep getting door supervisor shifts. Upload the new one. Upload a new one",
    );
    expect(page).toContain(
      "SIA security guard licence Applied for · Not issued yet You won't see security officer shifts until it's issued. Upload it when it arrives. Upload a new one",
    );
    expect(page).toContain("Level 2 spectator safety qualification Valid · No expiry date");
    // Her uploads (12F.2): turned down, with why; waiting for the office.
    expect(page).toContain(
      "PTS card Not accepted: too blurry to read · Sent 30 Oct Upload a new one so you can take track worker shifts. Upload a new one",
    );
    expect(page).toContain(
      "CSCS card Being checked · Sent 31 Oct The office will check it soon. Until then you won't see labourer shifts. Upload a new one",
    );
    // "Upload a new one" for each one she may upload: never CSAS (the office records it), never
    // a suspended one (an upload can't lift it).
    const uploads = [...html.matchAll(/href="\/profile\/upload\/([A-Z0-9_]+)"/g)].map((m) => m[1]);
    expect(uploads).toEqual(["FIRST_AID", "PTS", "CSCS", "SIA_DS", "SIA_SG", "STEWARD_L2"]);
    // The expired, suspended and not accepted ones are red. Never "credential" (staff-facing words).
    expect(html.match(/border-l-4 border-urgent bg-urgent-soft/g)).toHaveLength(3);
    expect(page.toLowerCase()).not.toContain("credential");
  });

  it("a valid one with a date says until when, straight after its chip; a different year shows the year", () => {
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
    expect(page).toContain("SIA door supervisor licence Valid until 1 Jan 2029");
    expect(page).not.toContain("Valid · ");
  });

  it("right to work: a status only, never 'you can't be booked'", () => {
    expect(text(render(profile()))).toContain(
      "Right to work Not recorded yet. The office will ask you for your documents if they need them.",
    );
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
    // Where the firm has phone notifications (its key; 28.11: else nothing says they'd come).
    const withPush = (p: Profile) =>
      renderToStaticMarkup(
        createElement(ProfileView, {
          profile: p,
          signOff: "Acme Events Shift Team",
          push: { publicKey: "k".repeat(87), firmName: "Acme Events" },
        }),
      );
    expect(text(withPush(profile({ notifyChannel: "sms", textsOff: true })))).toContain(
      "Texts are off: you replied STOP to one of our texts. We can only reach you by notifications on your phone. To turn texts back on, text START to our number.",
    );
    // With an address held: by email (Phase 26.9; WhatsApp until then).
    expect(
      text(render(profile({ notifyChannel: "sms", textsOff: true, email: "sam@example.test" }))),
    ).toContain(
      "Texts are off: you replied STOP to one of our texts. We'll email shift messages to sam@example.test. To turn texts back on, text START to our number.",
    );
    // Their own login way isn't a text after STOP ("off" here), but texts exist: the note and the
    // choice still show (the page passes the text sender itself).
    const stopped = text(
      renderToStaticMarkup(
        createElement(ProfileView, {
          profile: profile({ notifyChannel: "sms", textsOff: true }),
          signOff: "Acme Events Shift Team",
          loginWay: "off",
          textSender: true,
        }),
      ),
    );
    expect(stopped).toContain("Texts are off: you replied STOP to one of our texts.");
    expect(stopped).toContain("If we can't reach this phone, send my messages by");
  });

  // Phase 26.9 (off-4): a text or an email, the email only while the firm holds their address;
  // never WhatsApp.
  it("shows the notification settings as saved", () => {
    const email = "sam@example.test";
    const html = render(profile({ notifyChannel: "email", offerAlerts: false, email }));
    const page = text(html);
    expect(page).toContain(
      "If we can't reach this phone, send my messages by Text message Email sam@example.test",
    );
    expect(page).not.toContain("WhatsApp");
    expect(page).toContain("Tell me about open shifts");
    expect(page).toContain("Save settings");
    // Each input's tag on its own, whatever order React writes the attributes in.
    const input = (h: string, match: string) =>
      (h.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(match)) ?? "";
    expect(input(html, 'value="email"')).toContain('checked=""');
    expect(input(html, 'value="sms"')).not.toContain('checked=""');
    expect(input(html, 'type="checkbox"')).not.toContain('checked=""');
    // The default: texts. No address held: no email to choose, and how to get one.
    const defaults = render(profile());
    expect(input(defaults, 'value="sms"')).toContain('checked=""');
    expect(input(defaults, 'value="email"')).toBe("");
    expect(text(defaults)).toContain(
      "To get them by email instead, ask the office to add your email address.",
    );
    expect(input(defaults, 'type="checkbox"')).toContain('checked=""');
  });
});

describe("the answer to saving the settings", () => {
  it("says what was saved", () => {
    expect(savedText("sms", false)).toBe(
      "Saved. We'll send shift messages by text. We won't tell you about open shifts.",
    );
    expect(savedText("email", true)).toBe(
      "Saved. We'll send shift messages by email. We'll tell you about open shifts.",
    );
  });

  it("choosing texts while they're off (replied STOP) says what will really happen", () => {
    expect(savedText("sms", true, true, true, "sam@example.test")).toBe(
      "Saved. Texts are off, so we'll email shift messages until you text START. We'll tell you about open shifts.",
    );
    expect(savedText("sms", true, true)).toBe(
      "Saved. Texts are off, so we can only reach you by notifications on your phone until you text START. We'll tell you about open shifts.",
    );
    expect(savedText("email", false, true)).toBe(
      "Saved. We'll send shift messages by email. We won't tell you about open shifts.",
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

// Their own reliability (Phase 26.7, cas-6; the claims-auditor's round 1): the figure and counts
// the office sees, with the line that it doesn't change which shifts they're offered.
describe("ProfileView: Your reliability", () => {
  it("a figure over the last 90 days, with the counts and what it's for", () => {
    const page = text(
      render(
        profile({
          reliability: {
            kind: "figure",
            percent: 83,
            band: "amber",
            counts: { worked: 5, noShows: 1, lateCancels: 0 },
          },
        }),
      ),
    );
    expect(page).toContain("Your reliability");
    expect(page).toContain("83% over the last 90 days");
    expect(page).toContain("5 shifts worked · 1 no-show · 0 late cancellations");
    expect(page).toContain(
      "Shifts you worked, out of those plus no-shows and cancellations with under 48 hours' notice. The office sees the same figure. It doesn't change which shifts you're offered.",
    );
  });

  it("new: no score yet, when they get one, and the counts so far", () => {
    const page = text(
      render(
        profile({
          reliability: {
            kind: "new",
            counted: 2,
            counts: { worked: 1, noShows: 0, lateCancels: 1 },
          },
        }),
      ),
    );
    expect(page).toContain("Your reliability");
    expect(page).toContain("You're new, so there's no score yet. You'll get one after 5 shifts.");
    expect(page).not.toContain("New: 2 shifts so far");
    expect(page).toContain("1 shift worked · 0 no-shows · 1 late cancellation");
    expect(page).toContain("It doesn't change which shifts you're offered.");
  });
});

// Phase 27.2 (the launch review's words, approved by Dylan, 2026-11-03).
describe("qualification words (Phase 27.2)", () => {
  it("a valid one's date follows its chip as one phrase; any other date line after a dot", () => {
    expect(chipTail(qual({ status: "valid", expiresOn: "2028-03-27" }), 2026)).toBe(
      " until 27 Mar 2028",
    );
    expect(chipTail(qual({ status: "valid", expiresOn: null }), 2026)).toBe(" · No expiry date");
    expect(chipTail(qual({ status: "expiring_soon", expiresOn: "2026-11-20" }), 2026)).toBe(
      " · Expires 20 Nov",
    );
    expect(chipTail(qual({ status: "suspended", expiresOn: null }), 2026)).toBe("");
  });

  it("right to work: her words, and the office's own (O9)", () => {
    const none = { checked: false, checkedOn: null, expired: false };
    const lapsed = { checked: false, checkedOn: null, expired: true };
    expect(rightToWorkText(none, 2026)).toBe(
      "Not recorded yet. The office will ask you for your documents if they need them.",
    );
    expect(rightToWorkText(lapsed, 2026)).toBe("The office's check has run out: ask the office");
    expect(rightToWorkText(none, 2026, "office")).toBe("not checked yet");
    expect(rightToWorkText(lapsed, 2026, "office")).toBe("check has run out");
    // Checked reads the same for both.
    const checked = { checked: true, checkedOn: "2026-01-12", expired: false };
    expect(rightToWorkText(checked, 2026, "office")).toBe(rightToWorkText(checked, 2026));
  });

  it("one the office records itself: renewed, tell the office under Messages (C5)", () => {
    const csas = {
      type: "CSAS",
      name: "CSAS accreditation",
      neededFor: ["csas_officer"],
      uploadable: false,
    };
    expect(meaning(qual({ ...csas, status: "expired", expiresOn: "2026-10-01" }))).toBe(
      "Until it's renewed you won't see CSAS officer shifts. Once you've renewed it, tell the office under Messages.",
    );
    expect(meaning(qual({ ...csas, status: "expiring_soon", expiresOn: "2026-11-20" }))).toBe(
      "Renew it before then to keep getting CSAS officer shifts. Once you've renewed it, tell the office under Messages.",
    );
    expect(
      meaning(qual({ ...csas, status: "expiring_soon", expiresOn: "2026-11-20", renewing: true })),
    ).toBe("You've applied to renew it. When it arrives, tell the office under Messages.");
    expect(meaning(qual({ ...csas, status: "applied", expiresOn: null }))).toBe(
      "You won't see CSAS officer shifts until it's issued. When it arrives, tell the office under Messages.",
    );
    // One she may upload: as before.
    expect(meaning(qual({ status: "expired", expiresOn: "2026-10-01" }))).toBe(
      "Until it's renewed you won't see door supervisor shifts. Upload the new one.",
    );
  });

  it("other qualifications on file: the shift that needs it, and what to do (C5)", () => {
    expect(otherShiftText({ role: "steward", day: "2026-11-07", booked: true })).toBe(
      "Your steward shift on Sat 7 Nov needs it.",
    );
    expect(otherShiftText({ role: "csas_officer", day: "2026-11-07", booked: false })).toBe(
      "The CSAS officer shift you're offered on Sat 7 Nov needs it.",
    );
    const aid = { type: "FIRST_AID", name: "first aid at work certificate", neededFor: [] };
    expect(otherMeaning(qual({ ...aid, status: "valid" }))).toBeNull();
    expect(otherMeaning(qual({ ...aid, status: "expiring_soon", expiresOn: "2026-11-20" }))).toBe(
      "Renew it before then to keep taking shifts that need it. Once you've renewed it, tell the office under Messages.",
    );
    expect(otherMeaning(qual({ ...aid, status: "expired", expiresOn: "2026-10-01" }))).toBe(
      "You can't take shifts that need it until it's renewed. Once you've renewed it, tell the office under Messages.",
    );
    expect(otherMeaning(qual({ ...aid, status: "applied", expiresOn: null }))).toBe(
      "When it arrives, tell the office under Messages.",
    );
    expect(otherMeaning(qual({ ...aid, status: "suspended", expiresOn: null }))).toBe(
      "You can't take shifts that need it. Message the office.",
    );
  });

  it("Profile lists them under Other qualifications on file, with no upload link", () => {
    const html = render(
      profile({
        qualifications: [qual({})],
        others: [
          {
            ...qual({
              type: "FIRST_AID",
              name: "first aid at work certificate",
              status: "expiring_soon",
              expiresOn: "2026-11-20",
              neededFor: [],
              uploadable: false,
            }),
            shift: { role: "steward", day: "2026-11-07", booked: true },
          },
          {
            ...qual({
              type: "CSAS",
              name: "CSAS accreditation",
              status: "expired",
              expiresOn: "2026-10-01",
              neededFor: [],
              uploadable: false,
            }),
            shift: { role: "steward", day: "2026-11-09", booked: false },
          },
        ],
      }),
    );
    const page = text(html);
    expect(page).toContain(
      "SIA door supervisor licence Valid until 1 Jan 2029 Upload a new one Other qualifications on file First aid at work certificate Expiring soon · Expires 20 Nov Your steward shift on Sat 7 Nov needs it. Renew it before then to keep taking shifts that need it. Once you've renewed it, tell the office under Messages.",
    );
    expect(page).toContain(
      "CSAS accreditation Expired · Expired 1 Oct The steward shift you're offered on Mon 9 Nov needs it. You can't take shifts that need it until it's renewed. Once you've renewed it, tell the office under Messages. Right to work",
    );
    expect(html).toContain('<h3 id="other-qualifications-heading"');
    expect(html).toContain('aria-labelledby="other-qualifications-heading"');
    // Her upload page takes only what her roles need: no link for these.
    expect([...html.matchAll(/href="\/profile\/upload\/([A-Z0-9_]+)"/g)].map((m) => m[1])).toEqual([
      "SIA_DS",
    ]);
    // The expired one is red, like her main list's.
    expect(html.match(/border-l-4 border-urgent bg-urgent-soft/g)).toHaveLength(1);
    // None: no heading.
    expect(text(render(profile({ others: [] })))).not.toContain("Other qualifications on file");
    expect(text(render(profile()))).not.toContain("Other qualifications on file");
  });

  it("the days she can't work: how many, how far ahead", () => {
    expect(text(render(profile()))).toContain(
      "We won't offer you shifts on these days. You can mark up to 60 days, up to 6 months ahead.",
    );
  });
});

// Phase 28, 28.11 (docs/screens.md "### 28.11"): Profile shorter and clearer, her own numbers, "The
// office has this in hand.", the photo seen before it's sent, and no "contact the office" dead end.
describe("Profile, shorter and clearer (28.11)", () => {
  const renderWith = (p: Profile, o: Partial<Parameters<typeof ProfileView>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ProfileView, { profile: p, signOff: "Acme Events Shift Team", ...o }),
    );
  const links = (html: string, words: string) =>
    [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)]
      .filter((m) => m[2]?.toLowerCase() === words.toLowerCase())
      .map((m) => m[1]);

  it("My requests and Help are the first things under her name, Log out still last", () => {
    const html = renderWith(profile({ email: "sam@example.test" }));
    const page = text(html);
    expect(page.indexOf("My requests")).toBeLessThan(page.indexOf("Your details"));
    expect(page.indexOf("Help")).toBeLessThan(page.indexOf("Your details"));
    expect(page).toContain(
      "My requests What you've asked the office, and their answers Your shift record Every offer, booking, change and cancellation, with the notice you had Help How booking, cancelling and pay work Your details",
    );
    // Her shift record (28.4), a row here since 28.13.
    expect(html).toMatch(/<a [^>]*href="\/shifts\/record"/);
    expect(html).toMatch(/<a [^>]*href="\/requests"/);
    expect(html).toMatch(/<a [^>]*href="\/help"/);
    expect(page.trim().endsWith("Log out")).toBe(true);
    // New answers from the office: the count beside it, and in words under it.
    expect(text(renderWith(profile(), { answersCount: 2 }))).toContain(
      "My requests 2 2 new answers from the office",
    );
    expect(text(renderWith(profile(), { answersCount: 1 }))).toContain(
      "1 new answer from the office",
    );
  });

  it("travel, days off and how we reach her fold (no JavaScript needed), each saying how it stands", () => {
    const html = renderWith(
      profile({ unavailable: [{ day: "2026-11-04", booked: false }], offerAlerts: false }),
      { travel: { set: true, postcode: "ZZ1 1AA", modes: "car", maxMinutes: 45 } },
    );
    const folds = [...html.matchAll(/<details([^>]*)data-fold="([a-z-]+)"/g)].map((m) => ({
      id: m[2],
      open: (m[1] ?? "").includes("open"),
    }));
    expect(folds).toEqual([
      { id: "travel-heading", open: false },
      { id: "days-heading", open: false },
      { id: "notify-heading", open: false },
    ]);
    const page = text(html);
    expect(page).toContain("Your travel area From ZZ1 1AA · up to 45 minutes by car");
    expect(page).toContain("Days you can't work 1 day marked");
    expect(page).toContain("How we reach you Open-shift alerts off");
    // Each heading sits in its fold's summary: the section keeps its name from it.
    for (const id of ["travel-heading", "days-heading", "notify-heading"]) {
      expect(html).toContain(`aria-labelledby="${id}"`);
      expect(html).toMatch(new RegExp(`<summary[^>]*><span[^>]*><h2 id="${id}"`));
    }
    expect(text(renderWith(profile()))).toContain("Days you can't work No days marked");
    const two = profile({
      unavailable: [
        { day: "2026-11-04", booked: false },
        { day: "2026-11-05", booked: false },
      ],
    });
    expect(text(renderWith(two))).toContain("2 days marked");
    // The qualifications and the photo stay open: never inside a fold.
    const before = html.slice(0, html.indexOf("<details"));
    expect(before).toContain('id="photo-heading"');
    expect(before).toContain('id="qualifications-heading"');
  });

  it("How we reach you opens by itself when texts are off, so the STOP note shows", () => {
    const html = renderWith(profile({ textsOff: true }));
    expect(html).toMatch(/<details open="" data-fold="notify-heading"/);
    expect(text(html)).toContain("Texts are off: you replied STOP to one of our texts.");
  });

  it("with the firm's phone notifications off, there's no 'Notifications on this phone' at all", () => {
    const off = text(renderWith(profile(), { push: { publicKey: null, firmName: "Acme Events" } }));
    expect(off).not.toContain("Notifications on this phone");
    expect(off).not.toContain("doesn't use phone notifications");
    // ...and nothing says notifications would come instead.
    expect(textsOffText(null, false)).toBe(
      "Texts are off: you replied STOP to one of our texts. We have no other way to send you shift messages. To turn texts back on, text START to our number.",
    );
    expect(savedText("sms", true, true, true, null, false)).toBe(
      "Saved. Texts are off, so we can't send you shift messages until you text START. We'll tell you about open shifts.",
    );
    const form = (email: string | null) =>
      text(
        renderToStaticMarkup(
          createElement(NotificationForm, {
            channel: "sms",
            offerAlerts: true,
            textsOff: false,
            loginWay: "email",
            textSender: false,
            push: false,
            email,
            signOff: "Acme Events Shift Team",
          }),
        ),
      );
    expect(form("sam@example.test")).toContain("We email shift messages to: sam@example.test");
    expect(form("sam@example.test")).not.toContain("notifications on this phone");
    expect(form(null)).toContain(NO_WAY_TEXT);
    expect(NO_WAY_TEXT).toBe(
      "We have no email address for you, so we can't send you shift messages. To add one, message the office.",
    );
  });

  it("her email address sits on its own line and breaks only after its @ or a dot", () => {
    const html = renderToStaticMarkup(
      createElement(EmailText, { email: "sam.long-name@acme-staffing.co.test" }),
    );
    expect(html).toBe(
      '<span data-email=""><span class="whitespace-nowrap">sam.</span><wbr/><span class="whitespace-nowrap">long-name@</span><wbr/><span class="whitespace-nowrap">acme-staffing.</span><wbr/><span class="whitespace-nowrap">co.</span><wbr/><span class="whitespace-nowrap">test</span></span>',
    );
    // In How we reach you: "Email", then the address on a line of its own (no brackets, no
    // break-all).
    const form = renderWith(profile({ email: "sam@example.test" }));
    expect(form).toMatch(/Email<span data-email="" class="block[^"]*">/);
    expect(form).not.toContain("break-all");
  });

  it("the reliability line says 'the office', like every other line", () => {
    const page = text(renderWith(profile()));
    expect(page).toContain("The office sees the same figure.");
    expect(page).not.toContain("Our office");
  });

  it("each she may upload shows her own record's number, with how to fix a typo; never one the office records", () => {
    const html = renderWith(
      profile({
        qualifications: [
          qual({ type: "SIA_DS", number: "1012 3456 7890 1234" }),
          qual({
            type: "CSAS",
            name: "CSAS accreditation",
            neededFor: ["csas_officer"],
            uploadable: false,
            number: "CSAS-77",
          }),
          qual({
            type: "STEWARD_L2",
            name: "Level 2 spectator safety qualification",
            number: null,
          }),
        ],
      }),
    );
    const page = text(html);
    expect(page).toContain(
      "SIA door supervisor licence Valid until 1 Jan 2029 Number: 1012 3456 7890 1234 If it's wrong, message the office. Upload a new one",
    );
    expect(page).not.toContain("CSAS-77");
    expect(page.match(/Number: /g)).toHaveLength(1);
    expect(links(html, "message the office")).toEqual([MESSAGES_PATH]);
  });

  it("one the office has in hand says so in place of what to upload, and still says what it stops", () => {
    const expired = text(
      renderWith(
        profile({
          qualifications: [
            { ...qual({ status: "expired", expiresOn: "2026-10-01" }), inHand: true },
          ],
        }),
      ),
    );
    expect(expired).toContain(
      "Expired · Expired 1 Oct Until it's renewed you won't see door supervisor shifts. The office has this in hand.",
    );
    expect(expired).not.toContain("Upload a new one");
    expect(expired).not.toContain("Upload the new one");
    const shown = (q: Parameters<typeof qual>[0]) => meaning({ ...qual(q), inHand: true });
    expect(shown({ status: "expiring_soon", expiresOn: "2026-11-20" })).toBe(IN_HAND);
    expect(shown({ status: "missing", expiresOn: null })).toBe(
      "You won't see door supervisor shifts until it's on your record. The office has this in hand.",
    );
    expect(shown({ status: "suspended", expiresOn: null })).toBe(
      "You can't take door supervisor shifts. The office has this in hand.",
    );
    expect(shown({ status: "applied", expiresOn: null })).toBe(
      "You won't see door supervisor shifts until it's issued. The office has this in hand.",
    );
    // Not in hand: as before.
    expect(meaning(qual({ status: "expired", expiresOn: "2026-10-01" }))).toBe(
      "Until it's renewed you won't see door supervisor shifts. Upload the new one.",
    );
  });

  it("in hand: only the office's latest mark, about this very need, still standing", () => {
    const expired = qual({ type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" });
    const mark = { type: "SIA_DS", status: "expired", day: "2026-10-20" };
    expect(inHand(expired, mark)).toBe(true);
    expect(inHand(expired, null)).toBe(false);
    expect(inHand(expired, { ...mark, type: "STEWARD_L2" })).toBe(false);
    expect(inHand(expired, { ...mark, status: "expiring_soon" })).toBe(false);
    // Marked before this lapse began: about an earlier one, so not this.
    expect(inHand(expired, { ...mark, day: "2026-10-01" })).toBe(false);
    expect(inHand(expired, { ...mark, day: "2026-10-02" })).toBe(true);
    // Expiring soon: from 30 days before; not once a renewal is on its way.
    const soon = qual({ status: "expiring_soon", expiresOn: "2026-11-20" });
    const soonMark = { type: "SIA_DS", status: "expiring_soon", day: "2026-10-21" };
    expect(inHand(soon, soonMark)).toBe(true);
    expect(inHand(soon, { ...soonMark, day: "2026-10-20" })).toBe(false);
    expect(inHand({ ...soon, renewing: true }, soonMark)).toBe(false);
    // Not accepted: marked after the upload it turned down was sent.
    const turned = qual({
      status: "rejected",
      expiresOn: null,
      rejected: { uploadId: "u", sentOn: "2026-10-30", reason: "blurry" },
    });
    expect(inHand(turned, { type: "SIA_DS", status: "rejected", day: "2026-10-31" })).toBe(true);
    expect(inHand(turned, { type: "SIA_DS", status: "rejected", day: "2026-10-29" })).toBe(false);
    // Nothing to do for her: never "in hand".
    expect(inHand(qual({}), { type: "SIA_DS", status: "valid", day: "2026-10-20" })).toBe(false);
    expect(
      inHand(qual({ status: "being_checked", expiresOn: null }), {
        type: "SIA_DS",
        status: "being_checked",
        day: "2026-10-20",
      }),
    ).toBe(false);
  });

  it("in hand: never once anything about it changed after the mark, and with no date, only a mark known to stand unchanged", () => {
    // Suspended, marked sorted, the suspension lifted, then imposed again months later with no
    // mark in between: the same type and status, but a newer suspension, so not in hand.
    const suspended = qual({ type: "SIA_DS", status: "suspended", expiresOn: null });
    const mark = { type: "SIA_DS", status: "suspended", day: "2026-03-02" };
    expect(inHand(suspended, { ...mark, changedAfter: true })).toBe(false);
    expect(inHand(suspended, { ...mark, changedAfter: false })).toBe(true);
    // Not known whether it changed: nothing dates a suspension, so never in hand.
    expect(inHand(suspended, mark)).toBe(false);
    // The same for every status no date starts: missing, applied, expired with no date.
    for (const status of ["missing", "applied", "expired"] as const) {
      const q = qual({ type: "SIA_DS", status, expiresOn: null });
      const m = { type: "SIA_DS", status, day: "2026-10-20" };
      expect(inHand(q, { ...m, changedAfter: false }), status).toBe(true);
      expect(inHand(q, { ...m, changedAfter: true }), status).toBe(false);
      expect(inHand(q, m), status).toBe(false);
    }
    // Dated ones too: a newer upload turned down the same day as the mark, or a record changed
    // after it, is not what the office marked.
    const turned = qual({
      status: "rejected",
      expiresOn: null,
      rejected: { uploadId: "u", sentOn: "2026-10-30", reason: "blurry" },
    });
    const turnedMark = { type: "SIA_DS", status: "rejected", day: "2026-10-30" };
    expect(inHand(turned, { ...turnedMark, changedAfter: false })).toBe(true);
    expect(inHand(turned, { ...turnedMark, changedAfter: true })).toBe(false);
    const expired = qual({ type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" });
    const expiredMark = { type: "SIA_DS", status: "expired", day: "2026-10-20" };
    expect(inHand(expired, { ...expiredMark, changedAfter: true })).toBe(false);
    expect(inHand(expired, { ...expiredMark, changedAfter: false })).toBe(true);
  });

  it("no 'contact the office' left in the qualification words and the upload page; every 'message the office' links to Messages", () => {
    for (const file of [
      "src/lib/portal/qualification-copy.ts",
      "src/app/profile/upload/[type]/page.tsx",
      "src/app/profile/upload/[type]/office-recorded.tsx",
      "src/app/profile/profile-view.tsx",
    ]) {
      expect(readFileSync(join(process.cwd(), file), "utf8"), file).not.toMatch(
        /contact (the office|them)/i,
      );
    }
    // Every line a casual reads from the qualification words.
    const blocks = { role: "steward", day: "2026-11-07" };
    const everyLine = [
      ...EVERY_STATUS.map((q) => meaning(q) ?? ""),
      ...EVERY_STATUS.map((q) => otherMeaning({ ...q, neededFor: [] }) ?? ""),
      ...EVERY_STATUS.flatMap((q) =>
        ([1, 2, 3, 4] as const).map((level) =>
          needsText(need(level, q, level === 1 ? blocks : null), 2026),
        ),
      ),
    ];
    for (const line of everyLine) expect(line).not.toMatch(/contact the office/i);
    expect(needsText(need(2, { status: "suspended", expiresOn: null }), 2026)).toBe(
      "SIA door supervisor licence is suspended. Message the office.",
    );
    expect(
      needsText(
        need(
          1,
          { status: "expired", expiresOn: "2026-10-01" },
          { role: "door_supervisor", day: "2026-11-06" },
        ),
        2026,
      ),
    ).toBe(
      "SIA door supervisor licence expired on 1 Oct, and your door supervisor shift on Fri 6 Nov needs it. Upload the new one, or message the office.",
    );
    // On Profile, the words are a link to Messages, 44px tall to tap.
    const html = renderWith(profile({ qualifications: EVERY_STATUS }));
    expect(links(html, "message the office")).toEqual([MESSAGES_PATH]);
    expect(html).toContain(`class="${officeLinkClass}"`);
    // 44px to tap, its margins giving the room back so the lines around it don't move.
    expect(officeLinkClass).toMatch(/(?<![\w-])min-h-11(?![\w-])/);
    expect(officeLinkClass).toMatch(/(?<![\w-])-my-2\.5(?![\w-])/);
    expect(MESSAGES_PATH).toBe("/messages");
    // The upload page, for one the office records itself: what to do, and the way there.
    const note = renderToStaticMarkup(
      createElement(OfficeRecordedNote, { name: "CSAS accreditation" }),
    );
    expect(text(note)).toContain(
      "The office records your CSAS accreditation itself. When you have a new one, message the office. Message the office",
    );
    expect(links(note, "Message the office")).toEqual(["/messages"]);
  });

  it("the photo and its box: 8px round, no dashed edge", () => {
    const none = renderWith(profile());
    expect(none).not.toContain("border-dashed");
    expect(none).toMatch(/class="glass-tile [^"]*rounded-row[^"]*">No photo</);
    const mine = renderWith(
      profile({
        photo: {
          status: "up_to_date",
          current: {
            id: "7c1d2e3f-0000-4000-8000-0000000000aa",
            uploadedOn: "2024-08-03",
            renewBy: "2027-08-03",
          },
          waiting: null,
        },
      }),
    );
    expect(mine).toMatch(/<img src="\/files\/[^"]+"[^>]*class="[^"]*rounded-row[^"]*"/);
  });

  it("the upload form starts with the guidance and the camera; nothing to send until a picture is chosen", () => {
    const html = renderToStaticMarkup(
      createElement(UploadForm, {
        kind: "certificate",
        type: "SIA_DS",
        camera: "environment",
        button: "Take or choose a photo",
        guidance: "Take a clear photo of the front.",
      }),
    );
    expect(text(html)).toContain("Take a clear photo of the front. Take or choose a photo");
    expect(text(html)).not.toContain("Send this photo");
    expect(html).toMatch(/<input type="file" accept="image\/\*" capture="environment"/);
    // The answer's live region is there from the start (empty), so it's read out when it comes.
    expect(html).toContain('<div role="status" class="mt-3"></div>');
  });
});
