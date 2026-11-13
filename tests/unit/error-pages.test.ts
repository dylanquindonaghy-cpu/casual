import { readFileSync, readdirSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAppEnv } from "@/lib/env";

// The error pages' buttons (audit M4): "Try again" must fetch the page again. Next's reset() only
// redraws what the browser already has, so a page that failed on the server fails again; retry()
// fetches it first. The browser tests (tests/e2e/error-page.spec.ts) show a page, and a page's
// frame, that fail once recovering; these check each button is wired to the right thing, and that
// the test-only failures can't happen outside the e2e run.

vi.mock("@/app/use-online", () => ({ useOnline: () => true }));
// Whether React has taken over the page yet (src/app/use-hydrated.ts).
const page = vi.hoisted(() => ({ hydrated: true }));
vi.mock("@/app/use-hydrated", () => ({ useHydrated: () => page.hydrated }));
// The address the page failed on (src/app/error.tsx uses the office's words on /office ones).
const nav = vi.hoisted(() => ({ path: "/" as string | null }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => nav.path,
}));

const { default: ErrorPage } = await import("@/app/error");
const { ErrorBody, loadPageAgain } = await import("@/app/error-body");
const { default: GlobalError } = await import("@/app/global-error");
const { default: OfficeError } = await import("@/app/office/error");
const { OfficeErrorView } = await import("@/app/office/error-view");
const { default: OfficeNotFound } = await import("@/app/office/not-found");

type Props = {
  children?: ReactNode;
  onClick?: unknown;
  onSubmit?: unknown;
  href?: unknown;
  disabled?: unknown;
  type?: unknown;
};

// Every element in a tree a component returned (without rendering it).
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => elements(n));
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const textOf = (node: ReactNode): string =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map((n: ReactNode) => textOf(n)).join("")
      : isValidElement<Props>(node)
        ? textOf(node.props.children)
        : "";
const named = (tree: ReactNode, words: string) => {
  // The button or link with these words (a form around a button has its words too).
  const found = elements(tree).filter(
    (e) => (e.type === "button" || e.type === "a") && textOf(e) === words,
  );
  expect(found).toHaveLength(1);
  return found[0] as ReactElement<Props>;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  page.hydrated = true;
  nav.path = "/";
});

describe("a page fails (src/app/error.tsx)", () => {
  it("passes Next's retry() to the page, never reset()", () => {
    const retry = vi.fn();
    const reset = vi.fn();
    // Next gives the error page all three; only retry fetches the page again.
    const body = ErrorPage({ retry, reset, error: new Error("x") } as Parameters<
      typeof ErrorPage
    >[0]) as ReactElement<{ retry: unknown; online: unknown; ready: unknown }>;
    expect(body.type).toBe(ErrorBody);
    expect(body.props.retry).toBe(retry);
    expect(body.props.online).toBe(true);
    expect(body.props.ready).toBe(true);
    page.hydrated = false;
    expect((ErrorPage({ retry }) as ReactElement<{ ready: unknown }>).props.ready).toBe(false);
  });

  it("'Try again' calls retry", () => {
    const retry = vi.fn();
    const button = named(ErrorBody({ online: true, ready: true, retry }), "Try again");
    expect(button.type).toBe("button");
    expect(button.props.onClick).toBe(retry);
    expect(button.props.disabled).toBe(false);
  });

  // Audit review: with no signal, retry() can't reach the server and Next falls back to loading the
  // page, which puts the browser's own offline page in place of "No signal".
  it("with no signal, 'Try again' is off until the signal is back", () => {
    const button = named(ErrorBody({ online: false, ready: true, retry: vi.fn() }), "Try again");
    expect(button.props.disabled).toBe(true);
  });

  it("'Try again' is disabled until React has taken over the page (a tap before does nothing)", () => {
    const button = named(ErrorBody({ online: true, ready: false, retry: vi.fn() }), "Try again");
    expect(button.props.disabled).toBe(true);
  });

  it("'Go to my shifts' is a plain link, a full page load (a Next link to / keeps the error on /)", () => {
    const link = named(
      ErrorBody({ online: true, ready: false, retry: vi.fn() }),
      "Go to my shifts",
    );
    expect(link.type).toBe("a");
    expect(link.props.href).toBe("/");
  });
});

