import type { Locator, Page } from "@playwright/test";
import { lastNight } from "../../src/lib/office/dashboard-board";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  addTakenOffer,
  cancelOwnShift,
  setFirmSetting,
} from "./db";
import { DASHBOARD_HEADING, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office dashboard in a real browser, on the demo seed (Phase 24, 24.3: round 7 of the canvas;
// docs/screens.md `/office`): "Dashboard" with the day, the pay week and its pay day; the track
// (All, Urgent, This week, Next week, each with its count, the columns adding up to it); the
// places chart, a bar a day for this week and next, its numbers under the pointer (Escape puts
// them away) and in a table; the detail card for the chosen session, a card picking itself into
// it; the board's four columns, "Show N more" showing the rest; the offer panel (from the foot on
// a phone, the side on a laptop) listing who can take a session as the offer page does, Send
// offer, then Offered; the detail card's "…" with Not urgent and Mark as filled; While you were
// out with a place a casual took last night; Who worked? to where it's marked; nothing to
// approve, decline or deny; the offer page leads back here; `/office/today` redirects here;
// payroll is sent to the pay dashboard. (Other specs change the seed's numbers, so this one checks
// the words, the links, and that the counts add up on one page.)

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

test("a resourcer's dashboard: its head, the track adding up, the chart, the detail card, four columns, and nothing to approve", async ({
  page,
}) => {
  await officeLogin(page, "acme.resourcer@example.com");
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Dashboard · Acme Events shifts");
  // Under it, today, the pay week and its pay day (and, with a planner or sheet, when it last
  // sent changes: the demo has neither).
  await expect(
    page
      .getByRole("main")
      .getByText(
        /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+ · Week \d{1,2} · Pay Fri \d{1,2} [A-Z][a-z]{2}$/,
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
  // The two place columns hold every session the track counts.
  expect((await countOf(page, "to-offer")) + (await countOf(page, "offered"))).toBe(all);

  // The headings, in order: the chart, the chosen session, the four columns.
  const headings = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(headings.first()).toHaveText("Places to fill");
  await expect(
    headings.filter({ hasText: /^(To offer|Offered|While you were out|Who worked\?)$/ }),
  ).toHaveText(["To offer", "Offered", "While you were out", "Who worked?"]);
  // The chart: a bar a day for this week and next, its numbers read out as a table.
  const chart = page.locator("section#places-chart");
  await expect(chart.locator("[data-day]")).toHaveCount(14);
  await expect(chart.getByRole("table")).toHaveCount(1);
  await expect(chart.getByRole("row")).toHaveCount(15);
  await expect(chart.getByRole("link", { name: "Open Events & sessions" })).toHaveAttribute(
    "href",
    "/office/events?view=need",
  );
  // The detail card: a session with places to fill, its two buttons and its "…".
  const detail = page.locator("[data-chosen]");
  await expect(detail.getByRole("link", { name: "Offer to someone" })).toBeVisible();
  await expect(detail.getByRole("link", { name: "Open the shift" })).toHaveAttribute(
    "href",
    /^\/office\/shifts\/[0-9a-f-]{36}$/,
  );
  await expect(detail.getByText(/^Starts in$/)).toBeVisible();
  await expect(detail.getByText(/^Offers sent$/)).toBeVisible();

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

test("the track filters the board, and a card picks itself into the detail card (kept on reload)", async ({
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
    expect((await countOf(page, "to-offer")) + (await countOf(page, "offered"))).toBe(urgent);
    // Every card under Urgent is urgent: its pick names it so.
    const picks = page.locator("section#to-offer, section#offered").locator('a[href^="/office?"]');
    for (const label of await picks.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    ))
      expect(label).toMatch(/^Urgent\. /);

    // Pick ours (it's never been offered: To offer, maybe past the first three).
    await ready(page);
    const more = column(page, "to-offer").getByRole("button", { name: /^Show \d+ more$/ });
    if (await more.count()) await more.click();
    const card = page.locator(`[data-session="${shiftId}"]`);
    const pick = card.locator('a[href^="/office?"]');
    await expect(pick).toHaveAttribute("aria-label", /^Urgent\. Pick check, Pick Gala \d+, /);
    await pick.click();
    await expect(page).toHaveURL(`${acme}/office?show=urgent&session=${shiftId}`);
    await expect(pick).toHaveAttribute("aria-current", "true");
    const detail = page.locator(`[data-chosen="${shiftId}"]`);
    await expect(detail.getByRole("heading", { level: 2 })).toContainText("Pick check");
    await expect(detail.getByRole("heading", { level: 2 }).getByText("Urgent")).toBeVisible();
    await expect(detail.getByText(`Pick Gala ${n} · Pick Hall ${n}`)).toBeVisible();
    await expect(detail.getByText("Not offered to anyone yet.")).toBeVisible();
    await expect(detail.getByText("Not offered yet")).toBeVisible();
    // The address keeps it: a reload shows the same session.
    await page.reload();
    await expect(page.locator(`[data-chosen="${shiftId}"]`)).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
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

    // The dashboard, with the session picked; its paper plane opens the panel.
    await page.goto(`${acme}/office?session=${shiftId}`);
    await ready(page);
    const detail = page.locator(`[data-chosen="${shiftId}"]`);
    const offer = detail.getByRole("link", { name: "Offer to someone" });
    await offer.click();
    const panel = page.getByRole("dialog", { name: "Offer this shift" });
    await expect(panel).toBeVisible();
    // Focus starts on its heading.
    await expect(panel.getByRole("heading", { name: "Offer this shift" })).toBeFocused();
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
    // Once the offer has gone out (the worker sends it), the session waits on Offered (past its
    // first three cards, perhaps), and its card says who hasn't replied.
    await expect(async () => {
      await page.goto(`${acme}/office?session=${shiftId}`);
      await ready(page);
      const more = column(page, "offered").getByRole("button", { name: /^Show \d+ more$/ });
      if (await more.count()) await more.click();
      await expect(column(page, "offered").locator(`[data-session="${shiftId}"]`)).toHaveCount(1);
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

test("Show N more shows the rest of a column, and focus goes to the first it showed", async ({
  page,
}, testInfo) => {
  const email = `dashboard.showmore${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Show Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  // Four never offered, so To offer has more than three.
  const made = [];
  for (let i = 0; i < 4; i++)
    made.push(
      await addEventWithSession("acme", {
        name: `Show Fete ${n}-${i}`,
        site: `Show Hall ${n}-${i}`,
        role: "show_check",
        daysAhead: 9 + i,
      }),
    );
  try {
    await officeLogin(page, email);
    await ready(page);
    const col = column(page, "to-offer");
    const cards = col.locator("[data-session]");
    await expect(cards).toHaveCount(3);
    const total = await countOf(page, "to-offer");
    const more = col.getByRole("button", { name: `Show ${total - 3} more` });
    await more.click();
    await expect(cards).toHaveCount(Math.min(total, 50));
    await expect(more).toHaveCount(0);
    await expect(page.locator("#to-offer-card-3")).toBeFocused();
  } finally {
    for (const m of made) await cancelOwnShift("acme", m.shiftId);
  }
});

test("While you were out: a place a casual took from an offer last night; Who worked? to where it's marked", async ({
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
    mobileE164: "+447700900690",
  });
  // A minute into last night (18:00 to 08:00 London; tonight's, just after 18:00), by WhatsApp.
  const now = new Date();
  const { from } = lastNight(now, "Europe/London");
  const at = new Date(Math.min(from.getTime() + 60_000, now.getTime() - 1000));
  await addTakenOffer("acme", { workerId: worker, shiftId, at, channel: "whatsapp" });
  try {
    await officeLogin(page, email);
    const col = column(page, "while-you-were-out");
    const take = col.getByRole("link", {
      name: new RegExp(
        `^Nadia Night${n} took steward, Night Ball ${n}, .+: said yes at 18:0[01] by WhatsApp\\. Open the shift\\.$`,
      ),
    });
    await expect(take).toHaveAttribute("href", `/office/shifts/${shiftId}`);
    await expect(col.getByText(`Nadia Night${n} said yes`)).toBeVisible();
    await expect(col.getByText(/^18:0[01] · WhatsApp$/)).toBeVisible();
    // Who worked?: each card is a link to where its sessions are marked.
    const marks = column(page, "who-worked").getByRole("link");
    for (const href of await marks.evaluateAll((els) => els.map((e) => e.getAttribute("href"))))
      expect(href).toMatch(/^\/office\/(shifts\/[0-9a-f-]{36}|needs-attention#to-mark)$/);
    for (const name of await marks.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    ))
      expect(name).toMatch(/^Mark who worked: .+ to mark$/);
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test.describe("on a laptop with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test("the chart beside the detail card, four columns in a row, a bar's figures under the pointer (Escape puts them away), the panel from the side", async ({
    page,
  }, testInfo) => {
    const email = `dashboard.laptop${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Laptop Resourcer", role: "resourcer" });
    await officeLogin(page, email);
    await ready(page);
    // The chart and the detail card side by side; the columns in one row.
    const chart = page.locator("section#places-chart");
    const detail = page.locator("[data-chosen]");
    const [c, d] = [await chart.boundingBox(), await detail.boundingBox()];
    expect(Math.round(c?.y ?? 0)).toBe(Math.round(d?.y ?? 1));
    expect((c?.x ?? 0) + (c?.width ?? 0)).toBeLessThan(d?.x ?? 0);
    const tops = await Promise.all(
      ["to-offer", "offered", "while-you-were-out", "who-worked"].map(async (id) =>
        Math.round((await column(page, id).boundingBox())?.y ?? -1),
      ),
    );
    expect(new Set(tops).size).toBe(1);
    // A bar's figures: under the pointer, still there on the tip itself, gone with Escape.
    const day = chart.locator("[data-day]").nth(3);
    const tip = day.locator("[data-bar-tip]");
    await expect(tip).toBeHidden();
    await day.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(/^\w{3} \d{1,2}: (nothing to fill|.+)$/);
    await tip.hover();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    // The next day's shows again.
    await chart.locator("[data-day]").nth(4).hover();
    await expect(chart.locator("[data-day]").nth(4).locator("[data-bar-tip]")).toBeVisible();
    // The panel from the right, the page's height less its margins.
    await detail.getByRole("link", { name: "Offer to someone" }).click();
    const panel = page.getByRole("dialog", { name: "Offer this shift" });
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
    await expect(detail.getByRole("link", { name: "Offer to someone" })).toHaveAttribute(
      "href",
      new RegExp(`^/office/offer/${id}$`),
    );
    await go(
      detail.getByRole("link", { name: "Open the shift" }),
      new RegExp(`/office/shifts/${id}$`),
    );
    await go(main.getByRole("link", { name: "Back to shifts" }), "/office/shifts");
    await go(main.getByRole("link", { name: "Later" }), /\/office\/shifts\?from=\d{4}-\d\d-\d\d$/);
    // The top bar's counts: "Urgent shifts not filled", the places charts' "Need people", Needs
    // attention's chart and the pay queries chart.
    await go(bar.getByRole("link", { name: /^To fill \d+$/ }), "/office/events?view=need");
    await go(bar.getByRole("link", { name: /^Urgent \d+$/ }), "/office/events?view=urgent");
    await go(bar.getByRole("link", { name: /^To check \d+$/ }), "/office/needs-attention");
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
    await go(
      main.getByRole("link", { name: "Show only today's" }),
      "/office/cancellations?day=today",
    );
    await go(main.getByRole("link", { name: "Show every day" }), "/office/cancellations");
    await go(
      main.locator('li a[href^="/office/cancellations/"]').first(),
      /\/office\/cancellations\/[^/?]+$/,
    );
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
  await expect(page.getByRole("heading", { name: "Places to fill" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Needs attention/ })).toHaveCount(0);
  const response = await page.goto(`${acme}/office/offer/00000000-0000-4000-8000-000000000000`);
  expect(response?.status()).toBe(404);
  // Nor Needs attention's page: their home instead.
  await page.goto(`${acme}/office/needs-attention`);
  await expect(page).toHaveURL(`${acme}/office/pay`);
});
