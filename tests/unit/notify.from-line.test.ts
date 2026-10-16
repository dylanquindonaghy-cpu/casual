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
      // (The credential scan goes through sendToWorker since 13.5: the worker's own channel.)
      "src/lib/inbound/reply.ts",
    ]);
    for (const m of found) expect(m.next, m.path).toMatch(/\bfrom\b/);
    // Written on one line: the same rule.
    const oneLine = /\{ channel: "(whatsapp|sms)"(?: as const)?, to: [^,]+, ([^}]*)\}/g;
    const short = files.flatMap((f) =>
      [...f.text.matchAll(oneLine)].map((m) => ({ path: f.path, rest: m[2] ?? "" })),
    );
    expect(short.map((m) => m.path).sort()).toEqual(["src/lib/inbound/opt-out.ts"]);
    for (const m of short) expect(m.rest, m.path).toMatch(/\bfrom: /);
  });

  it("only the STOP / START confirmation sends a text directly: every other text goes through sendToWorker() (never to a worker who replied STOP)", () => {
    const texts = files.filter((f) =>
      /channel: "sms"(?: as const)?,\s*(?:\n\s*)?to: /.test(f.text),
    );
    expect(texts.map((f) => f.path)).toEqual(["src/lib/inbound/opt-out.ts"]);
  });

  it("every call to sendToWorker() or notifyWorker() names `from`", () => {
    const calls = files.flatMap((f) =>
      [...f.text.matchAll(/\b(sendToWorker|notifyWorker)\((?:tx, )?deps, \{([\s\S]*?)\}\);/g)].map(
        (m) => ({ path: f.path, args: m[2] ?? "" }),
      ),
    );
    expect(calls.map((c) => c.path).sort()).toEqual([
      "src/lib/inbound/reply.ts",
      "src/lib/notices/enquiry-reply.ts", // the office's reply on Enquiries (12D.1)
      "src/lib/notices/firm-change.ts",
      "src/lib/notices/pay-query-update.ts",
      "src/lib/notices/request-update.ts",
      "src/lib/notices/shift-confirmed.ts",
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

  it("every call to sendToWorker() or notifyWorker() passes the worker's own STOP setting", () => {
    const calls = files.flatMap((f) =>
      [...f.text.matchAll(/\b(sendToWorker|notifyWorker)\((?:tx, )?deps, \{([\s\S]*?)\}\);/g)].map(
        (m) => ({ path: f.path, args: m[2] ?? "" }),
      ),
    );
    expect(calls).toHaveLength(9);
    // Never a hard-coded value: always the worker's, read with their channel.
    for (const c of calls) expect(c.args, c.path).toMatch(/\bsmsAllowed: \w+\.smsAllowed,/);
    // Where each reads it: the worker row's sms_opted_out_at.
    for (const path of [
      "src/lib/inbound/reply.ts",
      "src/lib/notices/enquiry-reply.ts", // and a stranger's own last STOP or START (12D.1)
      "src/lib/notices/firm-change.ts",
      "src/lib/notices/pay-query-update.ts",
      "src/lib/notices/request-update.ts",
      "src/lib/notices/shift-confirmed.ts",
      "src/lib/offers/candidates.ts", // the offer waves' and the office offer's workers
      "src/lib/reminders/send.ts",
    ]) {
      const text = files.find((f) => f.path === path)?.text ?? "";
      expect(text, path).toMatch(/smsOptedOutAt|sms_opted_out_at is null as sms_allowed/);
    }
  });

  it("the shared sender passes `from` on to both tries (WhatsApp, then the text fallback)", () => {
    const notify = files.find((f) => f.path === "src/lib/notify/send.ts")?.text ?? "";
    expect(
      notify.match(/transport\.send\(\{[\s\S]*?\}\)/g)?.map((s) => /\.\.\.from,/.test(s)),
    ).toEqual([true, true]);
  });
});
