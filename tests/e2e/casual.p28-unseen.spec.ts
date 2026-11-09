import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { setFirmSetting } from "./db";
import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo } from "./outbox";
import { endUnseenScene, P28_16_RHEA, P28_16_TYPED, unseenScene } from "./p28/28-16-data";

// Phase 28.16 (docs/screens.md "### 28.16"): the pages the review couldn't see (its gaps list),
// in a real browser, as a made-up casual of this spec's own (tests/e2e/p28/28-16-data.ts), on a
// phone (390px) and Dylan's laptop (1,280px at 150%), light and dark:
//   - /login and /l (logged out: the link's page, before "Log me in");
//   - /pay after the code, and /pay/query with the code;
//   - /profile/upload/[type];
//   - the cancel sheet ("Can't make it?" on Booked) and the "You're booked." cover;
//   - a shift's page held (Acme's fair rotation: she has more hours that week than others who
//     could work it; its window widened to 4 hours for these screenshots, so a slow run can't
//     outlast it), blocked (she's already booked then) and ask ("Casuals ask, you choose": "I can
//     do this").
// Each is screenshotted (attached to the run's report) and checked: no gradient anywhere on the
// page (a flat fill drawn as a gradient whose stops are all one colour counts as flat: the glass
// tiles' and buttons' utilities), the current tab solid ink where the page has the tab bar, and
// every control she can tap at least 44px tall and wide.

const acme = "http://acme.localhost:3100";
const IP = "10.240.28.16";

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;
type Size = (typeof SIZES)[number];
type Theme = (typeof THEMES)[number];
type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

