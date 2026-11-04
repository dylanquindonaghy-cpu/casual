import type { Locator, Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  addTakenOffer,
  cancelOwnShift,
  setFirmSetting,
} from "./db";
import { DASHBOARD_HEADING, expect, menuLink, openToOffer, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office dashboard in a real browser, on the demo seed (Phase 24, 24.3; round 8 since Phase
// 26.2: the spec page's "Dashboard"; docs/screens.md `/office`): "Dashboard" with the day, the pay
// week and its pay day; the track (All, Urgent, This week, Next week, each with its count, To offer
// adding up to it), Filter and Show filled venues too; the venue map (no street map in the tests: each
// venue placed by its own position), a pin picking its venue's soonest session into the card; the
// card on the map (under it on a phone), with who can take it; To offer as a list on the map (Phase
// 27.4: its button opens it, a row picks its session and the card then has who can take it) with
// every session and View all; the card's "1 of 2" for a venue with two sessions; the offer panel
// (from the foot on a phone, the side on a laptop) listing who can take a session as the offer page
// does, Send offer, then offered; the card's "…" with Not urgent and Mark as filled; Updates with a
// place a casual took an hour ago; Who worked? by name; nothing to approve, decline or deny; the
// offer page leads back here; `/office/today` redirects here; payroll is sent to the pay dashboard.
// (Other specs change the seed's numbers, so this one checks the words, the links, and that the
// counts add up on one page.)

const acme = "http://acme.localhost:3100";

async function officeLogin(page: Page, email: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  // Payroll's home is the pay dashboard: /office sends them on (12A.3).
  await expect(page).toHaveURL(new RegExp(`^${acme.replace(/\./g, "\\.")}/office(/pay)?$`));
}

// The page is ready (hydrated: the offer panel's dialog says so), so a card picks itself in place
// and a paper plane opens the panel, rather than each loading a page.
async function ready(page: Page) {
  await expect(page.locator("dialog[data-offer-panel][data-ready]")).toHaveCount(1);
}

const column = (page: Page, id: string) => page.locator(`section#${id}`);
// A column's count, as a screen reader hears it ("6 sessions"): its number.
async function countOf(page: Page, id: string): Promise<number> {
  const words = await column(page, id).locator(".sr-only").first().innerText();
  return Number(/^(\d+)/.exec(words)?.[1] ?? NaN);
}

test("a resourcer's dashboard: its head, the track adding up, the map, the card, To offer on it, two columns, and nothing to approve", async ({
  page,
}) => {
  await officeLogin(page, "acme.resourcer@example.com");
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  await ready(page);
  await expect(page).toHaveTitle("Dashboard · Acme Events shifts");
  // Under it, today, the pay week and its pay day (and, with a planner or sheet, when it last
  // sent changes: the demo has neither).
  await expect(
    page
      .getByRole("main")
      .getByText(
        /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+ · Week \d{1,2} \(paid Fri \d{1,2} [A-Z][a-z]{2}\)$/,
      ),
  ).toBeVisible();
  // Every part loaded.
  await expect(page.getByText("This couldn't load. Reload the page to try again.")).toHaveCount(0);

  // The track: four links, All the current one, each with its count.
  const track = page.getByRole("navigation", { name: "Show" });
  await expect(track.getByRole("link")).toHaveText([
    /^All \d+$/,
    /^Urgent \d+$/,
    /^This week \d+$/,
    /^Next week \d+$/,
  ]);
  await expect(track.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "page");
  const all = Number((await track.getByRole("link", { name: /^All/ }).innerText()).split(/\s/)[1]);

  // To offer is a list on the map (Phase 27.4): shut as the page arrives (no To offer heading),
  // its button top right of the map. Without the street map (the tests), it's the map's only button.
  const headings = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(headings.filter({ hasText: /^To offer$/ })).toHaveCount(0);
  const map = page.locator("[data-venue-map]");
  const buttons = map.getByRole("group", { name: "Map buttons" });
  await expect(buttons.getByRole("button")).toHaveCount(1);
  await expect(
    buttons.getByRole("button", { name: "Show the sessions to offer", pressed: false }),
  ).toBeVisible();
  const list = await openToOffer(page);
  // It holds every session the track counts (round 8: one list of them).
  expect(await countOf(page, "to-offer")).toBe(all);

  // The headings, in order: the map, the chosen session, To offer (on the map), the two columns.
  await expect(headings.first()).toHaveText("Venues with places to fill");
  await expect(
    headings.filter({ hasText: /^(To offer|Updates|Who worked\?|Offered|While you were out)$/ }),
  ).toHaveText(["To offer", "Updates", "Who worked?"]);
  // The map: the seed's venues placed by their positions (no street map in the tests), each pin a
  // link to its venue's soonest session; under it, how they're placed and the totals.
  await expect(map).toHaveAttribute("data-venue-map", "plain");
  // On a phone (Phase 27.4): 380px tall, its key on it (top left, clear of the button), and only
  // the chosen venue's pin with its name.
  expect(Math.round((await map.boundingBox())?.height ?? 0)).toBe(380);
  const key = map.getByRole("list", { name: "Key" });
  await expect(key).toBeVisible();
  const [k, m0, b] = [
    await key.boundingBox(),
    await map.boundingBox(),
    await buttons.boundingBox(),
  ];
  expect(Math.round((k?.x ?? 0) - (m0?.x ?? 0))).toBe(12);
  expect((k?.x ?? 0) + (k?.width ?? 0)).toBeLessThanOrEqual(b?.x ?? 0);
  const named = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-venue-map] [data-pin-label]")]
      .filter((el) => getComputedStyle(el).visibility === "visible")
      .map((el) => el.dataset.pinLabel),
  );
  const chosenVenue = await map.locator('[data-venue][aria-current="true"]').count();
  expect(named).toEqual(
    chosenVenue === 1
      ? [await map.locator('[data-venue][aria-current="true"]').getAttribute("data-venue")]
      : [],
  );
  const pins = map.getByRole("link", { name: /: \d+ places? to fill/ });
  expect(await pins.count()).toBeGreaterThan(2);
  for (const href of await pins.evaluateAll((els) => els.map((e) => e.getAttribute("href"))))
    expect(href).toMatch(/^\/office\?session=[0-9a-f-]{36}$/);
  await expect(
    page.getByText("Placed by each venue's postcode · a pin's number is its places to fill"),
  ).toBeVisible();
  await expect(
    page.getByText(/^\d+ venues? · \d+ places? to fill this week and next$/),
  ).toBeVisible();
  // The card: a session with places to fill, who can take it, its two buttons and its "…".
  const detail = page.locator("[data-chosen]");
  await expect(detail.getByRole("link", { name: /^Offer to / })).toBeVisible();
  await expect(detail.getByRole("link", { name: "Open the session" })).toHaveAttribute(
    "href",
    /^\/office\/shifts\/[0-9a-f-]{36}$/,
  );
  await expect(detail.getByText(/^Starts in .+$/)).toBeVisible();
  await expect(detail.getByText(/^(has|have) the licence, rest and hours for it$/)).toBeVisible();
  await expect(detail.getByText(/^(None offered yet|\d+ offered)$/)).toBeVisible();
  // To offer's list: every session (no longer the first four; the board holds the first 50 with an
  // offer out and the first 50 without), then View all; on a phone under the card. Its button shuts
  // it again.
  if (all <= 50) await expect(list.locator("[data-session]")).toHaveCount(all);
  else expect(await list.locator("[data-session]").count()).toBeGreaterThanOrEqual(50);
  if (all > 4)
    await expect(list.getByRole("link", { name: `View all ${all}` })).toHaveAttribute(
      "href",
      "/office/events?view=need",
    );
  const [d0, l0] = [await detail.boundingBox(), await list.boundingBox()];
  expect(l0?.y ?? 0).toBeGreaterThanOrEqual((d0?.y ?? 0) + (d0?.height ?? 0));
  // The columns under the map: Updates and Who worked?, one under the other on a phone.
  await expect(column(page, "updates")).toBeVisible();
  await expect(column(page, "who-worked")).toBeVisible();
  await buttons.getByRole("button", { name: "Hide the sessions to offer", pressed: true }).click();
  await expect(list).toBeHidden();
  await expect(buttons.getByRole("button", { name: "Show the sessions to offer" })).toBeVisible();

  // Nothing to approve, decline or deny anywhere on it (cancellations are recorded, never approved).
  for (const name of [/approve/i, /decline/i, /deny/i]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }
  // No sideways scrolling at phone width.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});

test("the track filters the board; a row of the list or a pin picks its session into the card, which then has who can take it (kept on reload)", async ({
  page,
}, testInfo) => {
  const email = `dashboard.pick${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Pick Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  // An urgent session of this spec's own, tomorrow, in a role nobody else uses.
  const { shiftId } = await addEventWithSession("acme", {
    name: `Pick Gala ${n}`,
    site: `Pick Hall ${n}`,
    role: "pick_check",
    daysAhead: 1,
    urgent: true,
    // On the map, among the seed's venues (each placed near Leeds by its made-up postcode).
    point: { lat: 53.9, lng: -1.5 },
  });
  try {
    await officeLogin(page, email);
    await ready(page);
    const track = page.getByRole("navigation", { name: "Show" });
    await track.getByRole("link", { name: /^Urgent/ }).click();
    await expect(page).toHaveURL(`${acme}/office?show=urgent`);
    await expect(track.getByRole("link", { name: /^Urgent/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const urgent = Number(
      (await track.getByRole("link", { name: /^Urgent/ }).innerText()).split(/\s/)[1],
    );
    // The track's link loaded a new board: To offer's list is shut again until asked for.
    await ready(page);
    const list = await openToOffer(page);
    expect(await countOf(page, "to-offer")).toBe(urgent);
    // Every row under Urgent is urgent: its pick names it so.
    const picks = list.locator('a[href^="/office?"]');
    for (const label of await picks.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    ))
      expect(label).toMatch(/^Urgent\. /);

    // Pick ours from the list (Phase 27.4): the card shows it at once, the address keeps it, and
    // once the page has loaded it, who can take it (it's never been offered and nobody holds the
    // role).
    const row = list.locator(`[data-session="${shiftId}"]`);
    await row.getByRole("link", { name: /^Urgent\. Pick check, / }).click();
    const detail = page.locator(`[data-chosen="${shiftId}"]`);
    await expect(detail.getByRole("heading", { level: 2 })).toContainText("Pick check");
    await expect(page).toHaveURL(`${acme}/office?show=urgent&session=${shiftId}`);
    await expect(detail.getByRole("heading", { level: 2 }).getByText("Urgent")).toBeVisible();
    await expect(detail.getByText(`Pick Gala ${n} · Pick Hall ${n}`)).toBeVisible();
    // Nobody holds the role: nobody can take it ("0", from the page), and nothing's been offered.
    await expect(detail.locator("[data-takers]")).toHaveText("0");
    await expect(detail.getByText("Nobody can be offered it right now.")).toBeVisible();
    // (Phase 27.2, O1: the chip says "None offered yet", never "0 offered".)
    await expect(detail.getByText("None offered yet")).toBeVisible();
    // Its row is the current one; the list stays open.
    await expect(row.locator('a[aria-current="true"]')).toHaveCount(1);
    await expect(list).toBeVisible();

    // Its venue's pin: a link to its soonest session, ours (round 8), now the current one; picked,
    // it keeps ours in the card.
    const pin = page
      .locator("[data-venue-map]")
      .getByRole("link", { name: new RegExp(`^Pick Hall ${n}: 1 place to fill, urgent, `) });
    await expect(pin).toHaveAttribute("href", `/office?show=urgent&session=${shiftId}`);
    await expect(pin).toHaveAttribute("aria-current", "true");
    await pin.click();
    await expect(page).toHaveURL(`${acme}/office?show=urgent&session=${shiftId}`);
    await expect(detail.getByText("Nobody can be offered it right now.")).toBeVisible();
    // The address keeps it: a reload shows the same session.
    await page.reload();
    await expect(page.locator(`[data-chosen="${shiftId}"]`)).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

// Phase 27.4: a venue with two sessions in the view. Its pin picks the first into the card, with a
// row at the card's top, "Step Hall · 1 of 2", and its arrows step to the other (the page then
// loads who can take that one) and back; each is off at its end.
test("a venue with two sessions: its pin picks the first, the card's arrows step through them", async ({
  page,
}, testInfo) => {
  const email = `dashboard.step${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Step Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  // Two sessions at one venue of this spec's own, in a role nobody holds (nobody can take either).
  const { shiftIds } = await addEventWithSession("acme", {
    name: `Step Fair ${n}`,
    site: `Step Hall ${n}`,
    role: "step_check",
    daysAhead: 2,
    also: [3],
    point: { lat: 53.88, lng: -1.52 },
  });
  const [first, second] = shiftIds as [string, string];
  try {
    await officeLogin(page, email);
    // Only this role: one venue on the map, ours, with its two places to fill.
    await page.goto(`${acme}/office?role=step_check`);
    await ready(page);
    const pin = page
      .locator("[data-venue-map]")
      .getByRole("link", { name: new RegExp(`^Step Hall ${n}: 2 places to fill, `) });
    await expect(pin).toHaveAttribute("href", `/office?role=step_check&session=${first}`);
    await pin.click();
    await expect(page).toHaveURL(`${acme}/office?role=step_check&session=${first}`);
    const card = page.locator("[data-chosen]");
    await expect(card).toHaveAttribute("data-chosen", first);
    const before = card.getByRole("button", { name: "The session before" });
    const next = card.getByRole("button", { name: "The next session" });
    const where = card.getByText(new RegExp(`^Step Hall ${n} · \\d of 2$`));
    await expect(where).toHaveText(`Step Hall ${n} · 1 of 2`);
    // Its position is what a screen reader hears when it changes.
    await expect(where).toHaveAttribute("aria-live", "polite");
    await expect(before).toBeDisabled();
    await expect(next).toBeEnabled();
    // The next one: 2 of 2, the address keeps it, and the page loads who can take it.
    await next.click();
    await expect(where).toHaveText(`Step Hall ${n} · 2 of 2`);
    await expect(card).toHaveAttribute("data-chosen", second);
    await expect(page).toHaveURL(`${acme}/office?role=step_check&session=${second}`);
    await expect(card.locator("[data-takers]")).toHaveText("0");
    await expect(card.getByText("Nobody can be offered it right now.")).toBeVisible();
    await expect(next).toBeDisabled();
    await expect(before).toBeEnabled();
    // The keyboard stays on the arrows (an arrow at its end is off, never gone).
    await before.focus();
    await page.keyboard.press("Enter");
    await expect(where).toHaveText(`Step Hall ${n} · 1 of 2`);
    await expect(card).toHaveAttribute("data-chosen", first);
    await expect(before).toBeFocused();
    await expect(before).toBeDisabled();
  } finally {
    for (const id of shiftIds) await cancelOwnShift("acme", id);
  }
});

test("the offer panel lists who can take it as the offer page does; Send offer, then Offered", async ({
  page,
}, testInfo) => {
  // A session, a steward and a resourcer of this spec's own: another spec's bookings can't get in
  // the way, and the seeded resourcer's login links aren't used up.
  const email = `dashboard.panel${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Panel Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  const { shiftId } = await addEventWithSession("acme", {
    name: `Panel Night ${n}`,
    site: `Panel Hall ${n}`,
    role: "steward",
    daysAhead: 12,
  });
  await addSteward("acme", {
    firstName: "Pippa",
    lastName: "Example",
    mobileE164: "+447700900641",
  });
  // Quiet hours off for Acme while the offer goes (an offer that isn't urgent waits for them to
  // end, 22:00 to 07:00, so at night it would never reach Offered), then put back as it was.
  const quietBefore = await setFirmSetting("acme", "quiet_hours", {
    start: "00:00",
    end: "00:00",
    urgent_override: true,
  });
  try {
    await officeLogin(page, email);
    // The offer page's list first.
    await page.goto(`${acme}/office/offer/${shiftId}`);
    await expect(page.getByRole("heading", { name: "Who can take it" })).toBeVisible();
    const onPage = await page
      .getByRole("button", { name: /^Send offer to / })
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(onPage).toContain("Send offer to Pippa Example");
    // How it will reach her, and why (Phase 26.9, off-1): no app notifications on her phone, so
    // a text; and who can't be offered it, and why (off-2). Never WhatsApp.
    const pippa = page.getByRole("listitem").filter({ hasText: "Pippa Example" });
    await expect(pippa.getByText("By text: no app notifications on their phone")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Not offered, and why" })).toBeVisible();
    await expect(page.getByRole("main").getByText(/WhatsApp/)).toHaveCount(0);

    // The dashboard, with the session picked; its paper plane opens the panel.
    await page.goto(`${acme}/office?session=${shiftId}`);
    await ready(page);
    const detail = page.locator(`[data-chosen="${shiftId}"]`);
    const offer = detail.getByRole("link", { name: /^Offer to / });
    await offer.click();
    const panel = page.getByRole("dialog", { name: "Offer this session" });
    await expect(panel).toBeVisible();
    // Focus starts on its heading.
    await expect(panel.getByRole("heading", { name: "Offer this session" })).toBeFocused();
    await expect(panel.getByRole("heading", { name: "Who can take it" })).toBeVisible();
    await expect(panel.getByRole("link", { name: `Steward at Panel Hall ${n}` })).toBeVisible();
    // The same people, in the same order.
    const inPanel = await panel
      .getByRole("button", { name: /^Send offer to / })
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(inPanel).toEqual(onPage);
    // On a phone it comes up from the foot, the width of the screen (once it has slid up: 200ms).
    const view = page.viewportSize();
    await expect
      .poll(async () => {
        const p = await panel.boundingBox();
        return [Math.round((p?.y ?? 0) + (p?.height ?? 0)), Math.round(p?.width ?? 0)];
      })
      .toEqual([view?.height, view?.width]);
    // Send offer: Sending…, then Offered, and the answer at its foot.
    await panel.getByRole("button", { name: "Send offer to Pippa Example" }).click();
    await expect(panel.getByText("Offer on its way to Pippa Example.")).toBeVisible();
    await expect(panel.getByText("Offered", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Send offer to Pippa Example" })).toHaveCount(0);
    // Escape closes it, and focus goes back to what opened it.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(offer).toBeFocused();
    // Once the offer has gone out (the worker sends it), its card says so and who hasn't replied.
    await expect(async () => {
      await page.goto(`${acme}/office?session=${shiftId}`);
      await ready(page);
      await expect(page.locator(`[data-chosen="${shiftId}"]`).getByText("1 offered")).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await expect(
      page
        .locator(`[data-chosen="${shiftId}"]`)
        .getByText(/^Pippa Example hasn't replied since \d\d:\d\d\.$/),
    ).toBeVisible();
    // Back to the dashboard from the offer page too.
    await page.goto(`${acme}/office/offer/${shiftId}`);
    await page.getByRole("link", { name: "Back to the dashboard" }).click();
    await expect(page).toHaveURL(`${acme}/office`);
    await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  } finally {
    await setFirmSetting("acme", "quiet_hours", quietBefore);
    await cancelOwnShift("acme", shiftId);
  }
});

test("the detail card's …: Not urgent takes it off Urgent; Mark as filled, then Open it again", async ({
  page,
}, testInfo) => {
  const email = `dashboard.more${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "More Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  const { shiftId } = await addEventWithSession("acme", {
    name: `More Fair ${n}`,
    site: `More Hall ${n}`,
    role: "more_check",
    daysAhead: 2,
    urgent: true,
  });
  try {
    await officeLogin(page, email);
    await page.goto(`${acme}/office?show=urgent&session=${shiftId}`);
    await ready(page);
    const detail = page.locator(`[data-chosen="${shiftId}"]`);
    const more = detail.locator("summary").first();
    await expect(more).toHaveAttribute("aria-label", /^More for \w+day's more check at \d\d:\d\d$/);
    await more.click();
    await detail.getByRole("button", { name: "Not urgent" }).click();
    await expect(detail.getByRole("status")).toBeVisible();
    // Off the Urgent filter now.
    await page.goto(`${acme}/office?show=urgent`);
    await expect(page.locator(`[data-session="${shiftId}"]`)).toHaveCount(0);
    // Mark as filled asks first, then can be undone.
    await page.goto(`${acme}/office?session=${shiftId}`);
    await ready(page);
    const again = page.locator(`[data-chosen="${shiftId}"]`);
    await again.locator("summary").first().click();
    await again.getByText("Mark as filled", { exact: true }).click();
    await again.getByRole("button", { name: "Yes, mark as filled" }).click();
    await expect(again.getByRole("status")).toHaveText(
      "Marked as filled. Nobody else will be offered it.",
    );
    await again.getByRole("button", { name: "Open it again" }).click();
    await expect(again.getByRole("status")).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test("To offer on the map: every session, soonest first, then View all on Events & sessions", async ({
  page,
}, testInfo) => {
  const email = `dashboard.viewall${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Show Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  // Four never offered, so To offer has more than four: next pay week's Monday to Thursday, so all
  // four are on the map, whatever day this runs (the map holds this pay week and next, Monday to
  // Sunday; 9 to 12 days ahead put the last one out of it from a Wednesday).
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "Europe/London",
  }).format(new Date());
  const toNextMonday = 7 - ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(today);
  const made = [];
  for (let i = 0; i < 4; i++)
    made.push(
      await addEventWithSession("acme", {
        name: `Show Fete ${n}-${i}`,
        site: `Show Hall ${n}-${i}`,
        role: "show_check",
        daysAhead: toNextMonday + i,
        point: { lat: 53.85 + i * 0.03, lng: -1.5 + i * 0.02 },
      }),
    );
  try {
    await officeLogin(page, email);
    await ready(page);
    // The list on the map holds every one (Phase 27.4: the column's first four until then): ours
    // among them, in the order they start.
    const col = await openToOffer(page);
    const total = await countOf(page, "to-offer");
    expect(total).toBeGreaterThan(4);
    const ours = made.map((m) => m.shiftId);
    const listed = await col
      .locator("[data-session]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-session")));
    // (The board holds the first 50 with an offer out and the first 50 without.)
    if (total <= 50) {
      expect(listed.length).toBe(total);
      expect(listed.filter((id) => ours.includes(id ?? ""))).toEqual(ours);
    } else expect(listed.length).toBeGreaterThanOrEqual(50);
    await expect(col.getByRole("link", { name: `View all ${total}` })).toHaveAttribute(
      "href",
      "/office/events?view=need",
    );
    // Filter by the role: only ours, all four, and the map has only their venues.
    await page.locator("summary", { hasText: "Filter" }).click();
    await page.getByRole("link", { name: "Show check" }).click();
    await expect(page).toHaveURL(`${acme}/office?role=show_check`);
    // The menu closes once a role is chosen (it's keyed by the choice), off the map.
    await expect(page.getByRole("link", { name: "Show check", exact: true })).toBeHidden();
    // A new board for the new view: its list shut again until asked for.
    await expect(col).toBeHidden();
    const mine = await openToOffer(page);
    await expect(mine.locator("[data-session]")).toHaveCount(4);
    expect(await countOf(page, "to-offer")).toBe(4);
    await expect(
      page.locator("[data-venue-map]").getByRole("link", { name: /: 1 place to fill/ }),
    ).toHaveCount(4);
  } finally {
    for (const m of made) await cancelOwnShift("acme", m.shiftId);
  }
});

test("Updates: a place a casual took from an offer; Who worked? by name", async ({
  page,
}, testInfo) => {
  const email = `dashboard.night${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Night Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  const { shiftId } = await addEventWithSession("acme", {
    name: `Night Ball ${n}`,
    site: `Night Hall ${n}`,
    role: "steward",
    daysAhead: 4,
  });
  const worker = await addSteward("acme", {
    firstName: "Nadia",
    lastName: `Night${n}`,
    // Its own number on each attempt: a retry would otherwise find the first attempt's casual,
    // under that attempt's name.
    mobileE164: `+44770090069${testInfo.retry}`,
  });
  // Just now, by WhatsApp, so it's the newest of Updates' six whatever the other specs did.
  const at = new Date(Date.now() - 1000);
  await addTakenOffer("acme", { workerId: worker, shiftId, at, channel: "whatsapp" });
  try {
    await officeLogin(page, email);
    const col = column(page, "updates");
    const take = col.getByRole("link", { name: new RegExp(`^Nadia Night${n} took a place `) });
    await expect(take).toHaveAttribute("href", `/office/shifts/${shiftId}`);
    await expect(take).toContainText(`Steward, Night Hall ${n}, `);
    await expect(col.getByRole("link", { name: "All updates" })).toHaveAttribute(
      "href",
      "/office/updates",
    );
    // Who worked?: each person by name with Worked and Didn't attend, each named for its person and
    // session (unique on the page, though one person can be in two groups: aud-5); each group's
    // line a link to its session, or to Needs attention for several.
    const marks = column(page, "who-worked");
    const worked = await marks
      .getByRole("button", { name: / worked, / })
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(worked.length).toBeGreaterThan(0);
    for (const name of worked)
      expect(name).toMatch(/^\S+ \S+ worked, \w{3} \d{1,2} \w{3} \d\d:\d\d$/);
    expect(new Set(worked).size).toBe(worked.length);
    await expect(marks.getByRole("button", { name: / didn't attend, / })).toHaveCount(
      worked.length,
    );
    for (const href of await marks
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href"))))
      expect(href).toMatch(/^\/office\/(shifts\/[0-9a-f-]{36}|needs-attention#to-mark)$/);
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test.describe("on a laptop with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test("the card over the map, the pins with their names, To offer's list on the map's right, two columns in a row, the panel from the side", async ({
    page,
  }, testInfo) => {
    const email = `dashboard.laptop${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Laptop Resourcer", role: "resourcer" });
    await officeLogin(page, email);
    await ready(page);
    // The card over the map, 12px in from its top left corner (round 8); the map 600px tall (Phase
    // 27.4), so the whole card shows without scrolling inside it.
    const map = page.locator("[data-venue-map]");
    const detail = page.locator("[data-chosen]");
    const [m, d] = [await map.boundingBox(), await detail.boundingBox()];
    expect(Math.round(m?.height ?? 0)).toBe(600);
    expect(Math.round((d?.x ?? 0) - (m?.x ?? 0))).toBe(12);
    expect(Math.round((d?.y ?? 0) - (m?.y ?? 0))).toBe(12);
    expect((d?.y ?? 0) + (d?.height ?? 0)).toBeLessThanOrEqual((m?.y ?? 0) + (m?.height ?? 0));
    expect(await detail.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    // Under the map, two columns in one row: Updates and Who worked? (To offer is on the map).
    const tops = await Promise.all(
      ["updates", "who-worked"].map(async (id) =>
        Math.round((await column(page, id).boundingBox())?.y ?? -1),
      ),
    );
    expect(new Set(tops).size).toBe(1);
    await expect(column(page, "to-offer")).toBeHidden();
    // The pins carry their venue's name from a laptop's width where it fits (other specs' venues
    // can crowd the map), and no name covers another, a pin, the card or the open list; the key
    // shows. (A name left off is hidden, keeping its size.)
    const shown = map.locator("[data-pin-label]");
    await expect
      .poll(() =>
        shown.evaluateAll((els) => els.some((e) => getComputedStyle(e).visibility === "visible")),
      )
      .toBe(true);
    const boxes = async () =>
      page.evaluate(() => {
        const r = (el: Element) => {
          const b = el.getBoundingClientRect();
          return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom };
        };
        const labels = [...document.querySelectorAll("[data-venue-map] [data-pin-label]")]
          .filter((el) => getComputedStyle(el).visibility === "visible")
          .map(r);
        const discs = [
          ...document.querySelectorAll("[data-venue-map] a[data-venue] > span:first-child"),
        ].map(r);
        const card = r(document.querySelector("[data-chosen]")!);
        const open = document.querySelector("section#to-offer");
        const list = open && (open as HTMLElement).offsetWidth > 0 ? r(open) : null;
        return { labels, discs, card, list };
      });
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const over = (a: Box, b: Box) =>
      a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1;
    const clear = (b: Awaited<ReturnType<typeof boxes>>) => {
      for (const [i, l] of b.labels.entries()) {
        expect(over(l, b.card)).toBe(false);
        if (b.list) expect(over(l, b.list)).toBe(false);
        for (const other of b.labels.slice(i + 1)) expect(over(l, other)).toBe(false);
        expect(b.discs.filter((disc) => over(l, disc)).length).toBe(0);
      }
    };
    clear(await boxes());
    // The chosen venue's pin always carries its name (when it's on the map).
    const chosenPin = map.locator('a[data-venue][aria-current="true"]');
    if ((await chosenPin.count()) === 1)
      await expect
        .poll(() =>
          chosenPin.evaluate(
            (a) => getComputedStyle(a.querySelector("[data-pin-label]")!).visibility,
          ),
        )
        .toBe("visible");
    const key = map.getByRole("list", { name: "Key" });
    await expect(key).toBeVisible();
    // The map's button top right (12px in, 44px), the key left of it.
    const button = map.getByRole("button", { name: "Show the sessions to offer" });
    const b = await button.boundingBox();
    expect([Math.round(b?.width ?? 0), Math.round(b?.height ?? 0)]).toEqual([44, 44]);
    expect(Math.round((m?.x ?? 0) + (m?.width ?? 0) - ((b?.x ?? 0) + (b?.width ?? 0)))).toBe(12);
    expect(Math.round((b?.y ?? 0) - (m?.y ?? 0))).toBe(12);
    const k = await key.boundingBox();
    expect((k?.x ?? 0) + (k?.width ?? 0)).toBeLessThanOrEqual((b?.x ?? 0) - 8 + 1);
    // To offer's list: on the map's right, under the key and left of the button, inside the map;
    // every session in it; the names move clear of it.
    const list = await openToOffer(page);
    const l = await list.boundingBox();
    expect(Math.round((m?.x ?? 0) + (m?.width ?? 0) - ((l?.x ?? 0) + (l?.width ?? 0)))).toBe(64);
    expect(Math.round((l?.y ?? 0) - (m?.y ?? 0))).toBe(56);
    expect((l?.y ?? 0) + (l?.height ?? 0)).toBeLessThanOrEqual((m?.y ?? 0) + (m?.height ?? 0));
    expect(l?.y ?? 0).toBeGreaterThanOrEqual((k?.y ?? 0) + (k?.height ?? 0));
    await expect
      .poll(async () => {
        try {
          clear(await boxes());
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
    // Pick a row that isn't the card's: the card shows it, then its who-can-take-it from the page.
    const pick = list
      .locator("[data-session]")
      .filter({ hasNot: page.locator('a[aria-current="true"]') })
      .first();
    const id = await pick.getAttribute("data-session");
    await pick.locator('a[href^="/office?"]').click();
    await expect(page.locator(`[data-chosen="${id}"]`)).toBeVisible();
    await expect(page).toHaveURL(`${acme}/office?session=${id}`);
    await expect(page.locator(`[data-chosen="${id}"] [data-takers]`)).toHaveText(/^\d+$/);
    await expect(list).toBeVisible();
    // No sideways scrolling.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    // The panel from the right, the page's height less its margins.
    await detail.getByRole("link", { name: /^Offer to / }).click();
    const panel = page.getByRole("dialog", { name: "Offer this session" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/Loading who can take it/)).toHaveCount(0);
    // Once it has slid in (200ms).
    await expect
      .poll(async () => {
        const p = await panel.boundingBox();
        return [Math.round((p?.x ?? 0) + (p?.width ?? 0)), Math.round(p?.y ?? 0)];
      })
      .toEqual([1280 - 12, 12]);
    // The scrim closes it.
    await page.mouse.click(40, 400);
    await expect(panel).toBeHidden();
  });

  // Phase 23's dashboard (its four count cards, the urgent cards and the six charts' panels)
  // linked to these pages. With it gone, each is still a click away: from the rail, the top bar,
  // the dashboard or the page it belongs to (PLAN.md 24.3).
  test("every page the old dashboard linked to is still a click away", async ({
    page,
  }, testInfo) => {
    // A walk through a dozen pages, each loaded for the first time by the test server (which
    // builds a page on its first visit): longer than one page's 30 seconds.
    test.setTimeout(90_000);
    const email = `dashboard.reach${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Reach Admin", role: "admin" });
    await officeLogin(page, email);
    await ready(page);
    const main = page.getByRole("main");
    const bar = page.getByRole("banner");
    const id = "[0-9a-f-]{36}";
    // Then the pointer moves off what it clicked, as a hand would: a rail link's name stays beside
    // it under the pointer (WCAG 1.4.13) and can sit over the next link.
    const go = async (link: Locator, to: string | RegExp) => {
      await link.click();
      await expect(page).toHaveURL(typeof to === "string" ? `${acme}${to}` : to);
      await page.mouse.move(1270, 790);
    };
    // The detail card: the urgent cards' "Offer to someone" (the offer page, with a modifier key or
    // before the page is ready) and the session's page; from there, the shifts list and its weeks.
    const detail = page.locator("[data-chosen]");
    await expect(detail.getByRole("link", { name: /^Offer to / })).toHaveAttribute(
      "href",
      new RegExp(`^/office/offer/${id}$`),
    );
    await go(
      detail.getByRole("link", { name: "Open the session" }),
      new RegExp(`/office/shifts/${id}$`),
    );
    await go(main.getByRole("link", { name: "Back to sessions" }), "/office/shifts");
    await go(main.getByRole("link", { name: "Later" }), /\/office\/shifts\?from=\d{4}-\d\d-\d\d$/);
    // The top bar's counts: "Urgent shifts not filled", the places charts' "Need people", Needs
    // attention's chart and the pay queries chart.
    await go(bar.getByRole("link", { name: /^To fill \d+$/ }), "/office/events?view=need");
    await go(bar.getByRole("link", { name: /^Urgent \d+$/ }), "/office/events?view=urgent");
    await go(bar.getByRole("link", { name: /^Needs attention \d+$/ }), "/office/needs-attention");
    await go(bar.getByRole("link", { name: /^Pay queries \d+$/ }), "/office/pay-queries");
    // "Events showing to casuals": a filter on Events & sessions again; an event's own page from
    // its card (Phase 24, 24.4).
    await go(await menuLink(page, "Events & sessions"), "/office/events");
    await go(main.getByRole("link", { name: /^Showing \d+$/ }), "/office/events?view=showing");
    await go(
      main.getByRole("link", { name: /^View sessions: / }).first(),
      new RegExp(`/office/events/${id}$`),
    );
    // "Cancellations today" and a cancellation's record.
    await go(await menuLink(page, "Cancellations"), "/office/cancellations");
    const days = main.getByRole("navigation", { name: "Which days" });
    await go(days.getByRole("link", { name: "Today" }), "/office/cancellations?day=today");
    await go(days.getByRole("link", { name: "Every day" }), "/office/cancellations");
    await go(main.locator("[data-record] a:visible").first(), /\/office\/cancellations\/[^/?]+$/);
    // "Enquiries today" and a message: on a laptop beside the list (Phase 24, 24.4); its row is
    // still a link to its own page (a phone's, and with a modifier key).
    await go(await menuLink(page, "Enquiries"), "/office/enquiries");
    await go(main.getByRole("link", { name: "Show only today's" }), "/office/enquiries?day=today");
    await go(main.getByRole("link", { name: /^Show the last \d+ days$/ }), "/office/enquiries");
    const message = main.locator('li a[href^="/office/enquiries/"]').nth(1);
    await expect(message).toHaveAttribute("href", new RegExp(`^/office/enquiries/${id}$`));
    await go(message, new RegExp(`/office/enquiries\\?message=${id}$`));
    await expect(page.locator("#chosen-title")).toHaveText(/^Message from /);
    // Needs attention's "Check uploads" view, and a casual's page.
    await go(await menuLink(page, "Casuals"), "/office/casuals");
    await go(
      main.getByRole("link", { name: /^Uploads to check \d+$/ }),
      "/office/casuals?view=uploads",
    );
    await go(await menuLink(page, "Casuals"), "/office/casuals");
    await go(
      main.locator('a[href^="/office/casuals/"]:visible').first(),
      new RegExp(`/office/casuals/${id}$`),
    );
    // The offers chart's "Open the notice report", its offers chosen.
    await go(await menuLink(page, "Notice report"), "/office/reports/notice");
    await main.getByLabel("What").selectOption("offers");
    await go(
      main.getByRole("button", { name: "Show" }),
      /\/office\/reports\/notice\?(.+&)?kind=offers(&|$)/,
    );
  });
});

test("/office/today opens the dashboard", async ({ page }) => {
  await officeLogin(page, "acme.admin@example.com");
  await page.goto(`${acme}/office/today`);
  await expect(page).toHaveURL(`${acme}/office`);
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
});

test("payroll doesn't get the dashboard, Needs attention or the offer page", async ({ page }) => {
  await officeLogin(page, "acme.payroll@example.com");
  // /office sends payroll to their pay dashboard (12A.3; tests/e2e/office.pay-dashboard.spec.ts).
  await expect(page).toHaveURL(`${acme}/office/pay`);
  await expect(page.getByRole("heading", { name: "Pay dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Venues with places to fill" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Needs attention/ })).toHaveCount(0);
  const response = await page.goto(`${acme}/office/offer/00000000-0000-4000-8000-000000000000`);
  expect(response?.status()).toBe(404);
  // Nor Needs attention's page: their home instead.
  await page.goto(`${acme}/office/needs-attention`);
  await expect(page).toHaveURL(`${acme}/office/pay`);
});
