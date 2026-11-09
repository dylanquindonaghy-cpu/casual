import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { eventWords } from "@/lib/office/event-words";
import { LOG_TYPES, logTypeLabel } from "@/lib/office/log-types";
import {
  OFFICE_TOUR_STEPS,
  OFFICE_WELCOME,
  possessive,
  TOUR_CONTROLS,
  TOUR_MENU,
} from "@/lib/tour/office-copy";
import { EDGE, nextShown, placeTip, readTourPlace, TIP_WIDTH, type Rect } from "@/lib/tour/steps";
import { TOUR_ACTIONS } from "@/lib/tour/seen";

// The first-login tours (Phase 33; docs/screens.md "## Phase 33"): their words are the screens
// doc's, every step points at an anchor the office really carries, the tip stays on screen, and
// the video's files are there.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
  usePathname: () => "/office",
}));
const { TourWelcome } = await import("@/app/tour/welcome");

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const screens = readFileSync("docs/screens.md", "utf8");
const phase33 = squash(screens.slice(screens.indexOf("\n## Phase 33\n")));

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()];
  if (Array.isArray(value)) return value.flatMap((v) => strings(v));
  if (value && typeof value === "object") return Object.values(value).flatMap((v) => strings(v));
  return [];
}

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? files(path) : /\.tsx?$/.test(e.name) ? [path] : [];
  });

describe("the words are the screens doc's", () => {
  it("docs/screens.md has a Phase 33 section with 33.1 and 33.2", () => {
    expect(screens).toContain("\n## Phase 33\n");
    for (const h of ["### 33.1", "### 33.2"]) expect(phase33).toContain(h);
  });

  it("every sentence of the welcome window, the controls, the menu and the steps is in the doc", () => {
    const steps = OFFICE_TOUR_STEPS.flatMap((s) => [s.title, s.body]);
    const welcome = strings({ ...OFFICE_WELCOME, title: undefined });
    const controls = strings({ ...TOUR_CONTROLS, stepOf: TOUR_CONTROLS.stepOf(1, 8) });
    const all = [...steps, ...welcome, ...controls, ...strings(TOUR_MENU)].filter(
      (s) => s !== TOUR_CONTROLS.label,
    );
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((s) => !phase33.includes(squash(s)))).toEqual([]);
    expect(phase33).toContain(
      OFFICE_WELCOME.title("Acme Events").replace("Acme Events'", "{Acme Events'}"),
    );
    expect(phase33).toContain(possessive("Northline Staffing") + " office");
  });

  it("the firm's name as a possessive", () => {
    expect(OFFICE_WELCOME.title("Acme Events")).toBe("Welcome to Acme Events' office");
    expect(OFFICE_WELCOME.title("Northline Staffing")).toBe(
      "Welcome to Northline Staffing's office",
    );
  });

  it("the log's words, in Logins, ids only", () => {
    const names = { worker: () => "Zoe Adeyemi", office: () => "Sam Rota" };
    const at = (action: string, actorType: "office" | "worker") =>
      eventWords(
        {
          action,
          actorType,
          actorId: "x",
          data: { kind: actorType === "office" ? "office" : "casual" },
        },
        names,
      );
    expect(at(TOUR_ACTIONS.finished, "office")).toBe("Sam Rota finished the welcome tour.");
    expect(at(TOUR_ACTIONS.skipped, "worker")).toBe("Zoe Adeyemi skipped the welcome tour.");
    expect(LOG_TYPES.logins.actions).toEqual(
      expect.arrayContaining([TOUR_ACTIONS.finished, TOUR_ACTIONS.skipped]),
    );
    expect(logTypeLabel(TOUR_ACTIONS.finished)).toBe(LOG_TYPES.logins.label);
  });
});

describe("every step points at a part the office really has", () => {
  const office = [...files("src/app/office"), ...files("src/app/tour")]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it("eight steps, each anchor on one of the office's elements", () => {
    expect(OFFICE_TOUR_STEPS).toHaveLength(8);
    expect(OFFICE_TOUR_STEPS.map((s) => s.anchor)).toEqual([
      "counts",
      "tabs",
      "map",
      "session-card",
      "offer",
      "menu",
      "search",
      "you",
    ]);
    for (const s of OFFICE_TOUR_STEPS) {
      expect(office, s.anchor).toContain(`data-tour="${s.anchor}"`);
      expect(s.path).toBe("/office");
    }
  });
});

