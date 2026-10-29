"use client";

import { useEffect } from "react";
import { chromeAfterScroll, type ChromeState } from "@/lib/portal/chrome";

// The casual app's chrome as you scroll (Phase 24, 24.6: round 7 of the canvas), on <html>, so the
// firm's bar and the tab bar can follow it in CSS: `data-js` once the page runs (the bar stays at
// the top only then: without JavaScript it stays in the page, so nothing scrolls under words with
// no frost behind them; the copy kept for no signal keeps its scripts, so it runs there too),
// `data-scrolled` while the page is
// scrolled under the bar (its frosted edge fades in: `scroll-edge`), and `data-tabs-mini` while
// you scroll down (the tab bar shrinks to its icons; scrolling up, reaching the top, or a tap on
// the bar opens it again: src/lib/portal/chrome.ts). Not under the office's shell, which has its
// own. Renders nothing.
export function ChromeWatch() {
  useEffect(() => {
    if (document.querySelector("[data-shell=office]")) return;
    const root = document.documentElement;
    root.dataset.js = "";
    let state: ChromeState = { scrolled: false, mini: false, last: window.scrollY };
    const show = () => {
      if (state.scrolled) root.dataset.scrolled = "";
      else delete root.dataset.scrolled;
      if (state.mini) root.dataset.tabsMini = "";
      else delete root.dataset.tabsMini;
    };
    const onScroll = () => {
      state = chromeAfterScroll(window.scrollY, state);
      show();
    };
    const onTap = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-tab-bar]")) {
        state = { ...state, mini: false, last: window.scrollY };
        show();
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("pointerdown", onTap, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointerdown", onTap);
      delete root.dataset.js;
      delete root.dataset.scrolled;
      delete root.dataset.tabsMini;
    };
  }, []);
  return null;
}
