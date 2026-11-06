import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfflineCopy } from "@/app/offline-copy";
import {
  answersNow,
  FORGET_EVENT,
  ONLINE_RELOAD_STOP,
  onlineReloadScript,
  RELOAD_RETRY_MS,
  RELOAD_TRIES,
  reloadWhenOnline,
} from "@/lib/portal/offline";

// Phase 29.6: the kept copy of Home or Booked says "It updates when you're back online", so when
// the signal comes back it opens the page fresh (src/app/offline-copy.tsx). reloadWhenOnline is the
// page's code; onlineReloadScript the few lines its HTML carries for before (or without) that code.

const flush = () => new Promise((r) => setTimeout(r, 0));

// A timer the test runs by hand: wait() keeps the step, run() does it.
function handTimer() {
  const steps: (() => void)[] = [];
  return {
    wait: (_ms: number, then: () => void) => {
      steps.push(then);
      return () => {
        const i = steps.indexOf(then);
        if (i >= 0) steps.splice(i, 1);
      };
    },
    run: () => steps.splice(0).forEach((f) => f()),
    pending: () => steps.length,
  };
}

describe("reloadWhenOnline", () => {
  it("opens the page fresh once the network answers after 'online', not before", async () => {
    const target = new EventTarget();
    const went: string[] = [];
    const asked: string[] = [];
    reloadWhenOnline({
      path: "/shifts",
      target,
      go: (p) => went.push(p),
      probe: async (p) => (asked.push(p), true),
    });
    expect(went).toEqual([]);
    target.dispatchEvent(new Event("offline"));
    await flush();
    expect(went).toEqual([]);
    expect(asked).toEqual([]);
    target.dispatchEvent(new Event("online"));
    await flush();
    expect(asked).toEqual(["/shifts"]);
    expect(went).toEqual(["/shifts"]);
    // Only once, however often the signal comes and goes.
    target.dispatchEvent(new Event("online"));
    await flush();
    expect(went).toEqual(["/shifts"]);
  });

  it("'online' before data flows: it asks again until the network answers, then opens once", async () => {
    const target = new EventTarget();
    const went: string[] = [];
    const answers = [false, false, true];
    let asked = 0;
    const timer = handTimer();
    reloadWhenOnline({
      path: "/",
      target,
      go: (p) => went.push(p),
      probe: async () => answers[asked++] ?? true,
      wait: timer.wait,
    });
    target.dispatchEvent(new Event("online"));
    await flush();
    expect(asked).toBe(1);
    expect(went).toEqual([]); // no answer: the page isn't opened (it would be the copy again)
    expect(timer.pending()).toBe(1);
    timer.run();
    await flush();
    expect(asked).toBe(2);
    expect(went).toEqual([]);
    timer.run();
    await flush();
    expect(asked).toBe(3);
    expect(went).toEqual(["/"]);
    expect(timer.pending()).toBe(0);
  });

  it("'offline' pauses the asking until the next 'online'; it gives up after RELOAD_TRIES", async () => {
    const target = new EventTarget();
    const went: string[] = [];
    let asked = 0;
    const timer = handTimer();
    reloadWhenOnline({
      path: "/",
      target,
      go: (p) => went.push(p),
      probe: async () => (asked++, false),
      wait: timer.wait,
    });
    target.dispatchEvent(new Event("online"));
    await flush();
    target.dispatchEvent(new Event("offline"));
    expect(timer.pending()).toBe(0);
    timer.run();
    await flush();
    expect(asked).toBe(1);
    target.dispatchEvent(new Event("online"));
    await flush();
    for (let i = 0; i < RELOAD_TRIES + 5; i++) {
      timer.run();
      await flush();
    }
    expect(asked).toBe(1 + RELOAD_TRIES);
    expect(went).toEqual([]);
    expect(RELOAD_RETRY_MS).toBe(2000);
  });

  it("does nothing after it's stopped (the page went away), even with an answer on its way", async () => {
    const target = new EventTarget();
    const went: string[] = [];
    const stop = reloadWhenOnline({
      path: "/",
      target,
      go: (p) => went.push(p),
      probe: async () => true,
    });
    stop();
    target.dispatchEvent(new Event("online"));
    await flush();
    expect(went).toEqual([]);
    const later = reloadWhenOnline({
      path: "/",
      target,
      go: (p) => went.push(p),
      probe: async () => true,
    });
    target.dispatchEvent(new Event("online"));
    later(); // stopped while the answer was on its way
    await flush();
    expect(went).toEqual([]);
  });

  it("does nothing once a logout or login starts (FORGET_EVENT)", async () => {
    const target = new EventTarget();
    const went: string[] = [];
    reloadWhenOnline({ path: "/", target, go: (p) => went.push(p), probe: async () => true });
    target.dispatchEvent(new Event(FORGET_EVENT));
    target.dispatchEvent(new Event("online"));
    await flush();
    expect(went).toEqual([]);
  });

  it("asks the network with a HEAD request the service worker never answers", () => {
    // public/sw.js answers GETs only; a HEAD always goes to the network.
    const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
    expect(sw).toContain('if (request.method !== "GET") return;');
    expect(answersNow.toString()).toMatch(/method: "HEAD"/);
    expect(onlineReloadScript("/")).toContain('method:"HEAD"');
  });
});

