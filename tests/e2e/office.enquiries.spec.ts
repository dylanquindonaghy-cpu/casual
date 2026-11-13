import { randomBytes } from "node:crypto";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { twilioSignature } from "../../src/lib/inbound/twilio-signature";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import {
  addOfficeUser,
  addSwapRequest,
  addUnsortedMessage,
  addWorker,
  cancelOwnShift,
  eraseCasual,
  personalReplyScene,
  unusedMobile,
} from "./db";
import { expect, menuLink, test } from "./fixtures";
import { readOutbox, sentTo } from "./outbox";
import { SPARE_MOBILES } from "./spare-mobiles";

// Enquiries in a real browser (docs/office-v2.md 3.6; docs/screens.md `/office/enquiries`; 12D.1),
// at phone width: two WhatsApps from numbers nobody here has reach Acme's shifts line (signed as
// Twilio would, with the e2e run's made-up key) and the real worker answers each. A resourcer of
// this spec's own sees them in Need a person (the menu's badge, the honest banner), opens one, reads
// how it was answered, and replies: the reply reaches that number from Acme's line and the message
// leaves Need a person. The other is closed with a reason, with no reply. Numbers: 07700
// 900980-900998, and 900920-900937 on a laptop: the enquiryPhone and enquiryLaptop blocks in
// spare-mobiles.ts, so no seeded or spec casual can have one (tests/unit/e2e.spare-mobiles.test.ts).

// A pair (n, n + 1) inside a reserved block: n even from its start, n + 1 still inside.
const pairIn = ([from, to]: readonly [number, number]) =>
  from + Math.floor(Math.random() * Math.floor((to - from) / 2)) * 2;

const acme = "http://acme.localhost:3100";
const webhook = "http://localhost:3100/api/webhooks/twilio/whatsapp";
const acmeLine = "+447700900000";

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

// A WhatsApp to Acme's line, signed as Twilio would; returns the moment just before, for the outbox.
async function post(request: APIRequestContext, from: string, body: string): Promise<Date> {
  const fields = {
    MessageSid: `SM${randomBytes(16).toString("hex")}`,
    From: `whatsapp:${from}`,
    To: `whatsapp:${acmeLine}`,
    Body: body,
    NumMedia: "0",
  };
  const asked = new Date(Date.now() - 1000);
  const res = await request.post(webhook, {
    form: fields,
    headers: { "x-twilio-signature": twilioSignature(E2E_TWILIO_AUTH_TOKEN, webhook, fields) },
  });
  expect(res.status()).toBe(200);
  return asked;
}

// The Enquiries badge's words (Wave 1, w1-04 and w1-07): for screen readers, beside the link (a
// span with the sr-only class, among others or not); in the rail's tip, after the link's name.
const badgeWords = (link: Locator) =>
  link.locator(
    "xpath=following-sibling::span[contains(concat(' ', normalize-space(@class), ' '), ' sr-only ')]",
  );
// Each number agrees with its words: "1 needs a person", "2 need a person"; "1 request to
// answer", "2 requests to answer". Never "1 need a person".
function agrees(words: string): void {
  const person = /(\d+) (needs?) a person/.exec(words);
  if (person) expect(person[2]).toBe(person[1] === "1" ? "needs" : "need");
  const requests = /(\d+) (requests?) to answer/.exec(words);
  if (requests) expect(requests[2]).toBe(requests[1] === "1" ? "request" : "requests");
  expect(words).not.toMatch(/(^|\D)1 need a person/);
}

