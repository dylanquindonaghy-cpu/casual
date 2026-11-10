import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOGIN_AGAIN } from "@/lib/auth/login-again";
import { loginPageOf, STAFF_LOGIN_PAGE, staffLoginAfterRedirect } from "@/lib/auth/login-page";
import { seedId } from "@/lib/demo/seed-id";
import { STAFF_DEMO_FIRM_ID } from "@/lib/demo/staff-login";

// Phase 34 (34.1): where the staffing demo login is on (a demo server, on Acme), every redirect to a
// login lands on it; everywhere else, each side's own login page. /login and /office/login opened
// by address still show (only a redirect's `out=1` or `again=1` sends them on).

const NORTHLINE = seedId("firm/northline");

describe("where a redirect to a login goes", () => {
  it("on the staffing demo (demo mode, Acme): the staffing login, for the office and the casual app", () => {
    expect(STAFF_LOGIN_PAGE).toBe("/start/login");
    expect(loginPageOf("office", "on", STAFF_DEMO_FIRM_ID)).toBe("/start/login");
    expect(loginPageOf("worker", "on", STAFF_DEMO_FIRM_ID)).toBe("/start/login");
  });

  it("anywhere else: each side's own login page", () => {
    for (const [mode, firm] of [
      ["", STAFF_DEMO_FIRM_ID],
      [undefined, STAFF_DEMO_FIRM_ID],
      ["off", STAFF_DEMO_FIRM_ID],
      ["on", NORTHLINE],
      ["on", null],
    ] as const) {
      expect(loginPageOf("office", mode, firm), `${mode} ${firm}`).toBe("/office/login");
      expect(loginPageOf("worker", mode, firm), `${mode} ${firm}`).toBe("/login");
    }
  });
});

describe("/login and /office/login after a redirect", () => {
  it("on the staffing demo, Log out's page goes on to the staffing login, still saying you're logged out", () => {
    expect(staffLoginAfterRedirect("office", STAFF_DEMO_FIRM_ID, { out: "1" }, "on")).toBe(
      "/start/login?out=1",
    );
    expect(staffLoginAfterRedirect("worker", STAFF_DEMO_FIRM_ID, { out: "1" }, "on")).toBe(
      "/start/login?out=1",
    );
  });

  it("on the staffing demo, an action that found the session gone goes on to the staffing login", () => {
    expect(LOGIN_AGAIN).toBe("/login?again=1");
    expect(staffLoginAfterRedirect("worker", STAFF_DEMO_FIRM_ID, { again: "1" }, "on")).toBe(
      "/start/login",
    );
  });

  it("opened by address, the page itself shows, on the demo too", () => {
    expect(staffLoginAfterRedirect("worker", STAFF_DEMO_FIRM_ID, {}, "on")).toBeNull();
    expect(staffLoginAfterRedirect("office", STAFF_DEMO_FIRM_ID, {}, "on")).toBeNull();
    expect(staffLoginAfterRedirect("worker", STAFF_DEMO_FIRM_ID, { out: "2" }, "on")).toBeNull();
  });

  it("anywhere else, the page itself shows after a redirect too", () => {
    expect(staffLoginAfterRedirect("office", NORTHLINE, { out: "1" }, "on")).toBeNull();
    expect(staffLoginAfterRedirect("worker", NORTHLINE, { again: "1" }, "on")).toBeNull();
    expect(staffLoginAfterRedirect("worker", STAFF_DEMO_FIRM_ID, { out: "1" }, "")).toBeNull();
    expect(
      staffLoginAfterRedirect("office", STAFF_DEMO_FIRM_ID, { out: "1" }, undefined),
    ).toBeNull();
  });
});

describe("every redirect to a login goes through these", () => {
  const ROOT = process.cwd();
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

  it("the pages' own redirects ask loginPageFor, and no client page sends the browser to a bare /login", () => {
    expect(read("src/lib/auth/current-office.ts")).toContain(
      'if (!session) redirect(await loginPageFor("office"));',
    );
    expect(read("src/lib/auth/current-worker.ts")).toContain(
      'if (!session) redirect(await loginPageFor("worker"));',
    );
    expect(read("src/app/start/guide/page.tsx")).toContain(
      'if (!session) redirect(await loginPageFor("office"));',
    );
    expect(read("src/app/login/page.tsx")).toContain(
      'staffLoginAfterRedirect("worker", firm.id, { out, again })',
    );
    expect(read("src/app/office/login/page.tsx")).toContain(
      'staffLoginAfterRedirect("office", firm.id, { out })',
    );
    // Anywhere in src: no redirect straight to a bare login page (it would skip the staffing login).
    const files = (dir: string): string[] =>
      readdirSync(join(ROOT, dir)).flatMap((name) => {
        const path = `${dir}/${name}`;
        if (statSync(join(ROOT, path)).isDirectory()) return files(path);
        return /\.tsx?$/.test(name) ? [path] : [];
      });
    const bare = /(router\.(replace|push)|redirect)\(\s*"\/(office\/)?login"\s*\)/;
    expect(files("src").filter((path) => bare.test(read(path)))).toEqual([]);
  });
});