// The in-page lines, run as the browser would: a window, a document with or without the kept
// copy's notice showing, and the address.
function runScript(
  path: "/" | "/shifts",
  page: { pathname: string; notice: "shown" | "hidden" | "none" },
  answers: boolean[] = [true],
) {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  const went: string[] = [];
  const asked: { url: string; method: string }[] = [];
  const timers: (() => void)[] = [];
  const notice = page.notice === "none" ? null : { hidden: page.notice === "hidden" };
  const context = vm.createContext({
    window: win,
    document: { querySelector: (s: string) => (s === "[data-offline-notice]" ? notice : null) },
    location: { pathname: page.pathname, replace: (p: string) => went.push(p) },
    fetch: (url: string, init: { method: string }) => {
      asked.push({ url, method: init.method });
      return (answers[asked.length - 1] ?? true)
        ? Promise.resolve({})
        : Promise.reject(new Error("no signal"));
    },
    setTimeout: (f: () => void) => (timers.push(f), timers.length),
    clearTimeout: () => timers.splice(0),
  });
  vm.runInContext(onlineReloadScript(path), context);
  const runTimers = () => timers.splice(0).forEach((f) => f());
  return { win, went, notice, asked, runTimers };
}

describe("onlineReloadScript", () => {
  it("on the kept copy (its notice showing), opens the page fresh once the network answers", async () => {
    const { win, went, asked } = runScript("/", { pathname: "/", notice: "shown" });
    expect(went).toEqual([]);
    win.dispatchEvent(new Event("online"));
    win.dispatchEvent(new Event("online"));
    await flush();
    expect(asked).toEqual([{ url: "/", method: "HEAD" }]);
    expect(went).toEqual(["/"]);
    const booked = runScript("/shifts", { pathname: "/shifts", notice: "shown" });
    booked.win.dispatchEvent(new Event("online"));
    await flush();
    expect(booked.went).toEqual(["/shifts"]);
  });

  it("'online' before data flows: asks again on its timer, opens only once answered", async () => {
    const run = runScript("/", { pathname: "/", notice: "shown" }, [false, true]);
    run.win.dispatchEvent(new Event("online"));
    await flush();
    expect(run.went).toEqual([]);
    run.runTimers();
    await flush();
    expect(run.asked).toHaveLength(2);
    expect(run.went).toEqual(["/"]);
    // "offline" while waiting: nothing more is asked until "online" again.
    const paused = runScript("/", { pathname: "/", notice: "shown" }, [false, true]);
    paused.win.dispatchEvent(new Event("online"));
    await flush();
    paused.win.dispatchEvent(new Event("offline"));
    paused.runTimers();
    await flush();
    expect(paused.asked).toHaveLength(1);
    expect(paused.went).toEqual([]);
  });

  it("never reloads a page that isn't the kept copy", async () => {
    for (const page of [
      { pathname: "/", notice: "hidden" as const }, // the fresh page
      { pathname: "/", notice: "none" as const },
      { pathname: "/messages", notice: "shown" as const }, // she has moved on
    ]) {
      const { win, went, asked } = runScript("/", page);
      win.dispatchEvent(new Event("online"));
      await flush();
      expect(went, JSON.stringify(page)).toEqual([]);
      expect(asked, JSON.stringify(page)).toEqual([]);
    }
  });

  it("stops on FORGET_EVENT, and when the page's own code takes over", async () => {
    const forgot = runScript("/", { pathname: "/", notice: "shown" });
    forgot.win.dispatchEvent(new Event(FORGET_EVENT));
    forgot.win.dispatchEvent(new Event("online"));
    await flush();
    expect(forgot.went).toEqual([]);

    const taken = runScript("/", { pathname: "/", notice: "shown" });
    const stop = taken.win[ONLINE_RELOAD_STOP];
    expect(typeof stop).toBe("function");
    (stop as () => void)();
    taken.win.dispatchEvent(new Event("online"));
    await flush();
    expect(taken.went).toEqual([]);
  });

  it("names only one of the two kept pages", () => {
    expect(onlineReloadScript("/")).toContain('p="/"');
    expect(onlineReloadScript("/shifts")).toContain('p="/shifts"');
    expect(onlineReloadScript("/x" as "/")).toContain('p="/"');
    expect(onlineReloadScript("/shifts")).not.toMatch(/<\/script/i);
  });
});

describe("the page's HTML (OfflineCopy)", () => {
  it("carries the lines for its own page, so the kept copy has them", () => {
    const home = renderToStaticMarkup(createElement(OfflineCopy, { enabled: true, renderedAt: 1 }));
    expect(home).toContain('<script id="offline-reload-home">');
    expect(home).toContain(onlineReloadScript("/"));
    const booked = renderToStaticMarkup(
      createElement(OfflineCopy, { enabled: true, renderedAt: 1, page: "/shifts" }),
    );
    expect(booked).toContain('<script id="offline-reload-booked">');
    expect(booked).toContain(onlineReloadScript("/shifts"));
  });
});
