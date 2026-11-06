import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfflineCopy } from "@/app/offline-copy";
import {
  FORGET_EVENT,
  ONLINE_RELOAD_STOP,
  onlineReloadScript,
  reloadWhenOnline,
} from "@/lib/portal/offline";

// Phase 29.6: the kept copy of Home or Booked says "It updates when you're back online", so when
// the signal comes back it opens the page fresh (src/app/offline-copy.tsx). reloadWhenOnline is the
// page's code; onlineReloadScript the few lines its HTML carries for before (or without) that code.

describe("reloadWhenOnline", () => {
  it("opens the page fresh once, on 'online', not before", () => {
    const target = new EventTarget();
    const went: string[] = [];
    reloadWhenOnline({ path: "/shifts", target, go: (p) => went.push(p) });
    expect(went).toEqual([]);
    target.dispatchEvent(new Event("offline"));
    expect(went).toEqual([]);
    target.dispatchEvent(new Event("online"));
    expect(went).toEqual(["/shifts"]);
    // Only once, however often the signal comes and goes.
    target.dispatchEvent(new Event("online"));
    expect(went).toEqual(["/shifts"]);
  });

  it("does nothing after it's stopped (the page went away)", () => {
    const target = new EventTarget();
    const went: string[] = [];
    const stop = reloadWhenOnline({ path: "/", target, go: (p) => went.push(p) });
    stop();
    target.dispatchEvent(new Event("online"));
    expect(went).toEqual([]);
  });

  it("does nothing once a logout or login starts (FORGET_EVENT)", () => {
    const target = new EventTarget();
    const went: string[] = [];
    reloadWhenOnline({ path: "/", target, go: (p) => went.push(p) });
    target.dispatchEvent(new Event(FORGET_EVENT));
    target.dispatchEvent(new Event("online"));
    expect(went).toEqual([]);
  });
});

// The in-page lines, run as the browser would: a window, a document with or without the kept
// copy's notice showing, and the address.
function runScript(
  path: "/" | "/shifts",
  page: { pathname: string; notice: "shown" | "hidden" | "none" },
) {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  const went: string[] = [];
  const notice = page.notice === "none" ? null : { hidden: page.notice === "hidden" };
  const context = vm.createContext({
    window: win,
    document: { querySelector: (s: string) => (s === "[data-offline-notice]" ? notice : null) },
    location: { pathname: page.pathname, replace: (p: string) => went.push(p) },
  });
  vm.runInContext(onlineReloadScript(path), context);
  return { win, went, notice };
}

describe("onlineReloadScript", () => {
  it("on the kept copy (its notice showing), opens the page fresh once on 'online'", () => {
    const { win, went } = runScript("/", { pathname: "/", notice: "shown" });
    expect(went).toEqual([]);
    win.dispatchEvent(new Event("online"));
    win.dispatchEvent(new Event("online"));
    expect(went).toEqual(["/"]);
    const booked = runScript("/shifts", { pathname: "/shifts", notice: "shown" });
    booked.win.dispatchEvent(new Event("online"));
    expect(booked.went).toEqual(["/shifts"]);
  });

  it("never reloads a page that isn't the kept copy", () => {
    for (const page of [
      { pathname: "/", notice: "hidden" as const }, // the fresh page
      { pathname: "/", notice: "none" as const },
      { pathname: "/messages", notice: "shown" as const }, // she has moved on
    ]) {
      const { win, went } = runScript("/", page);
      win.dispatchEvent(new Event("online"));
      expect(went, JSON.stringify(page)).toEqual([]);
    }
  });

  it("stops on FORGET_EVENT, and when the page's own code takes over", () => {
    const forgot = runScript("/", { pathname: "/", notice: "shown" });
    forgot.win.dispatchEvent(new Event(FORGET_EVENT));
    forgot.win.dispatchEvent(new Event("online"));
    expect(forgot.went).toEqual([]);

    const taken = runScript("/", { pathname: "/", notice: "shown" });
    const stop = taken.win[ONLINE_RELOAD_STOP];
    expect(typeof stop).toBe("function");
    (stop as () => void)();
    taken.win.dispatchEvent(new Event("online"));
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
