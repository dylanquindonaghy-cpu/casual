import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every WhatsApp and text message to a worker goes from the firm's own number, its shifts line
// (Phase 7; firms.shifts_line_e164). sendToWorker() and notifyWorker() take `from` as a required
// argument, so the type checker holds their callers to it; this test holds the rest: every message
// built with a fixed WhatsApp or text channel passes the firm's line as `from`, and every call to
// the two helpers names `from`. A new sender must follow suit. That the right number arrives is
// behaviour, tested in tests/integration/shifts-line.test.ts.

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(process.cwd(), path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

describe("messages go from the firm's shifts line", () => {
  it("every message built with a fixed WhatsApp or text channel passes the line as `from`", () => {
    // A message literal: the channel, then `to` on the next line (event data has no `to`).
    const message = /channel: "(whatsapp|sms)"(?: as const)?,\s*\n\s*to: [^\n]+\n([^\n]*)/g;
    const found = files.flatMap((f) =>
      [...f.text.matchAll(message)].map((m) => ({ path: f.path, next: m[2] ?? "" })),
    );
    expect(found.map((m) => m.path).sort()).toEqual([
      "src/lib/auth/send-login-code.ts",
      "src/lib/auth/send-portal-link.ts",
      "src/lib/credentials/scan.ts",
      "src/lib/credentials/scan.ts",
      "src/lib/inbound/reply.ts",
    ]);
    for (const m of found) expect(m.next, m.path).toMatch(/\bfrom\b/);
  });

  it("every call to sendToWorker() or notifyWorker() names `from`", () => {
    const calls = files.flatMap((f) =>
      [...f.text.matchAll(/\b(sendToWorker|notifyWorker)\((?:tx, )?deps, \{([\s\S]*?)\}\);/g)].map(
        (m) => ({ path: f.path, args: m[2] ?? "" }),
      ),
    );
    expect(calls.map((c) => c.path).sort()).toEqual([
      "src/lib/inbound/reply.ts",
      "src/lib/notices/firm-change.ts",
      "src/lib/notices/pay-query-update.ts",
      "src/lib/notices/request-update.ts",
      "src/lib/offers/office-offer.ts",
      "src/lib/offers/waves.ts",
      "src/lib/reminders/send.ts",
    ]);
    for (const c of calls) {
      expect(c.args, c.path).toMatch(/\bfrom: /);
      // The type checker allows a hard-coded null; the firm's line is the only source.
      expect(c.args, c.path).not.toMatch(/\bfrom: null\b/);
    }
  });

  it("the shared sender passes `from` on to both tries (WhatsApp, then the text fallback)", () => {
    const notify = files.find((f) => f.path === "src/lib/notify/send.ts")?.text ?? "";
    expect(
      notify.match(/transport\.send\(\{[\s\S]*?\}\)/g)?.map((s) => /\.\.\.from,/.test(s)),
    ).toEqual([true, true]);
  });
});