async function whatsApp(request: APIRequestContext, from: string, body: string) {
  const asked = await post(request, from, body);
  // The worker has answered it: the polite reply to a number we don't know.
  await sentTo(from, asked, /^(Thanks for your message\. We don't recognise this number\.)/);
}

async function logIn(page: Page, email: string, name: string) {
  await addOfficeUser("acme", { email, name, role: "resourcer" });
  const loginAsked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await sentTo(email, loginAsked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

test("Need a person: reply to one unknown number, close another with a reason", async ({
  page,
  request,
}) => {
  // Two different numbers each attempt, so a retry within 24 hours isn't a repeat.
  const n = pairIn(SPARE_MOBILES.enquiryPhone);
  const pat = `+447700900${n}`;
  const wrong = `+447700900${n + 1}`;
  const tag = randomBytes(3).toString("hex");
  const patWords = `Hello, I'm Pat, starting Saturday (e2e ${tag})`;
  const wrongWords = `Wrong number, sorry (e2e ${tag})`;
  await whatsApp(request, pat, patWords);
  await whatsApp(request, wrong, wrongWords);

  await logIn(page, "enquiries.resourcer@example.com", "Enquiries Resourcer");

  // The menu's Enquiries link carries the Need a person count (outside the link's name).
  const link = await menuLink(page, "Enquiries");
  await expect(link).toContainText(/\d+/);
  await link.click();
  await expect(page).toHaveURL(`${acme}/office/enquiries`);
  await expect(page.getByRole("heading", { name: "Enquiries", level: 1 })).toBeVisible();
  // About the firm's setup: admins only (Phase 26.10, fix-5); this is a resourcer.
  await expect(page.getByText("AI sorting isn't connected yet")).toHaveCount(0);
  await expect(
    page.getByText(/^\d+ enquir(y|ies) today · \d+ needs? a person, the oldest /),
  ).toBeVisible();
  await noSidewaysScroll(page);

  await page.getByRole("link", { name: /^Need a person \d+$/ }).click();
  await expect(page).toHaveURL(`${acme}/office/enquiries?view=person`);
  await expect(page.getByRole("link", { name: /^Need a person/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const waiting = page.getByRole("region", { name: "Need a person" });
  const patRow = waiting.getByRole("listitem").filter({ hasText: patWords });
  await expect(patRow).toContainText("Unknown number");
  await expect(patRow).toContainText("Passed to a person, waiting");
  await expect(patRow).toContainText(`“${patWords}”`);
  await patRow.getByRole("link", { name: "Unknown number" }).click();

  // The message's page: the conversation, how it was answered, and the answer box.
  await expect(page.getByRole("heading", { name: "Message from an unknown number" })).toBeVisible();
  const talk = page.getByRole("region", { name: "The conversation" });
  await expect(talk.getByText(patWords)).toBeVisible();
  await expect(
    talk.getByText(/^Thanks for your message\. We don't recognise this number\./),
  ).toBeVisible();
  const how = page.getByRole("region", { name: "How it was answered" });
  await expect(how.getByRole("listitem").nth(0)).toContainText(
    `from ${pat}, a number that isn't one of your casuals'`,
  );
  await expect(how).toContainText("Not one of your casuals' numbers: passed to a person.");
  await expect(how).toContainText("What we checked: No checks recorded.");
  await expect(how).toContainText("The reply asking a number we don't know for their full name.");
  await expect(how).toContainText("Then: Waiting for a person.");
  await expect(page.getByRole("region", { name: "Considered but not offered" })).toContainText(
    "No checks recorded.",
  );
  const answer = page.getByRole("region", { name: "Answer it" });
  await expect(
    answer.getByText("Inside WhatsApp's 24-hour window: your words go as they are."),
  ).toBeVisible();
  await noSidewaysScroll(page);

  const replyWords = `Welcome Pat, we'll add your number now (e2e ${tag}).`;
  const replied = new Date(Date.now() - 1000);
  await answer.getByLabel("Reply").fill(replyWords);
  await answer.getByRole("button", { name: "Send reply" }).click();
  await expect(answer.getByRole("status")).toHaveText(
    "Your reply is on its way: it goes on WhatsApp in a moment.",
  );
  // The worker sends it from Acme's line, signed.
  const escaped = replyWords.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await sentTo(pat, replied, new RegExp(`^(${escaped} — Acme Events Shift Team)$`));
  // Once sent, the page says so, and it isn't waiting any more.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Passed to a person, answered")).toBeVisible({ timeout: 1000 });
    await expect(how).toContainText(
      /Enquiries Resourcer replied at .* \(on WhatsApp, in their own words\): sent\./,
      {
        timeout: 1000,
      },
    );
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Answer it" })).toHaveCount(0);

  // The other one: closed with a reason, no reply.
  await page.goto(`${acme}/office/enquiries?view=person`);
  const wrongRow = page
    .getByRole("region", { name: "Need a person" })
    .getByRole("listitem")
    .filter({ hasText: wrongWords });
  await wrongRow.getByRole("link", { name: "Unknown number" }).click();
  const closeBox = page.getByRole("region", { name: "Answer it" });
  // Closing asks why first (round 7: "Close, no reply needed", then the reason); "Keep it open"
  // goes back, its button there again.
  await expect(closeBox.getByLabel("Why close it?")).toHaveCount(0);
  await closeBox.getByRole("button", { name: "Close, no reply needed" }).click();
  await expect(closeBox.getByLabel("Why close it?")).toBeFocused();
  await closeBox.getByRole("button", { name: "Keep it open" }).click();
  await expect(closeBox.getByLabel("Why close it?")).toHaveCount(0);
  await expect(closeBox.getByRole("button", { name: "Close, no reply needed" })).toBeFocused();
  await closeBox.getByRole("button", { name: "Close, no reply needed" }).click();
  await closeBox.getByLabel("Why close it?").selectOption({ label: "Not for us" });
  const closedAt = new Date(Date.now() - 1000);
  await closeBox.getByRole("button", { name: "Close without a reply" }).click();
  await expect(closeBox.getByRole("status")).toHaveText("Closed. No reply was sent.");
  await page.reload();
  await expect(page.getByRole("region", { name: "How it was answered" })).toContainText(
    /Enquiries Resourcer closed it at .* without a reply: not for us\./,
  );
  await page.goto(`${acme}/office/enquiries?view=person`);
  const left = page.getByRole("region", { name: "Need a person" });
  await expect(left.getByText(patWords)).toHaveCount(0);
  await expect(left.getByText(wrongWords)).toHaveCount(0);
  // Nothing went to that number after it was closed (closing queues no message: give the worker a
  // moment anyway).
  await page.waitForTimeout(1500);
  const outbox = await readOutbox<{ at: string; to: string }>();
  expect(outbox.filter((l) => l.to === wrong && new Date(l.at) >= closedAt)).toEqual([]);

  // "Requests from the app" is the old Requests page.
  await page.getByRole("link", { name: "Requests from the app" }).click();
  await expect(page).toHaveURL(`${acme}/office/enquiries?view=app`);
  await expect(page.getByRole("region", { name: "Waiting for an answer" })).toBeVisible();
});

// Personal replies (12D.2; docs/office-v2.md 3.6, 5.7): two casuals of this spec's own ask Acme's
// line for shifts (tests/e2e/db.ts personalReplyScene: response team lead sessions nobody else can
// see). Zoe, who holds CSAS, gets two sessions listed, the CSAS one marked; Noor, who doesn't, gets
// one. On Zoe's message the office reads each check made by code with its figures, the sessions
// the reply listed, and the one left out: "Response team lead: needs first aid at work …"; on
// Noor's, the CSAS session left out. Numbers 07700 900631 and 900632, which nothing else uses.
const ZOE = { firstName: "Zoe", lastName: "Marsh", mobileE164: "+447700900631" };
const NOOR = { firstName: "Noor", lastName: "Hale", mobileE164: "+447700900632" };
const DATE = /\d{1,2} [A-Z][a-z]{2}( \d{4})?/.source;

test("a casual's personal shift list: each check, the sessions listed and the one left out", async ({
  page,
  request,
}) => {
  const scene = await personalReplyScene("acme", ZOE, NOOR);
  const [eventName = "", siteName = ""] = scene.names;
  try {
    // Zoe's reply: both sessions she can take, the CSAS one marked, and nothing more.
    const zoeAsked = await post(request, ZOE.mobileE164, "Any shifts?");
    const zoeReply = await sentTo(
      ZOE.mobileE164,
      zoeAsked,
      /^(Hi Zoe, shifts you can take:[\s\S]*)$/,
    );
    const line = `Response team lead · ${eventName}, ${siteName} · `;
    expect(zoeReply).toContain(`1. ${line}`);
    expect(zoeReply).toMatch(
      / · £14\.50\/h · Main gate\n {3}\d+\.\d miles · 20 min by car · no public transport by \d\d:\d\d\n/,
    );
    expect(zoeReply).toMatch(/\n2\. Response team lead · [^\n]* · you hold CSAS\n/);
    expect(zoeReply).not.toContain("\n3. ");
    expect(zoeReply).not.toContain("ZZ");
    expect(zoeReply).toMatch(
      /Take one here: http:\/\/acme\.localhost:3100\/shifts\/open\nAutomatic reply\. Send OFFICE to reach a person\.\n— Acme Events Shift Team$/,
    );
    // Noor's: only the plain one (no CSAS).
    const noorAsked = await post(request, NOOR.mobileE164, "Any shifts?");
    const noorReply = await sentTo(
      NOOR.mobileE164,
      noorAsked,
      /^(Hi Noor, shifts you can take:[\s\S]*)$/,
    );
    expect(noorReply).toContain(`1. ${line}`);
    expect(noorReply).not.toContain("\n2. ");
    expect(noorReply).not.toContain("CSAS");

    await logIn(page, "replies.resourcer@example.com", "Replies Resourcer");
    await page.goto(`${acme}/office/enquiries`);
    await page.getByRole("link", { name: "Zoe Marsh" }).first().click();
    await expect(page.getByRole("heading", { name: "Message from Zoe Marsh" })).toBeVisible();
    const how = page.getByRole("region", { name: "How it was answered" });
    // Each check made by code, with its figures, for both sessions.
    const checks = how.getByRole("listitem").filter({ hasText: "What we checked:" });
    await expect(checks).toContainText(`Response team lead · ${eventName}, ${siteName}, `);
    await expect(checks).toContainText("Has the response team lead role ✓");
    await expect(checks).toContainText(
      new RegExp(`SIA door supervisor licence valid to ${DATE} ✓`),
    );
    await expect(checks).toContainText("Rest gap 16 h ✓");
    await expect(checks).toContainText("Clash: none ✓");
    await expect(checks).toContainText(/Weekly hours \d+\/48 ✓/);
    await expect(checks).toContainText("Not a day off ✓");
    await expect(checks).toContainText("Site allowed ✓");
    await expect(checks).toContainText("Showing to casuals ✓");
    await expect(checks).toContainText("Inside travel area (20 min by car, limit 45 min) ✓");
    await expect(checks).toContainText(
      new RegExp(`CSAS accreditation valid to ${DATE} \\(this session needs it\\) ✓`),
    );
    // The sessions the reply listed, each a link to the session.
    const built = how.getByRole("listitem").filter({ hasText: "Reply sent:" });
    await expect(built).toContainText("The personal shift list, with 2 sessions:");
    // (The scene's names are letters, digits and spaces only: safe in a pattern as they are.)
    const listed = new RegExp(`^Response team lead · ${eventName}, ${siteName}, `);
    await expect(built.getByRole("link", { name: listed })).toHaveCount(2);
    await expect(built.getByRole("link").first()).toHaveAttribute(
      "href",
      `/office/shifts/${scene.plain}`,
    );
    // Left out: the session that also needs first aid.
    const left = page.getByRole("region", { name: "Considered but not offered" });
    await expect(left).toContainText(
      "Response team lead: needs first aid at work certificate (none on file)",
    );
    await expect(left.getByRole("listitem")).toHaveCount(1);
    await noSidewaysScroll(page);

    // Noor's message: the CSAS session is left out for her.
    await page.goto(`${acme}/office/enquiries`);
    await page.getByRole("link", { name: "Noor Hale" }).first().click();
    const noorLeft = page.getByRole("region", { name: "Considered but not offered" });
    await expect(noorLeft).toContainText(
      "Response team lead: needs CSAS accreditation (none on file)",
    );
    await expect(noorLeft).toContainText(
      "Response team lead: needs first aid at work certificate (none on file)",
    );
    await expect(
      page
        .getByRole("region", { name: "How it was answered" })
        .getByRole("listitem")
        .filter({ hasText: "Reply sent:" }),
    ).toContainText("The personal shift list, with 1 session:");
  } finally {
    for (const id of [scene.plain, scene.firstAid, scene.csas, scene.booked]) {
      await cancelOwnShift("acme", id);
    }
  }
});

// A spec casual erased through the real code (her messages with her), by this spec's own admin.
async function eraseUnsorted(workerId: string, retry: number): Promise<void> {
  const adminEmail = `unsorted.admin${retry || ""}@example.com`;
  await addOfficeUser("acme", { email: adminEmail, name: "Unsorted Admin", role: "admin" });
  await eraseCasual("acme", { workerId, adminEmail });
}

// Wave 1 (w1-04): a message the shifts line never sorted (its job never ran: tests/e2e/db.ts
// addUnsortedMessage) needs a person 10 minutes after it came in. A casual of this spec's own (a
// number from the "unsorted" block) has one from 15 minutes ago and one from 2 minutes ago: the
// first is counted in the menu's badge and listed in Need a person under her name, with "Answer
// it"; the second reads "Not answered yet", with no "Answer it". Closing the first passes it to a
// person and takes it out of Need a person. Both go at the end (eraseUnsorted).
test("a message the shifts line never answered needs a person after 10 minutes", async ({
  page,
}, testInfo) => {
  const mobile = await unusedMobile("acme", "unsorted");
  const casual = { firstName: "Una", lastName: `Sortley${testInfo.retry || ""}` };
  const workerId = await addWorker("acme", { ...casual, mobileE164: mobile });
  const name = `${casual.firstName} ${casual.lastName}`;
  const tag = randomBytes(3).toString("hex");
  const oldWords = `Can someone ring me about Saturday? (e2e ${tag})`;
  const newWords = `Also, is parking free? (e2e ${tag})`;
  const old = await addUnsortedMessage("acme", mobile, oldWords, 15);
  const recent = await addUnsortedMessage("acme", mobile, newWords, 2);
  try {
    await logIn(
      page,
      `unsorted.resourcer${testInfo.retry || ""}@example.com`,
      "Unsorted Resourcer",
    );

    // The menu's Enquiries badge counts it (its words, for screen readers, beside the link).
    const link = await menuLink(page, "Enquiries");
    await expect(link).toContainText(/\d+/);
    const said = badgeWords(link);
    await expect(said).toHaveText(/^\d+ needs? a person(, \d+ requests? to answer)?$/);
    agrees(await said.innerText());
    await link.click();
    await expect(page).toHaveURL(`${acme}/office/enquiries`);

    // Need a person lists the 15-minute-old one under her name, waiting; not the 2-minute-old one.
    await page.goto(`${acme}/office/enquiries?view=person`);
    const waiting = page.getByRole("region", { name: "Need a person" });
    const oldRow = waiting.getByRole("listitem").filter({ hasText: oldWords });
    await expect(oldRow).toContainText(name);
    await expect(oldRow).toContainText("Passed to a person, waiting");
    await expect(waiting.getByText(newWords)).toHaveCount(0);
    await noSidewaysScroll(page);

    // Its page: the casual, the one-colon Sorted line, and Answer it.
    await page.goto(`${acme}/office/enquiries/${old}`);
    await expect(page.getByRole("heading", { name: `Message from ${name}` })).toBeVisible();
    const how = page.getByRole("region", { name: "How it was answered" });
    await expect(how.getByRole("listitem").nth(0)).toContainText(`from ${name}'s number`);
    await expect(how).toContainText(
      "Sorted: Not yet. The shifts line hasn't answered it in 10 minutes, so it's waiting for a person.",
    );
    await expect(how).toContainText("Then: Waiting for a person.");
    const answer = page.getByRole("region", { name: "Answer it" });
    await expect(answer).toBeVisible();
    await noSidewaysScroll(page);

    // Closed: passed to a person, out of Need a person.
    await answer.getByRole("button", { name: "Close, no reply needed" }).click();
    await answer.getByLabel("Why close it?").selectOption({ label: "Spam" });
    await answer.getByRole("button", { name: "Close without a reply" }).click();
    await expect(answer.getByRole("status")).toHaveText("Closed. No reply was sent.");
    await page.reload();
    await expect(page.getByRole("region", { name: "How it was answered" })).toContainText(
      "Sorted: The shifts line hadn't answered it after 10 minutes, so it was passed to a person.",
    );
    await page.goto(`${acme}/office/enquiries?view=person`);
    await expect(
      page.getByRole("region", { name: "Need a person" }).getByText(oldWords),
    ).toHaveCount(0);

    // The 2-minute-old one: not answered yet, and nothing to answer it with.
    await page.goto(`${acme}/office/enquiries`);
    await expect(page.getByRole("listitem").filter({ hasText: newWords })).toContainText(
      "Not answered yet",
    );
    await page.goto(`${acme}/office/enquiries/${recent}`);
    await expect(page.getByRole("region", { name: "How it was answered" })).toContainText(
      "Sorted: Not yet. The shifts line hasn't answered it.",
    );
    await expect(page.getByRole("region", { name: "Answer it" })).toHaveCount(0);
    await noSidewaysScroll(page);
  } finally {
    // Leave Acme's shared data as found: her details and both messages go, through the real
    // erase (the 2-minute one would otherwise need a person 8 minutes on, for the rest of the run).
    await eraseUnsorted(workerId, testInfo.retry);
  }
});

// Wave 1 (w1-07): the requests casuals made in the app, still waiting for an answer, count in the
// frame: Needs attention has their own part, linking to Requests from the app, and the Enquiries
// badge names them. A swap request of this spec's own keeps at least one waiting; other specs
// make and take back requests meanwhile, so numbers are read, never fixed.
test("requests from the app waiting for an answer: counted, with their own part in Needs attention", async ({
  page,
}, testInfo) => {
  await addSwapRequest("acme", `Counted in the frame (e2e ${randomBytes(3).toString("hex")})`);
  await logIn(page, `appcount.resourcer${testInfo.retry || ""}@example.com`, "Appcount Resourcer");
  const link = await menuLink(page, "Enquiries");
  // The link's own name stays "Enquiries"; its badge's words say what waits.
  const said = badgeWords(link);
  await expect(said).toHaveText(/^(\d+ needs? a person, )?\d+ requests? to answer$/);
  agrees(await said.innerText());
  await page.goto(`${acme}/office/needs-attention`);
  const part = page.getByRole("region", { name: /^Requests from the app ?\d+$/ });
  await expect(part).toContainText(
    /\d+ requests? (casuals|a casual) made in the app (are|is) waiting for an answer\./,
  );
  const shown = Number(/(\d+)$/.exec((await part.getByRole("heading").innerText()).trim())?.[1]);
  expect(shown).toBeGreaterThan(0);
  await part.getByRole("link", { name: "Open requests from the app" }).click();
  await expect(page).toHaveURL(`${acme}/office/enquiries?view=app`);
  // Its tab names the same number (other specs may change it meanwhile: read again until equal).
  await expect
    .poll(async () => {
      await page.reload();
      const tab = await page
        .getByRole("link", { name: /^Requests from the app/ })
        .first()
        .innerText();
      const n = Number(/(\d+)/.exec(tab)?.[1]);
      await page.goto(`${acme}/office/needs-attention`);
      const again = await page
        .getByRole("region", { name: /^Requests from the app ?\d+$/ })
        .getByRole("heading")
        .innerText();
      await page.goto(`${acme}/office/enquiries?view=app`);
      return n === Number(/(\d+)$/.exec(again.trim())?.[1]);
    })
    .toBe(true);
  await noSidewaysScroll(page);
});

// From 1024px (Phase 24, 24.4: round 7 of the canvas): the list at the left, the chosen message at
// the right (the list's first at first). A row picks its message there without leaving the page,
// the address keeps it (so a reload shows it again), and the row says it's the current one. The
// pane has the message page's parts. (On a phone a row opens the message's own page: above.)
test.describe("on a laptop", () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  // Wave 1 (w1-04, w1-07): the shut rail's tip beside Enquiries says what waits, after its name
  // ("Enquiries, 2 need a person, 1 request to answer"); the link's own name stays "Enquiries". A
  // 15-minute-old unsorted message of this spec's own keeps at least one needing a person; other
  // specs change the numbers meanwhile, so they're read, never fixed.
  test("the rail's tip beside Enquiries says what waits", async ({ page }, testInfo) => {
    const mobile = await unusedMobile("acme", "unsorted");
    const workerId = await addWorker("acme", {
      firstName: "Tia",
      lastName: `Railtip${testInfo.retry || ""}`,
      mobileE164: mobile,
    });
    await addUnsortedMessage(
      "acme",
      mobile,
      `Who do I ask about Sunday? (e2e ${randomBytes(3).toString("hex")})`,
      15,
    );
    try {
      await logIn(
        page,
        `railtip.resourcer${testInfo.retry || ""}@example.com`,
        "Railtip Resourcer",
      );
      await expect(page.locator("#office-rail")).toHaveAttribute("data-rail", "shut");
      const menu = page.getByRole("navigation", { name: "Office menu" });
      const link = menu.getByRole("link", { name: "Enquiries", exact: true });
      const tip = link.locator("xpath=..").locator("[data-rail-tip]");
      await link.hover();
      await expect(tip).toBeVisible();
      await expect(tip).toHaveText(/^Enquiries, \d+ needs? a person(, \d+ requests? to answer)?$/);
      agrees(await tip.innerText());
    } finally {
      await eraseUnsorted(workerId, testInfo.retry);
    }
  });

  test("the list beside the chosen message; a row picks its message there, kept on reload", async ({
    page,
  }, testInfo) => {
    await logIn(page, `pane.resourcer${testInfo.retry || ""}@example.com`, "Pane Resourcer");
    await page.goto(`${acme}/office/enquiries`);
    const list = page.getByRole("region", { name: "All", exact: true });
    const pane = page.locator("[data-chosen-message]");
    await expect(pane).toBeVisible();
    const rows = list.getByRole("listitem");
    expect(await rows.count()).toBeGreaterThan(1);
    // Side by side, tops level.
    const l = (await list.boundingBox())!;
    const p = (await pane.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(l.x + l.width);
    expect(Math.abs(p.y - l.y)).toBeLessThan(2);
    // The first is chosen: its row current, its message beside.
    const first = rows.nth(0).getByRole("link");
    const firstId = (await first.getAttribute("href"))?.split("/").pop();
    await expect(first).toHaveAttribute("aria-current", "true");
    await expect(pane).toHaveAttribute("data-chosen-message", firstId ?? "");
    await expect(pane.getByRole("heading", { level: 2 })).toHaveText(/^Message from /);
    for (const part of ["The conversation", "How it was answered", "Considered but not offered"])
      await expect(pane.getByRole("region", { name: part })).toBeVisible();
    // The second, picked in place: the address keeps it; it's the current row now.
    const second = rows.nth(1).getByRole("link");
    const href = (await second.getAttribute("href")) ?? "";
    expect(href).toMatch(/^\/office\/enquiries\/[0-9a-f-]{36}$/); // still its own page's link
    const id = href.split("/").pop() ?? "";
    await second.click();
    await expect(page).toHaveURL(`${acme}/office/enquiries?message=${id}`);
    await expect(pane).toHaveAttribute("data-chosen-message", id);
    await expect(second).toHaveAttribute("aria-current", "true");
    await expect(first).not.toHaveAttribute("aria-current", "true");
    await page.reload();
    await expect(pane).toHaveAttribute("data-chosen-message", id);
    await noSidewaysScroll(page);
  });

  // Answered beside the list, the message stays chosen with its confirmation: the address takes it
  // (it was only the list's first until now), so a newer message at the top of the list, or this
  // one leaving the view, never swaps another person's message in under "Closed. No reply was
  // sent." (golden rule 11: every action ends with a confirmation).
  test("a message answered beside the list stays there with its confirmation", async ({
    page,
    request,
  }, testInfo) => {
    const tag = randomBytes(3).toString("hex");
    const n = pairIn(SPARE_MOBILES.enquiryLaptop);
    const words = `Is this the right number? (e2e ${tag})`;
    const newer = `A newer one (e2e ${tag})`;
    await whatsApp(request, `+447700900${n}`, words);
    await logIn(page, `answer.resourcer${testInfo.retry || ""}@example.com`, "Answer Resourcer");
    await page.goto(`${acme}/office/enquiries`);
    // The latest is the list's first, and chosen.
    const pane = page.locator("[data-chosen-message]");
    await expect(pane.getByRole("region", { name: "The conversation" })).toContainText(words);
    const id = (await pane.getAttribute("data-chosen-message")) ?? "";
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await whatsApp(request, `+447700900${n + 1}`, newer);
    const answer = pane.getByRole("region", { name: "Answer it" });
    await answer.getByRole("button", { name: "Close, no reply needed" }).click();
    await answer.getByLabel("Why close it?").selectOption({ label: "Not for us" });
    await answer.getByRole("button", { name: "Close without a reply" }).click();
    await expect(answer.getByRole("status")).toHaveText("Closed. No reply was sent.");
    await expect(page).toHaveURL(`${acme}/office/enquiries?message=${id}`);
    // The page is fresh under it: the newer one tops the list, and the pane kept its message.
    const list = page.getByRole("region", { name: "All", exact: true });
    await expect(list.getByRole("listitem").nth(0)).toContainText(newer);
    await expect(pane).toHaveAttribute("data-chosen-message", id);
    await expect(answer.getByRole("status")).toHaveText("Closed. No reply was sent.");
    await expect(pane.getByRole("region", { name: "The conversation" })).toContainText(words);
    // An address that names no message of the firm's shows the list's first instead.
    await page.goto(`${acme}/office/enquiries?message=not-a-message`);
    await expect(pane.getByRole("region", { name: "The conversation" })).toContainText(newer);
  });
});
