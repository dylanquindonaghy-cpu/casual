import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeScreenHint } from "@/app/home-screen-hint";
import { shouldShowHomeScreenHint } from "@/lib/portal/home-screen";

// "Put your shifts on your home screen" (docs/screens.md): iPhone and iPad only, not when already
// on the home screen, and never after "Don't show again".

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const device = (o: Partial<Parameters<typeof shouldShowHomeScreenHint>[0]>) => ({
  userAgent: IPHONE,
  maxTouchPoints: 5,
  standalone: false,
  dismissed: false,
  ...o,
});

describe("shouldShowHomeScreenHint", () => {
  it("shows on an iPhone, and on an iPad (which says it's a Mac but has a touch screen)", () => {
    expect(shouldShowHomeScreenHint(device({}))).toBe(true);
    expect(shouldShowHomeScreenHint(device({ userAgent: IPAD, maxTouchPoints: 5 }))).toBe(true);
  });

  it("doesn't show on a real Mac, on Android, from the home screen, or once dismissed", () => {
    expect(shouldShowHomeScreenHint(device({ userAgent: IPAD, maxTouchPoints: 0 }))).toBe(false);
    expect(shouldShowHomeScreenHint(device({ userAgent: ANDROID }))).toBe(false);
    expect(shouldShowHomeScreenHint(device({ standalone: true }))).toBe(false);
    expect(shouldShowHomeScreenHint(device({ dismissed: true }))).toBe(false);
  });

  it("renders nothing on the server (the phone decides after the page loads)", () => {
    expect(renderToStaticMarkup(createElement(HomeScreenHint))).toBe("");
  });
});
