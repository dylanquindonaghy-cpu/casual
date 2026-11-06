import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Pool } from "pg";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DAY, HOUR } from "@/lib/auth/clock";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { tabCounts } from "@/lib/portal/tab-counts";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// One count for every tab bar (Phase 28.7; docs/screens.md "The casual app, Phase 28", 28.1's
// table and 28.7): Home, Booked and Messages, the real pages rendered on the real database for one
// casual with 1 thing to do on Profile, 1 answer to a request she hasn't seen and 1 answer from
// payroll she hasn't seen, all show the same Profile and Pay numbers, the ones 28.2's tabCounts()
// gives. The login is stood in for (requireWorker, the request's host): everything else is the
// app's own code, through withFirm on the test database. The pages read the real clock, so the
// rows are made relative to it.

const state = vi.hoisted(() => ({
  host: "",
  current: null as null | {
    firm: { id: string; slug: string; name: string; timezone: string; signOff: string };
    worker: { id: string; firstName: string; lastName: string };
    session: ActiveSession;
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host }),
  cookies: async () => ({ get: () => undefined, set() {}, delete() {} }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {}, push() {} }),
  usePathname: () => "/",
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/auth/current-worker", () => {
  const who = async () => {
    if (!state.current) throw new Error("no casual for this test");
    return state.current;
  };
  return { requireWorker: who, getWorkerSession: who, steppedUpWorker: async () => null };
});

