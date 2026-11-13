import type { Pool } from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { waveCandidates } from "@/lib/offers/candidates";
import type { HomeViewProps } from "@/app/home-view";
import { myReachFacts, myReachPrompts, type ReachPrompt } from "@/lib/portal/reach-me";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { need } from "../helpers/qualifications";

// Home's two "can we reach you" rows (Phase 28.7; docs/screens.md "The casual app, Phase 28", 28.7;
// src/lib/portal/reach-me.ts) on the real database as the app role: from her own row and her
// phones, inside her firm; shown in "Do this", online only, so the copy kept for no signal never
// shows them. The casual nothing reaches is exactly the one the offer waves leave out
// (waveCandidates with `reachable`), and adding an email puts her back on both. Tests have a text
// sender (console) unless a call says otherwise.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/",
}));
const { HomeView } = await import("@/app/home-view");

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const ctx = (firmId: string) => ({ firm: { id: firmId }, run: withFirm });
const set = (id: string, sql: string, values: unknown[] = []) =>
  su.query(`update workers set ${sql} where id = $1`, [id, ...values]);
const phone = (firmId: string, workerId: string, name: string) =>
  su.query(
    `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
     values ($1, $2, $3, 'k', 'a')`,
    [firmId, workerId, `https://push.example.test/${name}`],
  );

// Home for her, with these rows and nothing else to do unless `needs` says so.
const homeHtml = (reach: ReachPrompt[], more: Partial<HomeViewProps> = {}) =>
  renderToStaticMarkup(
    createElement(HomeView, {
      firstName: "Dan",
      lastName: "Booker",
      firmName: "Booking Test",
      timeZone: "Europe/London",
      now: NOW,
      next: null,
      needs: [],
      photo: { status: "up_to_date", current: null, waiting: null },
      open: {
        shifts: [],
        truncated: false,
        offerAlerts: true,
        travelOn: false,
        area: null,
        further: { count: 0, atLeast: false },
        choices: { days: [], sites: [], roles: [] },
      },
      pay: {
        payDay: "2026-11-13",
        days: 7,
        start: "2026-11-02",
        end: "2026-11-08",
        thisPeriodPaid: null,
      },
      reach,
      ...more,
    }),
  );

// The copy kept for no signal hides every element marked data-online-only (globals.css): the page
// as it shows there, with those elements and all inside them taken out. React's markup is well
// formed, so a stack of open tags is enough.
const VOID = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
]);
function offlineCopy(html: string): string {
  let out = "";
  let hiddenDepth = 0;
  let last = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [tag, closing, name = "", attrs = ""] = m;
    const at = m.index ?? 0;
    if (hiddenDepth === 0) out += html.slice(last, at);
    last = at + tag.length;
    const isVoid = VOID.has(name.toLowerCase()) || attrs.endsWith("/");
    if (hiddenDepth > 0) {
      if (closing) hiddenDepth--;
      else if (!isVoid) hiddenDepth++;
      continue;
    }
    if (!closing && !isVoid && /\sdata-online-only=""/.test(attrs)) {
      hiddenDepth = 1;
      continue;
    }
    out += tag;
  }
  return hiddenDepth === 0 ? out + html.slice(last) : out;
}
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const CANT_REACH = "We can't reach you about shifts";
const ALERTS_OFF = "Open-shift alerts are off";