// What the checks read off a page, in the browser.
async function looks(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false; // sr-only, or folded away
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && !el.closest("[inert]");
    };
    const describe = (el: Element) =>
      `<${el.tagName.toLowerCase()}> "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 40)}"`;

    // A gradient with more than one colour in it (a real one, not a flat fill).
    const gradients: string[] = [];
    for (const el of document.querySelectorAll("*")) {
      const image = getComputedStyle(el).backgroundImage;
      if (!image.includes("gradient(")) continue;
      const stops = new Set(
        [...image.matchAll(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/g)].map((m) => m[0]),
      );
      if (stops.size > 1) gradients.push(`${describe(el)}: ${image}`);
    }

    // The current tab: its fill and words against --color-ink and --color-on-ink.
    const nav = document.querySelector('nav[aria-label="Main"]');
    const current = nav && visible(nav) ? nav.querySelector('a[aria-current="page"]') : null;
    // Phase 32 (32.1): the ink is on the current tab's round button.
    const circle = current?.querySelector("[data-tab-circle]") ?? null;
    const probe = document.createElement("i");
    probe.style.backgroundColor = "var(--color-ink)";
    probe.style.color = "var(--color-on-ink)";
    document.body.append(probe);
    const ink = getComputedStyle(probe).backgroundColor;
    const onInk = getComputedStyle(probe).color;
    probe.remove();
    const tab = current
      ? {
          name: (current.textContent ?? "").trim(),
          fill: circle ? getComputedStyle(circle).backgroundColor : "",
          words: circle ? getComputedStyle(circle).color : "",
          image: circle ? getComputedStyle(circle).backgroundImage : "",
        }
      : null;

    // Every control she can tap: links, buttons, summaries, fields, and the labels that stand for
    // their own radio, checkbox or file input.
    const small: string[] = [];
    const controls = document.querySelectorAll(
      [
        "a[href]",
        "button",
        "summary",
        "select",
        "textarea",
        'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"])',
        'label:has(input[type="radio"], input[type="checkbox"], input[type="file"])',
      ].join(", "),
    );
    for (const el of controls) {
      if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5)
        small.push(`${describe(el)}: ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return { gradients, tab, ink, onInk, small };
  });
}

async function check(page: Page, where: string, tab: string | null) {
  const look = await looks(page);
  expect(look.gradients, `${where}: no gradient`).toEqual([]);
  expect(look.small, `${where}: 44px targets`).toEqual([]);
  if (tab) expect(look.tab?.name, `${where}: the current tab`).toContain(tab);
  if (look.tab) {
    expect(look.tab.fill, `${where}: the current tab in ink`).toBe(look.ink);
    expect(look.tab.words, `${where}: its words`).toBe(look.onInk);
    expect(look.tab.image, `${where}: no gradient on it`).toBe("none");
  }
}

test("the unseen pages: login and the link, Pay with the code, an upload, the cancel sheet, You're booked, and a held, blocked and ask shift, phone and laptop, light and dark", async ({
  browser,
}, testInfo) => {
  test.setTimeout(480_000);
  const scene = await unseenScene();
  const inContext = async (
    size: Size,
    theme: Theme,
    session: Session | null,
    work: (page: Page) => Promise<void>,
  ) => {
    const context = await browser.newContext({
      ...(session ? { storageState: session } : {}),
      viewport: size.viewport,
      deviceScaleFactor: size.scale,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      colorScheme: theme,
      locale: "en-GB",
      extraHTTPHeaders: { "x-real-ip": IP },
    });
    try {
      await work(await context.newPage());
    } finally {
      await context.close();
    }
  };
  const each = async (
    session: Session | null,
    work: (page: Page, where: (w: string) => string, label: string, i: number) => Promise<void>,
  ) => {
    let i = 0;
    for (const size of SIZES)
      for (const theme of THEMES) {
        const n = i++;
        await inContext(size, theme, session, (page) =>
          work(
            page,
            (w) => `${w} at ${size.name} (${size.viewport.width}px), ${theme}`,
            `${size.name} ${theme}`,
            n,
          ),
        );
      }
  };

  try {
    // Logged out: /login at each size, then one login link, whose page (/l) is shot at each size
    // before it's used, once, to log in (one link a run: the login limit counts them).
    await each(null, async (page, where, label) => {
      await page.goto(`${acme}/login`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Log in to Acme Events" }),
      ).toBeVisible();
      await expect(page.getByLabel("Your mobile number")).toBeVisible();
      await check(page, where("/login"), null);
      await shoot(page, testInfo, `28.16 login ${label}`);
    });
    let link = "";
    await inContext(SIZES[0], "light", null, async (page) => {
      const asked = new Date(Date.now() - 1000);
      await page.goto(`${acme}/login`);
      await page.getByLabel("Your mobile number").fill(P28_16_TYPED);
      await page.getByRole("button", { name: "Send me a link" }).click();
      await expect(page.getByText(/^Check your phone\./)).toBeVisible();
      link = await loginLinkSentTo(P28_16_RHEA.mobileE164, asked);
    });
    await each(null, async (page, where, label) => {
      await page.goto(link);
      await expect(page.getByRole("button", { name: "Log me in" })).toBeVisible();
      await check(page, where("/l"), null);
      await shoot(page, testInfo, `28.16 link ${label}`);
    });
    const session = await logIn(browser, link);

    // Pay: the code once (the session stays open for 30 minutes), then both pages at each size.
    await inContext(SIZES[0], "light", session, async (page) => {
      await page.goto(`${acme}/pay/query?shift=${scene.worked}`);
      const asked = new Date(Date.now() - 1000);
      await page.getByRole("button", { name: "Send me a code" }).click();
      await page.getByLabel("Your code").fill(await codeSentTo(P28_16_RHEA.mobileE164, asked));
      await page.getByRole("button", { name: "Check code" }).click();
      await expect(page).toHaveURL(`${acme}/pay/query?shift=${scene.worked}`);
      await expect(page.getByLabel("Which shift?")).toHaveValue(scene.worked);
    });
    await each(session, async (page, where, label) => {
      await page.goto(`${acme}/pay`);
      await expect(page.getByRole("heading", { level: 2, name: /^Pay day: / })).toBeVisible();
      await expect(page.getByText("The last 8 weeks, from Acme Events' payroll.")).toBeVisible();
      await check(page, where("/pay after the code"), "Pay");
      await shoot(page, testInfo, `28.16 pay after the code ${label}`);

      await page.goto(`${acme}/pay/query?shift=${scene.worked}`);
      await expect(page.getByLabel("Which shift?")).toHaveValue(scene.worked);
      await check(page, where("/pay/query with the code"), "Pay");
      await shoot(page, testInfo, `28.16 pay query with the code ${label}`);

      // The upload page.
      await page.goto(`${acme}/profile/upload/STEWARD_L2`);
      await expect(page.getByRole("heading", { level: 1, name: /^Upload your / })).toBeVisible();
      await check(page, where("/profile/upload/STEWARD_L2"), "Profile");
      await shoot(page, testInfo, `28.16 upload ${label}`);
    });

    // The cancel sheet on her booking, kept ("Keep my shift").
    await each(session, async (page, where, label) => {
      await page.goto(`${acme}/shifts`);
      await expect(page.getByRole("heading", { level: 1, name: "Booked shifts" })).toBeVisible();
      await page.getByRole("button", { name: "Can't make it?" }).first().click();
      const sheet = page.getByRole("dialog", { name: "Can't make it?" });
      await expect(sheet.getByRole("button", { name: "Keep my shift" })).toBeVisible();
      await sheet.evaluate((d) =>
        Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      await check(page, where("the cancel sheet"), null);
      await shoot(page, testInfo, `28.16 cancel sheet ${label}`);
      await sheet.getByRole("button", { name: "Keep my shift" }).click();
      await expect(sheet).toBeHidden();
    });

    // A shift she can't take (already booked then), and one the office chooses for.
    await each(session, async (page, where, label) => {
      await page.goto(`${acme}/shifts/${scene.blocked}`);
      await expect(page.getByText(/^You're already booked at /)).toBeVisible();
      await expect(page.getByRole("button", { name: "Take shift" })).toHaveCount(0);
      await check(page, where("a blocked shift"), null);
      await shoot(page, testInfo, `28.16 shift blocked ${label}`);

      await page.goto(`${acme}/shifts/${scene.ask}`);
      await expect(page.getByRole("button", { name: "I can do this" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Take shift" })).toHaveCount(0);
      await check(page, where("an ask shift"), null);
      await shoot(page, testInfo, `28.16 shift ask ${label}`);
    });

    // "You're booked.": a session of its own taken at each size and theme.
    await each(session, async (page, where, label, i) => {
      await page.goto(`${acme}/shifts/${scene.toTake[i]}`);
      await page.getByRole("button", { name: "Take shift" }).click();
      await expect(page.getByText("You're booked.")).toBeVisible();
      const cover = page.locator("[data-booked]");
      await cover.evaluate((d) =>
        Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      await check(page, where("You're booked."), null);
      await shoot(page, testInfo, `28.16 you're booked ${label}`);
    });

    // Held: Acme's fair rotation (the lowest hours first: Cal has none that week, she has 8), its
    // first group one person and its window 4 hours for these screenshots only.
    await widerRotation(async () =>
      each(session, async (page, where, label) => {
        await page.goto(`${acme}/shifts/${scene.held}`);
        await expect(
          page.getByText("Offered first to people with fewer hours that week."),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: /^Take shift from / })).toBeDisabled();
        await check(page, where("a held shift"), null);
        await shoot(page, testInfo, `28.16 shift held ${label}`);
      }),
    );
  } finally {
    await endUnseenScene(scene);
  }
});

// Logs in with the link (its first use), and keeps the session.
async function logIn(browser: Browser, link: string): Promise<Session> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    await page.goto(link);
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    return await context.storageState();
  } finally {
    await context.close();
  }
}

// Acme under fair rotation for `work`, with a first group of one and a 4-hour window, its settings
// put back after.
async function widerRotation(work: () => Promise<void>): Promise<void> {
  const settings = {
    allocation_mode: "fair_rotation",
    wave_size: 1,
    wave_minutes: 240,
  } as const;
  const before: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings))
    before[key] = await setFirmSetting("acme", key, value);
  try {
    await work();
  } finally {
    for (const key of Object.keys(settings)) await setFirmSetting("acme", key, before[key]);
  }
}