// Phase 37.6 (w1-08): an office page that fails keeps the office's frame and words.
describe("an office page fails (src/app/office/error.tsx, error-view.tsx)", () => {
  type ViewProps = { retry: unknown; online: unknown; ready: unknown };

  it("inside the office: the office's view, with Next's retry(), never reset()", () => {
    const retry = vi.fn();
    const reset = vi.fn();
    const body = OfficeError({ retry, reset, error: new Error("x") } as Parameters<
      typeof OfficeError
    >[0]) as ReactElement<ViewProps>;
    expect(body.type).toBe(OfficeErrorView);
    expect(body.props.retry).toBe(retry);
    expect(body.props.online).toBe(true);
    expect(body.props.ready).toBe(true);
  });

  it("the root error page uses the office's view on /office addresses (the frame itself failed)", () => {
    const retry = vi.fn();
    for (const path of ["/office", "/office/pay", "/office/shifts/abc"]) {
      nav.path = path;
      const body = ErrorPage({ retry }) as ReactElement<ViewProps>;
      expect(body.type, path).toBe(OfficeErrorView);
      expect(body.props.retry).toBe(retry);
    }
    for (const path of ["/shifts", "/", "/officers", null]) {
      nav.path = path;
      expect((ErrorPage({ retry }) as ReactElement).type, String(path)).toBe(ErrorBody);
    }
  });

  it("'Try again' calls retry, and waits for the page and the signal; 'Back to the office' is a full load", () => {
    const retry = vi.fn();
    const tree = OfficeErrorView({ online: true, ready: true, retry });
    const button = named(tree, "Try again");
    expect(button.type).toBe("button");
    expect(button.props.onClick).toBe(retry);
    expect(button.props.disabled).toBe(false);
    const notReady = OfficeErrorView({ online: true, ready: false, retry });
    expect(named(notReady, "Try again").props.disabled).toBe(true);
    const offline = OfficeErrorView({ online: false, ready: true, retry });
    expect(named(offline, "Try again").props.disabled).toBe(true);
    const back = named(tree, "Back to the office");
    expect(back.type).toBe("a");
    expect(back.props.href).toBe("/office");
  });

  it("its words: no 'contact the office' and no 'Go to my shifts'", () => {
    for (const online of [true, false]) {
      const tree = OfficeErrorView({ online, ready: true, retry: vi.fn() });
      const words = elements(tree)
        .flatMap((e) => [textOf(e), (e.props as { title?: unknown }).title])
        .filter((w): w is string => typeof w === "string")
        .join(" | ");
      expect(words).toContain(online ? "Something went wrong" : "No signal");
      expect(words).toContain(
        online ? "It's not you. Try again in a moment." : "Check your signal and try again.",
      );
      expect(words).not.toContain("contact the office");
      expect(words).not.toContain("Go to my shifts");
    }
  });
});