describe("the tip stays on screen", () => {
  const laptop = { width: 1280, height: 800 };
  const phone = { width: 390, height: 844 };
  const inside = (
    p: { left: number; top: number; width: number },
    view: typeof laptop,
    h: number,
  ) =>
    p.left >= EDGE &&
    p.top >= EDGE &&
    p.left + p.width <= view.width - EDGE &&
    p.top + h <= view.height - EDGE;

  it("beside the part on a laptop: to its right, flipping left at the edge", () => {
    const counts: Rect = { left: 95, top: 47, width: 545, height: 46 };
    const right = placeTip(counts, { height: 190 }, laptop);
    expect(right.side).toBe("right");
    expect(right.width).toBe(TIP_WIDTH);
    expect(inside(right, laptop, 190)).toBe(true);
    const you: Rect = { left: 1105, top: 50, width: 160, height: 42 };
    const left = placeTip(you, { height: 190 }, laptop);
    expect(left.side).toBe("left");
    expect(inside(left, laptop, 190)).toBe(true);
  });

  it("under or over a part as wide as the window; over its foot when it fills it", () => {
    const wide: Rect = { left: 10, top: 100, width: 1260, height: 200 };
    expect(placeTip(wide, { height: 190 }, laptop).side).toBe("below");
    const low: Rect = { left: 10, top: 500, width: 1260, height: 280 };
    expect(placeTip(low, { height: 190 }, laptop).side).toBe("above");
    const all: Rect = { left: 0, top: 0, width: 1280, height: 800 };
    const over = placeTip(all, { height: 190 }, laptop);
    expect(over.side).toBe("over");
    expect(inside(over, laptop, 190)).toBe(true);
  });

  it("on a phone the tip spans the window, above or below the part", () => {
    const card: Rect = { left: 16, top: 120, width: 358, height: 300 };
    const p = placeTip(card, { height: 200 }, phone);
    expect(p.side).toBe("below");
    expect(p.width).toBe(phone.width - EDGE * 2);
    expect(inside(p, phone, 200)).toBe(true);
    const foot: Rect = { left: 96, top: 768, width: 62, height: 62 };
    expect(placeTip(foot, { height: 200 }, phone).side).toBe("above");
  });
});

describe("a step whose part isn't there is passed over", () => {
  it("forward and back", () => {
    const here = new Set([0, 1, 3, 4]);
    expect(nextShown(5, 2, 1, (i) => here.has(i))).toBe(3);
    expect(nextShown(5, 2, -1, (i) => here.has(i))).toBe(1);
    expect(nextShown(5, 5, 1, (i) => here.has(i))).toBeNull();
    expect(nextShown(3, 2, 1, () => false)).toBeNull();
  });

  it("the place kept between pages is read only when it's well formed", () => {
    expect(readTourPlace('{"id":"office","step":3}')).toEqual({ id: "office", step: 3 });
    for (const bad of [
      null,
      "",
      "x",
      '{"id":1,"step":2}',
      '{"id":"office","step":-1}',
      '{"id":"office","step":1.5}',
    ])
      expect(readTourPlace(bad)).toBeNull();
  });
});

describe("the welcome window", () => {
  const html = renderToStaticMarkup(
    createElement(TourWelcome, {
      copy: { ...OFFICE_WELCOME, title: OFFICE_WELCOME.title("Acme Events") },
      video: {
        src: "/tour/office.mp4",
        poster: "/tour/office.jpg",
        captions: "/tour/office.en.vtt",
      },
      onStart: () => undefined,
      onNotNow: () => undefined,
    }),
  ).replace(/&#x27;/g, "'");

  it("a muted video with captions on, never playing with sound by itself, its first words in its place until it plays", () => {
    expect(html).toMatch(/<video [^>]*muted=""/);
    expect(html).toMatch(/<video [^>]*playsInline=""|<video [^>]*playsinline=""/);
    expect(html).not.toMatch(/autoplay/i);
    expect(html).toMatch(/<video [^>]*hidden=""/);
    expect(html).toContain(
      '<track default="" kind="captions" srcLang="en" label="English" src="/tour/office.en.vtt"/>',
    );
    expect(html).toContain('poster="/tour/office.jpg"');
    expect(html).toContain(OFFICE_WELCOME.posterTop);
    expect(html).toContain(OFFICE_WELCOME.posterBottom);
  });

  it("its three buttons, the main one first", () => {
    const buttons = [...html.matchAll(/<button [^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(buttons).toEqual([
      OFFICE_WELCOME.start,
      OFFICE_WELCOME.skipVideo,
      OFFICE_WELCOME.notNow,
    ]);
  });

  it("the video's files are there, and the captions are the storyboard's", () => {
    for (const f of ["office.mp4", "office.jpg", "office.en.vtt"])
      expect(existsSync(join("public/tour", f)), f).toBe(true);
    const vtt = readFileSync("public/tour/office.en.vtt", "utf8");
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    const cues = [...vtt.matchAll(/(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})/g)];
    expect(cues.length).toBeGreaterThanOrEqual(7);
    const secs = (t: string) => {
      const [h, m, s] = t.split(":").map(Number);
      return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
    };
    expect(secs(cues[cues.length - 1]?.[2] ?? "")).toBeLessThanOrEqual(26);
    for (const line of ["60 emails a day?", "Here's your one screen.", "Let's show you round."])
      expect(vtt).toContain(line);
  });
});