describe("Home's 'can we reach you' rows", () => {
  it("nothing reaches her: the row shows; an email takes it away; texts back on take it away", async () => {
    const f = await bookingFirm(su, withFirm);
    // No phone with notifications, she replied STOP, and no address: nothing reaches her.
    const dan = await f.worker({ first: "Dan" });
    await set(dan, "sms_opted_out_at = $2", [hoursFromNow(-5)]);
    expect(await myReachPrompts(ctx(f.firmId), dan, true)).toEqual(["unreachable"]);
    expect(await myReachFacts(ctx(f.firmId), dan)).toEqual({
      phones: 0,
      channel: "sms",
      smsAllowed: false,
      hasEmail: false,
      offerAlerts: true,
    });

    const html = homeHtml(await myReachPrompts(ctx(f.firmId), dan, true));
    expect(words(html)).toContain(
      `Do this ${CANT_REACH} You'll miss offers and changes to your shifts. Choose how we reach you.`,
    );
    expect(html).toMatch(
      /<li data-online-only="" data-for-you="reach"><a class="[^"]*" href="\/profile#notify-heading">/,
    );
    // Online only: the kept copy has neither the row nor "Do this" (nothing else needs doing).
    expect(html).toMatch(/<section data-online-only="" aria-labelledby="do-this-heading"/);
    expect(words(offlineCopy(html))).not.toContain(CANT_REACH);
    expect(words(offlineCopy(html))).not.toContain("Do this");
    // Her alerts are on, but nothing reaches her: "Shifts you can take" mustn't promise a message.
    expect(words(html)).toContain("No shifts right now Check back later.");
    expect(words(html)).not.toContain("We'll message you");

    // The firm adds her email: an offer can reach her by email, so the row goes, and the promise
    // is true again.
    await set(dan, "email = $2", ["dan@example.test"]);
    expect(await myReachPrompts(ctx(f.firmId), dan, true)).toEqual([]);
    const reached = words(homeHtml(await myReachPrompts(ctx(f.firmId), dan, true)));
    expect(reached).not.toContain("Do this");
    expect(reached).toContain("No shifts right now We'll message you when something matches.");

    // No email, but texts back on (START) while there's a text sender: reached by text.
    await set(dan, "email = null, sms_opted_out_at = null");
    expect(await myReachPrompts(ctx(f.firmId), dan, true)).toEqual([]);
    // With no text sender at all, the same casual is unreachable again.
    expect(await myReachPrompts(ctx(f.firmId), dan, false)).toEqual(["unreachable"]);
    // A phone with notifications on reaches her whatever else is true.
    await phone(f.firmId, dan, "dan");
    expect(await myReachPrompts(ctx(f.firmId), dan, false)).toEqual([]);
  });

  it("open-shift alerts off: its row shows, online only; both rows when nothing reaches her either", async () => {
    const f = await bookingFirm(su, withFirm);
    const gus = await f.worker({ first: "Gus" });
    await set(gus, "offer_alerts = false");
    expect(await myReachPrompts(ctx(f.firmId), gus, true)).toEqual(["alerts_off"]);
    const html = homeHtml(await myReachPrompts(ctx(f.firmId), gus, true));
    expect(words(html)).toContain(
      `Do this ${ALERTS_OFF} We won't tell you about open shifts. Turn them on.`,
    );
    expect(html).toMatch(
      /<li data-online-only="" data-for-you="alerts"><a class="[^"]*" href="\/profile#notify-heading">/,
    );
    expect(words(offlineCopy(html))).not.toContain(ALERTS_OFF);

    // STOP too, and no address: both, can't reach first.
    await set(gus, "sms_opted_out_at = $2", [hoursFromNow(-1)]);
    const both = await myReachPrompts(ctx(f.firmId), gus, true);
    expect(both).toEqual(["unreachable", "alerts_off"]);
    expect(
      [...homeHtml(both).matchAll(/data-for-you="([a-z]+)"/g)].map((m) => m[1]).slice(0, 2),
    ).toEqual(["reach", "alerts"]);
  });

  it("with something to do on Profile as well: 'Do this' shows offline with that row only", async () => {
    const html = homeHtml(["unreachable", "alerts_off"], {
      needs: [need(3, { status: "expiring_soon", expiresOn: "2026-11-25" })],
    });
    const rows = [...html.matchAll(/<li ([^>]*)data-for-you="([a-z]+)"/g)].map((m) => [
      m[2],
      /data-online-only/.test(m[1] ?? ""),
    ]);
    expect(rows.slice(0, 3)).toEqual([
      ["needs", false],
      ["reach", true],
      ["alerts", true],
    ]);
    expect(html).toMatch(/<section aria-labelledby="do-this-heading"/);
    const kept = words(offlineCopy(html));
    expect(kept).toContain("Do this");
    expect(kept).not.toContain(CANT_REACH);
    expect(kept).not.toContain(ALERTS_OFF);
  });

  it("a casual the waves can reach shows neither row", async () => {
    const f = await bookingFirm(su, withFirm);
    const eve = await f.worker({ first: "Eve" }); // texts, the default
    expect(await myReachPrompts(ctx(f.firmId), eve, true)).toEqual([]);
    expect(words(homeHtml([]))).not.toMatch(/Do this|can't reach|alerts are off/);
  });

  it("agrees with the offer waves on the real list: the one nothing reaches is left out until she has an email", async () => {
    const f = await bookingFirm(su, withFirm);
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const dan = await f.worker({ first: "Dan" });
    await set(dan, "sms_opted_out_at = $2", [hoursFromNow(-5)]);
    const eve = await f.worker({ first: "Eve" });
    const wave = async (texts: boolean) =>
      (
        await withFirm(f.firmId, (tx) => waveCandidates(tx, shiftId, NOW, { reachable: { texts } }))
      ).map((c) => c.workerId);
    for (const texts of [true, false]) {
      for (const id of [dan, eve]) {
        const unreachable = (await myReachPrompts(ctx(f.firmId), id, texts)).includes(
          "unreachable",
        );
        expect(unreachable, `${id === dan ? "Dan" : "Eve"}, texts ${texts}`).toBe(
          !(await wave(texts)).includes(id),
        );
      }
    }
    // Dan: left out of both, with or without a text sender (STOP); Eve: out only with no sender.
    expect(await wave(true)).toEqual([eve]);
    expect(await wave(false)).toEqual([]);
    await set(dan, "email = $2", ["dan@example.test"]);
    expect((await wave(false)).sort()).toEqual([dan]);
    expect(await myReachPrompts(ctx(f.firmId), dan, false)).toEqual([]);
  });

  it("reads her own row only, inside her firm: another firm's casual reads as nothing", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const stranger = await other.worker({ first: "Sid" });
    await set(stranger, "sms_opted_out_at = $2, offer_alerts = false", [hoursFromNow(-1)]);
    expect(await myReachPrompts(ctx(other.firmId), stranger, true)).toEqual([
      "unreachable",
      "alerts_off",
    ]);
    // Asked inside the wrong firm, RLS hides the row: no facts, no rows.
    expect(await myReachFacts(ctx(f.firmId), stranger)).toBeNull();
    expect(await myReachPrompts(ctx(f.firmId), stranger, true)).toEqual([]);
    // Another firm's phones never count for her.
    const sam = await f.worker({ first: "Sam" });
    await set(sam, "sms_opted_out_at = $2", [hoursFromNow(-1)]);
    await phone(other.firmId, stranger, "sid");
    expect(await myReachPrompts(ctx(f.firmId), sam, true)).toEqual(["unreachable"]);
  });
});