type Page = (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
const pages = {
  home: (await import("@/app/page")).default as unknown as Page,
  booked: (await import("@/app/shifts/page")).default as unknown as Page,
  messages: (await import("@/app/messages/page")).default as unknown as Page,
};
const { CasualTabBar } = await import("@/app/casual-tab-bar");

async function render(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

// The badges and the names screen readers hear, from a rendered page's tab bar.
function tabsOf(html: string) {
  const nav = html.slice(html.indexOf('data-tab-bar=""'));
  const badge = (mark: string) => new RegExp(`${mark}=""[^>]*>(\\d+)<`).exec(nav)?.[1] ?? null;
  const name = (href: string) =>
    new RegExp(`<a (?=[^>]*href="${href}")[^>]*aria-label="([^"]*)"`).exec(nav)?.[1] ?? null;
  return {
    profile: badge("data-profile-count"),
    pay: badge("data-pay-count"),
    messages: badge("data-messages-count"),
    profileName: name("/profile"),
    payName: name("/pay"),
  };
}

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

describe("one count for every tab bar", () => {
  it("Home, Booked and Messages show the same Profile and Pay numbers, from tabCounts", async () => {
    const f = await bookingFirm(su, withFirm);
    const now = Date.now();
    const ago = (h: number) => new Date(now - h * HOUR);
    // Kit's one role needs a qualification she hasn't got: 1 thing to do on Profile.
    const kit = await f.worker({ first: "Kit", roles: ["steward"], credentials: [] });
    const resourcer = await f.office("resourcer");
    // She last looked at her answers 10 hours ago; since then the office answered a request of
    // hers and payroll a pay query; the office replied once in the app.
    await su.query(
      "update workers set requests_read_at = $2, pay_answers_read_at = $2 where id = $1",
      [kit, ago(10)],
    );
    await su.query(
      `insert into requests (firm_id, worker_id, type, status, payload, created_at, resolved_at,
                             resolved_by)
       values ($1, $2, 'general', 'approved', '{}', $3, $4, $5)`,
      [f.firmId, kit, ago(48), ago(1), resourcer],
    );
    await su.query(
      `insert into pay_queries (firm_id, worker_id, work_date, issue_type, status, resolved_by,
                                resolved_at, resolution_note, created_at)
       values ($1, $2, $3, 'late_pay', 'resolved', $4, $5, 'Paid on Friday.', $6)`,
      [
        f.firmId,
        kit,
        new Date(now - 7 * DAY).toISOString().slice(0, 10),
        resourcer,
        ago(1),
        ago(72),
      ],
    );
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, body)
       values ($1, 'out', 'app', $2, $3, 'Yes, see you then.')`,
      [f.firmId, `app-out:p28-7-${kit}`, kit],
    );
    const counts = await tabCounts({ firm: { id: f.firmId }, run: withFirm }, kit);
    expect(counts).toEqual({ needs: 1, answers: 1, replies: 1, payAnswers: 1 });

    const { rows } = await su.query<{ slug: string; name: string }>(
      "select slug, name from firms where id = $1",
      [f.firmId],
    );
    const firm = rows[0]!;
    state.host = `${firm.slug}.localhost:3000`;
    state.current = {
      firm: {
        id: f.firmId,
        slug: firm.slug,
        name: firm.name,
        timezone: "Europe/London",
        signOff: `${firm.name} Shift Team`,
      },
      worker: { id: kit, firstName: "Kit", lastName: "Booker" },
      session: {
        id: "00000000-0000-4000-8000-000000000000",
        kind: "worker",
        subjectId: kit,
        expiresAt: new Date(now + DAY),
        rotatedAt: new Date(now),
        steppedUpUntil: null,
        rotationDue: false,
      },
    };
    const none = { searchParams: Promise.resolve({}) };
    const home = tabsOf(await render(await pages.home(none)));
    const booked = tabsOf(await render(await pages.booked(none)));
    const messages = tabsOf(await render(await pages.messages(none)));

    const expected = {
      profile: "2", // 1 to do + 1 answer
      pay: "1",
      profileName: "Profile, 1 thing needs doing and 1 new answer",
      payName: "Pay, 1 new answer from payroll",
    };
    for (const [page, tabs] of Object.entries({ home, booked, messages })) {
      const { profile, pay, profileName, payName } = tabs;
      expect({ profile, pay, profileName, payName }, page).toEqual(expected);
    }
    // Home and Booked show the office's reply on Messages' tab too (Messages itself marks its
    // replies as read when it opens: its own business, not this test's).
    expect([home.messages, booked.messages]).toEqual(["1", "1"]);
    // Every other page's bar (CasualTabBar) says the same.
    const other = tabsOf(
      await render(
        await CasualTabBar({ firm: { id: f.firmId }, workerId: kit, current: "profile" }),
      ),
    );
    expect({ profile: other.profile, pay: other.pay }).toEqual({ profile: "2", pay: "1" });
    state.current = null;
  });

  it("every casual page that has a tab bar takes its counts from tabCounts", () => {
    const ROOT = process.cwd();
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === "office" ? [] : files(path);
        return name.endsWith(".tsx") ? [path] : [];
      });
    const src = files(join(ROOT, "src/app")).map((path) => ({
      path: relative(ROOT, path),
      text: readFileSync(path, "utf8"),
    }));
    // The bar itself is drawn only by the one place that gives it the counts.
    expect(
      src
        .filter((f) => /<TabBar\b/.test(f.text) && f.path !== "src/app/tab-bar.tsx")
        .map((f) => f.path),
    ).toEqual(["src/app/casual-tab-bar.tsx"]);
    const bar = src.find((f) => f.path === "src/app/casual-tab-bar.tsx")!.text;
    expect(bar).toContain("await tabCounts({ firm }, workerId)");
    expect(bar).toMatch(
      /profileCount=\{counts\.needs\}\s*answersCount=\{counts\.answers\}\s*messagesCount=\{counts\.replies\}\s*payCount=\{counts\.payAnswers\}/,
    );
    // Home and Booked load the counts with the rest of their data; every other page's bar loads
    // them itself.
    for (const page of ["src/app/page.tsx", "src/app/shifts/page.tsx"]) {
      const text = src.find((f) => f.path === page)!.text;
      expect(text, page).toMatch(/tabCounts\(\{ firm, clock \}, worker\.id\)/);
      expect(text, page).toMatch(/<CountedTabBar current="(home|shifts)" counts=\{counts\} \/>/);
    }
    const withBar = src.filter((f) => /<(CasualTabBar|CountedTabBar)\b/.test(f.text));
    expect(withBar.length).toBeGreaterThan(10);
    expect(src.find((f) => f.path === "src/app/messages/page.tsx")!.text).toContain(
      '<CasualTabBar firm={firm} workerId={worker.id} current="messages" />',
    );
  });
});
