import type { Page } from "@playwright/test";
import {
  addBookedShift,
  addEventWithSession,
  addOfficeUser,
  addQualifiedCasual,
  addSteward,
  cancelOwnShift,
} from "./db";
import { DASHBOARD_HEADING, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office dashboard in a real browser, on the demo seed (12E.1; docs/screens.md `/office`;
// Phases 18 to 23): a resourcer sees how many things need them (the one count, the same as the
// menu's Needs attention adds up to with the urgent places), the shifts line, the four count
// cards, every urgent place, then six charts (places to fill over the next 2 weeks, a mark for
// each of its 14 days; which events need people; this week's offers; how long things have waited;
// the last 2 weeks' cancellations; licences running out); a count card or a mark opens its rows in
// a panel (a sheet from the foot on a phone, from the side on a laptop: Escape, the scrim and
// Close close it and focus goes back), where today's cancellations are recorded, never approved;
// nothing to approve, decline or deny; Needs attention in the menu opens its page; the offer page
// leads back here; `/office/today` redirects here; payroll is sent to the pay dashboard. (Other
// specs change the seed's numbers, so this one checks the words, the links and that the counts
// add up.) Replaces office.today.spec.ts.

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

const CHARTS = [
  "Places to fill, next 2 weeks",
  "Which events need people",
  "Offers this week",
  "How long things have waited",
  "Cancellations, last 2 weeks",
  "Licences running out, next 8 weeks",
];

// The panel a count card or a mark opens (one native <dialog> on the page), and the page ready
// for it: until it's hydrated a count card is a plain link to its list.
const panelOf = (page: Page) => page.locator('dialog[aria-labelledby="chart-panel-title"]');
async function ready(page: Page) {
  await expect(page.locator("dialog[data-ready]")).toHaveCount(1);
}
const countCard = (page: Page, label: string) =>
  page
    .getByRole("main")
    .getByRole("link")
    .filter({ hasText: new RegExp(`^${label}`) });

test("a resourcer's dashboard: what needs them, the urgent places, six charts, where to start, and nothing to approve", async ({
  page,
}) => {
  await officeLogin(page, "acme.resourcer@example.com");
  // The heading says how many things need you; the page's tab still says Dashboard.
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Dashboard · Acme Events shifts");
  // Acme's shifts line (a fake number from the seed), under the heading.
  await expect(
    page.getByText("Your shifts line: +44 7700 900000 (WhatsApp, text and calls)."),
  ).toBeVisible();

  // Every part loaded (a part that couldn't says so where it shows, and the rest still shows).
  await expect(page.getByText("This couldn't load. Reload the page to try again.")).toHaveCount(0);
  await expect(page.getByText("Couldn't load", { exact: true })).toHaveCount(0);

  // The parts, in order: the urgent places, then the six charts (in place of this week's strip
  // and the three text panels, Phase 23).
  const headings = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(headings).toHaveText(["Urgent places to fill", ...CHARTS]);
  // The places chart: 14 days from today; each day with sessions a button with its full name,
  // its value first.
  const places = page.getByRole("region", { name: CHARTS[0] });
  await expect(places.locator("[data-col]")).toHaveCount(14);
  const marks = places.locator("button[data-col]");
  expect(await marks.count()).toBeGreaterThan(0);
  for (const label of await marks.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")),
  ))
    expect(label).toMatch(
      /^(\d+ places? to fill|Every place filled|\d+ of \d+ filled)\. \w{3} \d{1,2} \w{3}(, today)?(: .+)?\.$/,
    );
  // On a phone it scrolls sideways inside its card (36px a day); the page never does.
  const scroller = places.locator(".overflow-x-auto").first();
  expect(
    await scroller.evaluate((el) => el.scrollWidth > el.clientWidth && el.scrollLeft === 0),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // The cancellations chart reads to today on its right: it starts there.
  const cancels = page.getByRole("region", { name: CHARTS[4] }).locator("[data-scroll-end]");
  await ready(page);
  await expect
    .poll(() => cancels.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft))
    .toBeLessThan(2);
  // Swiped back to its first day, it stays there when only the window's height changes (a phone's
  // toolbar showing or hiding as the page scrolls: a resize with the same width).
  const swiped = await cancels.evaluate((el) => {
    el.scrollLeft = 0;
    const at = el.scrollLeft;
    window.dispatchEvent(new Event("resize"));
    return { room: el.scrollWidth - el.clientWidth, at, after: el.scrollLeft };
  });
  expect(swiped.room).toBeGreaterThan(0);
  expect(swiped).toEqual({ room: swiped.room, at: 0, after: 0 });
  // And when the window really is 56px shorter (once the page has had that resize).
  const phone = page.viewportSize()!;
  await page.evaluate(() =>
    window.addEventListener(
      "resize",
      () => {
        document.body.dataset.resized = String(window.innerHeight);
      },
      { once: true },
    ),
  );
  await page.setViewportSize({ width: phone.width, height: phone.height - 56 });
  await expect.poll(() => page.evaluate(() => document.body.dataset.resized)).toBeDefined();
  expect(await cancels.evaluate((el) => el.scrollLeft)).toBe(0);
  // A new width puts it back at today.
  await page.setViewportSize({ width: phone.width - 20, height: phone.height });
  await expect
    .poll(() => cancels.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft))
    .toBeLessThan(2);
  await page.setViewportSize(phone);

  // The one count adds up: the urgent places plus Needs attention's (its cards' figures).
  const heading = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  const things = Number(/(\d+) things? needs? you/.exec(heading)?.[1] ?? 0);
  const figure = async (label: string) =>
    Number(await countCard(page, label).locator("span").nth(1).textContent());
  const urgent = await figure("Urgent places");
  const attention = await figure("Needs attention");
  expect(things).toBe(urgent + attention);
  // Cancellations are recorded, never approved or declined: nothing on the page does either.
  // (Whole words: the panel's own "never approved or declined" is a statement, not an action.)
  for (const role of ["button", "link"] as const) {
    await expect(page.getByRole(role, { name: /\b(approve|decline|deny)\b/i })).toHaveCount(0);
  }

  // Sorted today: its card opens its list in the panel, a sheet from the foot of a phone, labelled
  // by its title; today's cancellations recorded automatically, never approved or declined.
  const sorted = countCard(page, "Sorted today");
  await expect(sorted).toHaveAttribute("href", "/office/cancellations?day=today");
  await sorted.click();
  const panel = panelOf(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("aria-modal", "true");
  await expect(panel).toHaveAccessibleName(/^\d+ things? sorted today$/);
  await expect(panel.getByRole("button", { name: "Close" })).toBeFocused();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box && [Math.round(box.x), Math.round(box.width), Math.round(box.y + box.height)];
    })
    .toEqual([0, viewport.width, viewport.height]);
  await expect(panel).toContainText("Recorded automatically, never approved or declined.");
  for (const role of ["button", "link"] as const) {
    await expect(panel.getByRole(role, { name: /\b(approve|decline|deny)\b/i })).toHaveCount(0);
  }
  await expect(panel.getByRole("link", { name: /events? showing to casuals/ })).toHaveAttribute(
    "href",
    "/office/events?view=showing",
  );
  await expect(panel.getByRole("link", { name: /enquir(y|ies) today/ })).toHaveAttribute(
    "href",
    "/office/enquiries?day=today",
  );
  // A row opens its list: today's cancellations (the panel closes as it goes).
  await panel.getByRole("link", { name: /cancellations? today/ }).click();
  await expect(page).toHaveURL(`${acme}/office/cancellations?day=today`);
  await expect(page.getByText("Only today's.")).toBeVisible();

  // Needs attention in the menu (the bell's place until Phase 20), with the same count, opens its
  // page.
  // (The demo seed always has some: yesterday's racecourse sessions to mark.)
  expect(attention).toBeGreaterThan(0);
  const item = await menuLink(page, "Needs attention");
  await expect(item).toHaveAttribute("href", "/office/needs-attention");
  await expect(item.locator("xpath=following-sibling::span[1]")).toHaveText(
    `${attention} to deal with`,
  );
  await item.click();
  await expect(page).toHaveURL(`${acme}/office/needs-attention`);
  await expect(page.getByRole("heading", { name: "Needs attention", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Needs attention · Acme Events shifts");
  // Its page says the same count, and the urgent places beside them, so the two add up again.
  await expect(
    page.getByText(
      new RegExp(`^${attention} things? for you\\. Each item links to where it's dealt with\\.$`),
    ),
  ).toBeVisible();
  const also = page.getByRole("region", { name: "Also needs you" });
  await expect(also).toContainText(
    urgent === 0
      ? "No urgent places to fill."
      : new RegExp(`(?<!\\d)${urgent} urgent places? to fill, the first on `),
  );

  // Needs attention's card: its list, each row to where it's dealt with (yesterday's sessions to
  // mark among them), and the way to the whole page.
  await page.goto(`${acme}/office`);
  await ready(page);
  const needs = countCard(page, "Needs attention");
  await expect(needs).toHaveAttribute("href", "/office/needs-attention");
  await needs.click();
  await expect(panel).toHaveAccessibleName(/^\d+\+? things? needs? attention$/);
  await expect(panel.getByRole("link", { name: "Mark who worked" })).toHaveAttribute(
    "href",
    "/office/needs-attention#to-mark",
  );
  await expect(panel.getByRole("link", { name: "Open Needs attention" })).toHaveAttribute(
    "href",
    "/office/needs-attention",
  );
  // Escape closes it, and focus goes back to the card.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(needs).toBeFocused();
  // Waiting on others: a resourcer can't open Pay, so it goes to the waiting chart.
  await expect(countCard(page, "Waiting on others")).toHaveAttribute("href", "#waited-chart");

  // The rota board, from the places chart.
  await places.getByRole("link", { name: "Open the rota board" }).click();
  await expect(page).toHaveURL(`${acme}/office/events`);
  await expect(page.getByRole("heading", { name: "Events & sessions", level: 1 })).toBeVisible();
});

test("the offer page leads back to the dashboard", async ({ page }, testInfo) => {
  // A session, a steward and a resourcer of this spec's own: another spec's bookings can't get in
  // the way, and the seeded resourcer's login links (3 per email every 15 minutes) aren't used up.
  const email = `dashboard.offer${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Dashboard Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  const { shiftId } = await addEventWithSession("acme", {
    name: `Dashboard Offer Night ${n}`,
    site: `Dashboard Hall ${n}`,
    role: "steward",
    daysAhead: 11,
  });
  await addSteward("acme", {
    firstName: "Della",
    lastName: "Example",
    mobileE164: "+447700900641",
  });
  try {
    await officeLogin(page, email);
    await page.goto(`${acme}/office/offer/${shiftId}`);
    await expect(page.getByRole("heading", { name: "Offer this shift" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who can take it" })).toBeVisible();
    const send = page.getByRole("button", { name: /^Send offer to / }).first();
    const name = ((await send.getAttribute("aria-label")) ?? "").replace("Send offer to ", "");
    await send.click();
    await expect(page.getByText(`Offer on its way to ${name}.`)).toBeVisible();
    await page.getByRole("link", { name: "Back to the dashboard" }).click();
    await expect(page).toHaveURL(`${acme}/office`);
    await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test("every urgent place is listed, each with Offer to someone and the rest under …", async ({
  page,
}, testInfo) => {
  // Two urgent places of this spec's own, in a role no casual has (no other spec sees them), and a
  // resourcer of its own.
  const email = `dashboard.focus${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Focus Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  const made = [
    await addEventWithSession("acme", {
      name: `Focus Gala ${n}`,
      site: `Focus Hall ${n}`,
      role: "focus_check",
      daysAhead: 1,
      urgent: true,
    }),
    await addEventWithSession("acme", {
      name: `Focus Fair ${n}`,
      site: `Focus Yard ${n}`,
      role: "focus_check",
      daysAhead: 2,
      urgent: true,
    }),
  ];
  try {
    await officeLogin(page, email);
    const places = page.getByRole("region", { name: "Urgent places to fill" });
    for (const m of made) {
      const row = places.locator("[data-urgent-place]").filter({
        has: page.locator(`a[href="/office/shifts/${m.shiftId}"]`),
      });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("link", { name: "Offer to someone" })).toHaveAttribute(
        "href",
        `/office/offer/${m.shiftId}`,
      );
      // "…" opens the rest: mark as filled, not urgent.
      await expect(row.getByRole("button", { name: "Not urgent" })).toBeHidden();
      await row.locator('summary[aria-label^="More for "]').click();
      await expect(row.getByText("Mark as filled", { exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: "Not urgent" })).toBeVisible();
      // It grows out of its button (Phase 22): from the button's left edge on a phone, from its
      // right edge from 768px, where the buttons end the row.
      const more = row.locator("details[open] > div");
      await expect(more).toHaveCSS("animation-name", "sd-pop");
      await expect(more).toHaveCSS("transform-origin", "0px 0px");
    }
    const phone = page.viewportSize()!;
    await page.setViewportSize({ width: 1280, height: 800 });
    const opened = places.locator("details[open] > div").first();
    const across = await opened.evaluate((el) => (el as HTMLElement).offsetWidth);
    await expect(opened).toHaveCSS("transform-origin", `${across}px 0px`);
    await page.setViewportSize(phone);
    // Soonest first: tomorrow's before the day after's.
    const order = await places
      .locator("[data-urgent-place] a[href^='/office/shifts/']")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(order.indexOf(`/office/shifts/${made[0]!.shiftId}`)).toBeLessThan(
      order.indexOf(`/office/shifts/${made[1]!.shiftId}`),
    );
    // "Not urgent": the place leaves the list, and the answer stays at the foot of the screen.
    const second = places.locator("[data-urgent-place]").filter({
      has: page.locator(`a[href="/office/shifts/${made[1]!.shiftId}"]`),
    });
    await second.getByRole("button", { name: "Not urgent" }).click();
    await expect(second).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "No longer urgent. No more offers will go out." }),
    ).toBeVisible();

    // "Offer": while the offer page is on its way (held back here), a spinner in its word's place
    // (Phase 22); then the page.
    const first = places.locator("[data-urgent-place]").filter({
      has: page.locator(`a[href="/office/shifts/${made[0]!.shiftId}"]`),
    });
    await page.route(new RegExp(`/office/offer/${made[0]!.shiftId}(\\?|$)`), async (route) => {
      const request = route.request();
      if (request.headers()["rsc"] === "1" && request.headers()["next-router-prefetch"] !== "1")
        await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    const offer = first.getByRole("link", { name: "Offer to someone" });
    await expect(offer.locator(".animate-turn")).toHaveCount(0);
    await offer.click();
    await expect(offer.locator(".animate-turn")).toBeVisible();
    await expect(offer.locator(".animate-turn")).toHaveCSS("animation-name", "sd-turn");
    await expect(offer.getByText("Offer", { exact: true })).toHaveCSS("opacity", "0");
    await expect(page).toHaveURL(`${acme}/office/offer/${made[0]!.shiftId}`);
  } finally {
    for (const m of made) await cancelOwnShift("acme", m.shiftId);
  }
});

// With a mouse on a laptop (Phases 22 and 23): a mark's figures over it under the pointer, or when
// the keyboard reaches it, and not otherwise (beside it for a row of bars, so the row above can
// still be pointed at and clicked); the pointer can move onto them, Escape puts them away (WCAG
// 1.4.13), and a click on them goes on to what's under them; picked, its rows in a panel from the
// side, which Escape, the scrim and Close
// close (focus back on the mark), and whose link to a place on this page takes focus there;
// Numbers swaps the chart for its table; without script a count card jumps to its section, which
// shows where it landed, clear of the top bar; a licence's name near the end of the 8 weeks stays
// on its card.
test.describe("on a laptop with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test("a mark's figures under the pointer or on focus; its rows in a panel from the side; Numbers", async ({
    page,
  }, testInfo) => {
    const email = `dashboard.laptop${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Laptop Resourcer", role: "resourcer" });
    await officeLogin(page, email);
    await ready(page);

    const places = page.getByRole("region", { name: CHARTS[0] });
    const marks = places.locator("button[data-col]");
    expect(await marks.count()).toBeGreaterThan(1);
    const mark = marks.first();
    const tip = page.locator('[role="tooltip"]');
    // Its words: the mark's own name (the value, then what it is).
    await expect(tip).toBeHidden();
    await mark.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveCSS("animation-name", "sd-pop");
    await expect(tip).toHaveText((await mark.getAttribute("aria-label"))!);
    // The pointer can move from the mark onto them (across the 8px between) and they stay, to be
    // read; Escape puts them away with the pointer still there.
    const over = (await tip.boundingBox())!;
    await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2, { steps: 12 });
    await expect.poll(() => tip.evaluate((el) => el.matches(":hover"))).toBe(true);
    await page.waitForTimeout(300); // longer than the moment it waits once the pointer leaves
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText((await mark.getAttribute("aria-label"))!);
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    // The next time the pointer comes to the mark they're back; off the mark, they go.
    await mark.hover();
    await expect(tip).toBeVisible();
    await page.mouse.move(640, 5);
    await expect(tip).toBeHidden();
    // The keyboard: from Numbers, the next stop is the first day with sessions.
    await places.getByRole("button", { name: "Numbers" }).focus();
    await page.keyboard.press("Tab");
    await expect(mark).toBeFocused();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText((await mark.getAttribute("aria-label"))!);
    // Escape puts them away and focus stays on the mark; the next mark shows its own.
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await expect(mark).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(marks.nth(1)).toBeFocused();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText((await marks.nth(1).getAttribute("aria-label"))!);
    await marks.nth(1).evaluate((el) => (el as HTMLElement).blur());
    await expect(tip).toBeHidden();

    // Picked: its rows in a panel from the right, the page's full height, labelled by its title;
    // the day's sessions and the rota board at its foot.
    await mark.click();
    const panel = panelOf(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-modal", "true");
    await expect(panel).toHaveAccessibleName(/^\w{3} \d{1,2} \w{3}: /);
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return box && [Math.round(box.x + box.width), Math.round(box.y), Math.round(box.height)];
      })
      .toEqual([1280, 0, 800]);
    await expect(panel.getByRole("link", { name: "See this day's sessions" })).toHaveAttribute(
      "href",
      /^\/office\/shifts\?from=\d{4}-\d\d-\d\d$/,
    );
    await expect(panel.getByRole("link", { name: "Open the rota board" })).toHaveAttribute(
      "href",
      "/office/events",
    );
    // Escape closes it; focus goes back to the mark.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(mark).toBeFocused();
    // The scrim closes it.
    await mark.click();
    await expect(panel).toBeVisible();
    await page.mouse.click(200, 400);
    await expect(panel).toBeHidden();
    // So does Close.
    await mark.click();
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toBeHidden();
    await expect(mark).toBeFocused();

    // Numbers: the chart's table in its place, and back.
    const numbers = places.getByRole("button", { name: "Numbers" });
    await expect(numbers).toHaveAttribute("aria-pressed", "false");
    await expect(places.getByRole("table")).toBeHidden();
    await numbers.click();
    await expect(numbers).toHaveAttribute("aria-pressed", "true");
    await expect(places.getByRole("table")).toBeVisible();
    await expect(places.getByRole("columnheader")).toHaveText([
      "Day",
      "Urgent",
      "To fill",
      "Filled",
      "Places",
    ]);
    await expect(mark).toBeHidden();
    await numbers.click();
    await expect(places.getByRole("table")).toBeHidden();
    await expect(mark).toBeVisible();
  });

  // A row of bars has its figures beside it, never over the row above or below: the pointer moving
  // straight up from one row's bar to the next gets that row's figures, and a click there opens
  // that row's panel. A click on the figures themselves puts them away and goes on to what's under
  // them, so a click is never lost.
  test("a row's figures sit beside it: the pointer and a click reach the row above", async ({
    page,
  }, testInfo) => {
    const email = `dashboard.rows${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Rows Resourcer", role: "resourcer" });
    await officeLogin(page, email);
    await ready(page);

    const events = page.getByRole("region", { name: CHARTS[1] });
    const rows = events.getByRole("button", { name: /^\d+ places? to fill\. / });
    expect(await rows.count()).toBeGreaterThan(1);
    const [first, second] = [rows.nth(0), rows.nth(1)];
    const labels = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? ""),
    );
    // Each event's name, in the same order (the Numbers table's rows), and so its panel's title:
    // "3 places to fill. Riverside Fair." opens "Riverside Fair: 3 places to fill".
    const names = await events.getByRole("rowheader", { includeHidden: true }).allTextContents();
    expect(names).toHaveLength(labels.length);
    const title = (i: number) => {
      const label = labels[i] ?? "";
      const value = label.slice(0, label.indexOf(". "));
      expect(label.startsWith(`${value}. ${names[i] ?? ""}`)).toBe(true);
      return `${names[i] ?? ""}: ${value}`;
    };
    expect(title(0)).not.toBe(title(1));

    const tip = page.locator('[role="tooltip"]');
    const settled = () =>
      tip.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => true));
    const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
    // Mid-window, so nothing is held in from the window's edges.
    await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const above = (await first.boundingBox())!;
    const below = (await second.boundingBox())!;
    // The second row's bar, near where every row's bar starts.
    const bar = (await second.locator("span[style]").first().boundingBox())!;
    const x = bar.x + Math.min(8, bar.width / 2);

    await page.mouse.move(x, middle(below));
    await expect(tip).toHaveText(labels[1] ?? "");
    await settled();
    // Beside its row (to its right: the events chart is the left one of two), 8px clear of it
    // and level with its middle, so none of it is over the row above.
    await expect(tip).toHaveAttribute("data-side", "right");
    const at = (await tip.boundingBox())!;
    expect(Math.abs(at.x - (below.x + below.width) - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(middle(at) - middle(below))).toBeLessThanOrEqual(1);

    // Straight up to the first row's bar: its figures, and a click there opens its panel.
    await page.mouse.move(x, middle(above), { steps: 8 });
    await expect(tip).toHaveText(labels[0] ?? "");
    await page.mouse.down();
    await page.mouse.up();
    const panel = panelOf(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAccessibleName(title(0));
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(first).toBeFocused();

    // Onto the figures (across the 8px between) and a click on them: they go at once, and the
    // click goes on to what's under them (here the chart's own card), so it's never lost.
    await page.mouse.move(x + 1, middle(above));
    await expect(tip).toHaveText(labels[0] ?? "");
    await settled();
    const on = (await tip.boundingBox())!;
    const spot = { x: on.x + 4, y: middle(on) };
    await page.mouse.move(spot.x, spot.y, { steps: 12 });
    await expect.poll(() => tip.evaluate((el) => el.matches(":hover"))).toBe(true);
    // What's under that spot (the figures put aside for a moment), told to note a click.
    const under = await tip.evaluate((el, p) => {
      const t = el as HTMLElement;
      t.hidden = true;
      const found = document.elementFromPoint(p.x, p.y);
      t.hidden = false;
      found?.addEventListener(
        "click",
        () => {
          document.body.dataset.clickedUnder = "yes";
        },
        { once: true },
      );
      return found?.closest("section")?.getAttribute("aria-labelledby") ?? null;
    }, spot);
    expect(under).toBe("events-chart");
    await page.mouse.down();
    await page.mouse.up();
    await expect(tip).toBeHidden();
    expect(await page.evaluate(() => document.body.dataset.clickedUnder)).toBe("yes");
    await expect(panel).toBeHidden();
  });

  test("a count card's own link: its section, which shows where it landed", async ({
    page,
  }, testInfo) => {
    const email = `dashboard.landed${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Landing Resourcer", role: "resourcer" });
    await officeLogin(page, email);
    // Without script a card is a plain link (it opens its list in the panel once the page is
    // ready): the urgent places' to its section, a resourcer's waiting card to the waiting chart.
    await expect(countCard(page, "Urgent places")).toHaveAttribute("href", "#urgent-places");
    await expect(countCard(page, "Waiting on others")).toHaveAttribute("href", "#waited-chart");
    for (const [hash, name] of [
      ["urgent-places", "Urgent places to fill"],
      ["waited-chart", CHARTS[3]!],
    ] as const) {
      await page.goto(`${acme}/office#${hash}`);
      const landed = page.locator("section:has(:target)");
      await expect(landed).toHaveCount(1);
      await expect(landed).toHaveCSS("animation-name", "sd-landed");
      const heading = page.getByRole("heading", { name, level: 2 });
      await expect(heading).toBeInViewport();
      // Clear of the 64px top bar (the office's scroll padding).
      const bar = (await page.getByRole("banner").boundingBox())!;
      expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    }
  });

  // A resourcer can't open Pay, so Waiting on others' panel ends with a link to the waiting chart
  // on this page. Followed from the keyboard, the panel closes, the page goes to the chart, and
  // focus goes there too (not back to the card at the top), so the next Tab goes on from it.
  test("a link in the panel to a place on this page: focus lands there, not back on the card", async ({
    page,
  }, testInfo) => {
    const email = `dashboard.place${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Place Resourcer", role: "resourcer" });
    await officeLogin(page, email);
    await ready(page);
    const waiting = countCard(page, "Waiting on others");
    await waiting.click();
    const panel = panelOf(page);
    await expect(panel).toBeVisible();
    const go = panel.getByRole("link", { name: "See how long things have waited" });
    await expect(go).toHaveAttribute("href", "#waited-chart");
    await go.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(`${acme}/office#waited-chart`);
    const heading = page.getByRole("heading", { name: CHARTS[3], level: 2 });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(waiting).not.toBeFocused();
    await page.keyboard.press("Tab");
    expect(
      await heading.evaluate((h) =>
        Boolean(
          h.compareDocumentPosition(document.activeElement!) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
    ).toBe(true);
    // Closed any other way, focus still goes back to the card that opened it.
    await waiting.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(waiting).toBeFocused();
  });

  // A licence booked after it runs out, late in the 8 weeks: its casual's name (shown from 640px)
  // sits to the left of its dot, so it stays on the card and the page never scrolls sideways.
  test("a licence's name near the end of the 8 weeks stays on its card: nothing scrolls sideways", async ({
    page,
  }, testInfo) => {
    const email = `dashboard.licence${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Licence Resourcer", role: "resourcer" });
    // A casual of this test's own (a made-up name and number): their steward qualification runs
    // out in 53 days, and they're booked the day after. A number no other spec or the seed uses or
    // makes: she stays in the e2e database, and office.workers.spec.ts takes 07700 900881 to
    // 900884 (two a try, one retry on CI), gdpr.spec.ts 900871 and office.look.spec.ts 900877.
    const casual = {
      firstName: "Harriet",
      lastName: "Endersby-Lowe",
      mobileE164: "+447700900879",
    };
    const workerId = await addQualifiedCasual("acme", casual, {
      roles: ["steward"],
      held: [{ type: "STEWARD_L2", daysAhead: 53 }],
    });
    const { shiftId } = await addBookedShift("acme", {
      workerId,
      daysAhead: 54,
      site: `Late Licence Hall ${Date.now() % 100_000}`,
    });
    try {
      await officeLogin(page, email);
      const licences = page.getByRole("region", { name: CHARTS[5] });
      const dot = licences.getByRole("button", { name: /Harriet Endersby-Lowe/ });
      const name = licences.locator('span[aria-hidden="true"]', {
        hasText: "Harriet Endersby-Lowe",
      });
      await expect(dot).toHaveCount(1);
      await expect(name).toHaveCount(1);
      for (const width of [640, 1024]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(name).toBeVisible();
        const at = (await dot.boundingBox())!;
        const box = (await name.boundingBox())!;
        // Its right edge 16px before the dot's centre.
        expect(Math.abs(box.x + box.width - (at.x + at.width / 2 - 16)), `${width}px`).toBeLessThan(
          1,
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${width}px`,
        ).toBe(true);
      }
    } finally {
      await cancelOwnShift("acme", shiftId);
      // Not left as a steward other specs could offer to.
      await addQualifiedCasual("acme", casual, { roles: ["steward"], held: [] });
    }
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
  await expect(page.getByRole("heading", { name: "Urgent places to fill" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Needs attention/ })).toHaveCount(0);
  const response = await page.goto(`${acme}/office/offer/00000000-0000-4000-8000-000000000000`);
  expect(response?.status()).toBe(404);
  // Nor Needs attention's page: their home instead.
  await page.goto(`${acme}/office/needs-attention`);
  await expect(page).toHaveURL(`${acme}/office/pay`);
});