describe("the whole page fails (src/app/global-error.tsx)", () => {
  it("'Try again' submits a form: without the page's scripts the browser loads the page again", () => {
    const tree = GlobalError();
    const button = named(tree, "Try again");
    expect(button.props.type).toBe("submit");
    expect(button.props.disabled).toBeUndefined();
    const forms = elements(tree).filter((e) => e.type === "form");
    expect(forms).toHaveLength(1);
    expect(elements(forms[0]?.props.children)).toContain(button);
    expect(forms[0]?.props.onSubmit).toBe(loadPageAgain);
  });

  it("with the scripts: loads the whole address again, as a plain load (never resending a form)", () => {
    const replace = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/shifts/open", search: "?view=past", replace, reload },
    });
    const event = { preventDefault: vi.fn() };
    loadPageAgain(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledExactlyOnceWith("/shifts/open?view=past");
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the test-only pages (E2E_TEST_PAGES)", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:p@localhost:5432/shiftdesk",
    APP_BASE_DOMAIN: "localhost:3000",
    SESSION_SECRET: "a-test-secret-that-is-long-enough-0123456789",
  };

  it("are off unless switched on, and only 'on' switches them on", () => {
    expect(parseAppEnv(base).E2E_TEST_PAGES).toBeUndefined();
    expect(parseAppEnv({ ...base, E2E_TEST_PAGES: "on" }).E2E_TEST_PAGES).toBe("on");
    expect(() => parseAppEnv({ ...base, E2E_TEST_PAGES: "yes" })).toThrow(/E2E_TEST_PAGES/);
  });

  it("are refused on any address but localhost, even if the switch were copied into a deployment", () => {
    expect(
      parseAppEnv({ ...base, APP_BASE_DOMAIN: "localhost:3100", E2E_TEST_PAGES: "on" })
        .E2E_TEST_PAGES,
    ).toBe("on");
    for (const domain of [
      "shiftdesk.example",
      "localhost.shiftdesk.example",
      "acme.localhost:3000",
    ]) {
      expect(() => parseAppEnv({ ...base, APP_BASE_DOMAIN: domain, E2E_TEST_PAGES: "on" })).toThrow(
        /E2E_TEST_PAGES/,
      );
    }
  });

  const failsOnce = async () => (await import("@/app/e2e/fails-once/page")).default;
  const opened = (id: string) => ({ searchParams: Promise.resolve({ id }) });
  const remembered = () =>
    (globalThis as Record<symbol, Set<string> | undefined>)[Symbol.for("shiftdesk.e2e.fails-once")];
  const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

  it("switched off (as everywhere but the e2e run), the page that fails is not found, and never fails", async () => {
    const FailsOnce = await failsOnce();
    await expect(FailsOnce(opened("unit-off"))).rejects.toMatchObject(NOT_FOUND);
    await expect(FailsOnce(opened("unit-off"))).rejects.toMatchObject(NOT_FOUND);
    expect(remembered()?.has("page:unit-off") ?? false).toBe(false);
  });

  it("switched on: fails the first time for an id, then works; a bad id is not found", async () => {
    vi.stubEnv("E2E_TEST_PAGES", "on");
    vi.resetModules();
    const FailsOnce = await failsOnce();
    await expect(FailsOnce(opened("unit-on"))).rejects.toThrow(/fails the first time, on purpose/);
    await expect(FailsOnce(opened("unit-on"))).resolves.toBeTruthy();
    await expect(FailsOnce(opened("Not OK"))).rejects.toMatchObject(NOT_FOUND);
    vi.resetModules();
  });

  const frameHook = async () => (await import("@/lib/e2e/fails-once")).frameFailsOnce;

  it("switched off, the root layout's hook does nothing, not even read the cookie", async () => {
    const frameFailsOnce = await frameHook();
    const readCookie = vi.fn(async () => "unit-frame-off");
    await expect(frameFailsOnce(readCookie)).resolves.toBeUndefined();
    expect(readCookie).not.toHaveBeenCalled();
  });

  it("switched on: the frame fails the first time for the cookie's id, then works", async () => {
    vi.stubEnv("E2E_TEST_PAGES", "on");
    vi.resetModules();
    const frameFailsOnce = await frameHook();
    const cookie = (value: string | undefined) => async () => value;
    await expect(frameFailsOnce(cookie(undefined))).resolves.toBeUndefined();
    await expect(frameFailsOnce(cookie("Not OK"))).resolves.toBeUndefined();
    await expect(frameFailsOnce(cookie("unit-frame-on"))).rejects.toThrow(/on purpose/);
    await expect(frameFailsOnce(cookie("unit-frame-on"))).resolves.toBeUndefined();
    vi.resetModules();
  });

  it("are never switched on by a deployment's files", () => {
    const files = [
      "Dockerfile",
      ".env.example",
      ...readdirSync("deploy").map((f) => `deploy/${f}`),
      ...readdirSync(".github/workflows").map((f) => `.github/workflows/${f}`),
    ];
    expect(files).toEqual(
      expect.arrayContaining([
        "deploy/docker-compose.yml",
        "deploy/env.example",
        ".github/workflows/deploy.yml",
      ]),
    );
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toContain("E2E_TEST_PAGES");
    }
  });
});

describe("an office page that isn't there, or isn't for this role (src/app/office/not-found.tsx)", () => {
  it("one line that is true for both, and the way back to the office (Phase 37 decision (4))", () => {
    const tree = OfficeNotFound();
    const words = elements(tree)
      .flatMap((e) => [textOf(e), (e.props as { title?: unknown }).title])
      .filter((w): w is string => typeof w === "string")
      .join(" | ");
    expect(words).toContain("We can't find that page.");
    expect(words).toContain("This page doesn't exist, or your role can't open it.");
    // The casual's not-found line is untrue for a page that exists but is refused.
    expect(words).not.toContain("The link may be old or mistyped.");
    expect(words).not.toContain("404");
    const back = elements(tree).filter((e) => textOf(e) === "Back to the office");
    expect(back).toHaveLength(1);
    expect(back[0]?.props.href).toBe("/office");
  });
});
