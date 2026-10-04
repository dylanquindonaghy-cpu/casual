import { createHash } from "node:crypto";
import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";
import { createLogger, type Level } from "@/lib/log";
import { maskPhone, maskText, maskWithoutLimit, redact } from "@/lib/log/mask";
import { createPgBossErrorLogger, pgBossErrorFields } from "@/worker/boss";

// No personal data in logs (docs/compliance.md): phone numbers in any shape, emails, names,
// secrets and database error details never reach a log line.

function capture() {
  const lines: { level: Level; json: Record<string, unknown>; raw: string }[] = [];
  const logger = createLogger({
    write: (raw, level) =>
      lines.push({ level, raw, json: JSON.parse(raw) as Record<string, unknown> }),
    now: () => new Date("2026-09-27T10:00:00.000Z"),
  });
  return { logger, lines };
}

const PHONES = [
  "+447700900123",
  "07700 900123",
  "07700900123",
  "447700900123",
  "0044 7700 900123",
  "+44 (0)7700 900123",
  "07700-900-123",
  "+44 7700 900 123",
];

describe("the logger", () => {
  it("writes one JSON line per call: ts, level, msg first, then the request id", () => {
    const { logger, lines } = capture();
    logger
      .child({ requestId: "5f0c8c1e-1d0e-4c5a-9a1a-3b2c1d0e9f8a" })
      .info("login link requested", {
        firmId: "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9",
      });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
    expect(Object.keys(lines[0]?.json ?? {})).toEqual([
      "ts",
      "level",
      "msg",
      "requestId",
      "firmId",
    ]);
    expect(lines[0]?.json).toEqual({
      ts: "2026-09-27T10:00:00.000Z",
      level: "info",
      msg: "login link requested",
      requestId: "5f0c8c1e-1d0e-4c5a-9a1a-3b2c1d0e9f8a",
      firmId: "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9",
    });
  });

  it("fields can't overwrite ts, level or msg", () => {
    const { logger, lines } = capture();
    logger.warn("real", { ts: "fake", level: "info", msg: "fake" });
    expect(lines[0]?.json).toMatchObject({
      ts: "2026-09-27T10:00:00.000Z",
      level: "warn",
      msg: "real",
    });
  });

  it.each(PHONES)(
    "masks the phone number %s in the message, keeping only the last 3 digits",
    (phone) => {
      const { logger, lines } = capture();
      logger.error(`no worker with number ${phone} here`);
      const msg = String(lines[0]?.json.msg);
      expect(msg).toMatch(/123 here$/);
      expect(msg).not.toMatch(/7700\s?900/);
      expect(lines[0]?.raw.replace(/\D/g, "")).not.toContain("7700900");
    },
  );

  it("masks phones and emails in nested fields, arrays, errors and error causes", () => {
    const { logger, lines } = capture();
    const cause = new Error("upstream said 07700 900456 is unknown");
    logger.error("failed", {
      nested: { note: "call +447700900123 back", list: ["jo@example.com", "0044 7700 900789"] },
      error: new Error("could not reach 07700900321", { cause }),
    });
    const raw = lines[0]?.raw ?? "";
    for (const leak of ["7700900", "7700 900", "jo@example.com"]) expect(raw).not.toContain(leak);
    expect(raw).toContain("***@example.com");
    expect(raw).toContain("456"); // last 3 digits kept, enough to tell numbers apart
  });

  it("replaces secret and name fields at any depth, and withholds query details", () => {
    const out = JSON.stringify(
      redact({
        token: "abc",
        session: { tokenHash: "x", cookie: "sd=1", authorization: "Bearer y", password: "p" },
        worker: {
          firstName: "Jo",
          lastName: "Bloggs",
          email: "jo@example.com",
          mobileE164: "+447700900123",
        },
        err: { detail: "Key (mobile)=(+447700900123)", params: ["Jo"], query: "select ..." },
      }),
    );
    for (const leak of ["abc", "Bearer", "sd=1", "Jo", "Bloggs", "7700900", "select"]) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain("[redacted]");
    expect(out).toContain("[withheld]");
  });

  it("drops a pg error's detail but keeps its SQLSTATE, table and constraint", () => {
    const err = new DatabaseError(
      'duplicate key value violates unique constraint "workers_firm_id_mobile_key"',
      1,
      "error",
    );
    err.code = "23505";
    err.detail =
      "Key (firm_id, mobile_e164)=(0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9, +447700900123) already exists.";
    err.table = "workers";
    err.constraint = "workers_firm_id_mobile_key";
    const out = redact(err) as Record<string, unknown>;
    expect(out).toMatchObject({
      code: "23505",
      table: "workers",
      constraint: "workers_firm_id_mobile_key",
    });
    expect(out.detail).toBe("[withheld]");
    expect(JSON.stringify(out)).not.toContain("7700900");
  });

  it("keeps a stack's code locations but not its first line (which repeats the message)", () => {
    const out = redact(new Error("ring 07700900123")) as { stack: string[] };
    expect(out.stack.length).toBeGreaterThan(0);
    expect(out.stack.every((line) => line.startsWith("at "))).toBe(true);
    expect(JSON.stringify(out)).not.toContain("7700900");
  });

  it("leaves ids, dates and error codes alone", () => {
    const text =
      "firm 0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9 at 2026-09-27 17:39:06 code 23505 wave 12";
    expect(maskText(text)).toBe(text);
  });

  it("masks any bare run of 10+ digits (a UK mobile without its 0 is 10 digits)", () => {
    expect(maskText("ref 7700900123")).toBe("ref *******123");
  });

  // Regression cases from the guardrails review: each of these leaked before.
  it.each([
    ["a date next to the number", "shift 2026-09-27 07700 900123 cancelled"],
    ["a date before a bracketed number", "2026-09-27 (07700 900123)"],
    ["a number glued to a hyphenated word", "worker-07700900123"],
    ["a number followed by a hyphen", "07700900123-job"],
    ["a number glued to letters", "Mob07700900123"],
    ["a number after an underscore", "tel_447700900123"],
    ["a number followed by letters", "+447700900123abc"],
    ["a percent-encoded +", "/x/%2B447700900123"],
    ["a percent-encoded space", "/x/07700%20900123"],
    ["a UK-format date right before the number", "27-09-2026 07700 900123"],
    ["a job number right before the number", "job 12345 07700 900123"],
    ["a long digit run ending in the number", "1695812345447700900123"],
    ["two numbers run together", "447700900123447700900456"],
  ])("masks %s", (_label, text) => {
    expect(maskText(text).replace(/\D/g, "")).not.toContain("7700900");
  });

  it("withholds drizzle's query text wherever it appears, not just at the start", () => {
    const wrapped = `save failed: Failed query: insert into workers values ($1, $2)\nparams: Priya,Secretname`;
    const out = JSON.stringify(redact({ reason: wrapped, error: new Error(wrapped) }));
    expect(out).not.toContain("Priya");
    expect(out).not.toContain("insert into");
    expect(out).toContain("Failed query (details withheld)");
  });

  it("withholds input values Postgres quotes back in its messages", () => {
    for (const message of [
      'invalid input syntax for type uuid: "Priya Secretname"',
      'invalid input syntax for type integer: "Priya"',
      'invalid input syntax for type timestamp with time zone: "Priya"',
      'value "Priya Secretname" is out of range for type integer',
    ]) {
      expect(maskText(message)).not.toContain("Priya");
    }
  });

  it("keeps only real stack frames, masked, even when the message has lines starting 'at '", () => {
    const err = new Error("Failed query: x");
    err.stack = `Error: note\nat 5pm ring Priya on 07700 900 123 ok\n    at save (/app/src/x.ts:10:5)\n    at /app/src/y.ts:3:1`;
    const out = redact(err) as { stack: string[] };
    expect(out.stack).toEqual(["at save (/app/src/x.ts:10:5)", "at /app/src/y.ts:3:1"]);
  });

  it("cuts a stack's message lines even when they look like frames", () => {
    const err = new Error("note\nat Priya Secretname's house 19:30:00");
    err.stack = `Error: ${err.message}\n    at save (/app/src/x.ts:10:5)`;
    expect((redact(err) as { stack: string[] }).stack).toEqual(["at save (/app/src/x.ts:10:5)"]);
  });

  // The patterns themselves (maskWithoutLimit): this string is longer than maskText takes
  // (MAX_TEXT, audit M13), and maskText's cut drops a trailing run of numbers whole.
  it("masks a very long run of digits quickly (no runaway backtracking)", () => {
    const text = `${"1 2-3.(4) ".repeat(2000)}x`;
    const started = performance.now();
    const out = maskWithoutLimit(text);
    expect(performance.now() - started).toBeLessThan(200);
    expect(out.replace(/\D/g, "").length).toBe(3);
    expect(maskText(text).replace(/\D/g, "")).toBe("");
  });

  it("masks object keys, not just values", () => {
    const out = JSON.stringify(redact({ "+447700900123": { seen: true } }));
    expect(out.replace(/\D/g, "")).not.toContain("7700900");
  });

  it.each([
    "name",
    "displayName",
    "surname",
    "body",
    "accessToken",
    "session_token",
    "apiKey",
    "authToken",
    "privateKey",
    "connectionString",
    "DATABASE_URL",
    "clientIp",
  ])("replaces the value of a field named %s", (key) => {
    expect(redact({ [key]: "Priya s3cret" })).toEqual({ [key]: "[redacted]" });
  });

  it("withholds a digits-only code (an OTP) but keeps a Postgres SQLSTATE", () => {
    expect(redact({ code: "482913" })).toEqual({ code: "[withheld]" });
    expect(redact({ code: 482913 })).toEqual({ code: "[withheld]" });
    expect(redact({ code: "23505" })).toEqual({ code: "23505" });
    expect(redact({ code: "22P02" })).toEqual({ code: "22P02" });
  });

  it("strips query strings and fragments from links and paths in any string", () => {
    const text = "sent https://acme.shiftdesk.co.uk/l#tok3n and /login?t=abc&mobile=07700900123";
    const out = maskText(text);
    for (const leak of ["tok3n", "abc", "7700900"]) expect(out).not.toContain(leak);
    expect(out).toContain("https://acme.shiftdesk.co.uk/l?[withheld]");
  });

  it("masks a phone number stored as a number", () => {
    expect(JSON.stringify(redact({ n: 447700900123 }))).not.toContain("7700900");
  });

  it("leaves Twilio ids alone (2 capitals + 32 lowercase hex), even with a 10+ digit run inside", () => {
    // 1,000 ids spread evenly over the hex digits (a sha256 of the index): about 1 in 12 holds a
    // run of 10 or more digits, which the phone pattern would otherwise mask, and the action log
    // would then refuse (audit finding M12).
    const ids = Array.from(
      { length: 1000 },
      (_, i) =>
        ["SM", "MM", "CA", "RE"][i % 4] +
        createHash("sha256").update(String(i)).digest("hex").slice(0, 32),
    );
    const withRun = ids.filter((id) => /\d{10}/.test(id));
    expect(withRun.length).toBeGreaterThan(40);
    expect(withRun.length).toBeLessThan(140);
    expect(withRun.filter((id) => /[c-f]/.test(id)).length).toBe(withRun.length);
    // And real-looking ones with every hex letter next to a long run.
    ids.push("SM1234567890cdef0123456789abcdef01", "MMfedcba98765432100123456789abcdef");
    for (const id of ids) {
      expect(maskText(id)).toBe(id);
      expect(redact({ providerMessageId: id })).toEqual({ providerMessageId: id });
    }
    // A phone number next to one is still masked.
    const id = "SM1234567890cdef0123456789abcdef01";
    expect(maskText(`${id} to +447700900123`)).toBe(`${id} to +*********123`);
    // Only that exact shape: not uppercase hex, not glued to other letters or digits, not 31 or 33.
    for (const near of [
      "SM1234567890CDEF0123456789ABCDEF01",
      "xSM1234567890cdef0123456789abcdef01",
      "SM1234567890cdef0123456789abcdef011",
      "SM1234567890cdef0123456789abcdef0",
    ]) {
      expect(maskText(near)).not.toBe(near);
    }
  });

  it("the console transport's maskPhone keeps the country code and last 3 digits", () => {
    expect(maskPhone("+447700900123")).toBe("+44*******123");
  });
});

describe("pg-boss errors", () => {
  // What pg-boss really emits: a plain object spreading a pg DatabaseError, whose detail can
  // carry a whole job row.
  const bossError = {
    name: "error",
    code: "23505",
    severity: "ERROR",
    table: "job_common",
    detail: 'Failing row contains (..., {"firmId": "x", "mobile": "+447700900123"})',
    where: "SQL statement ...",
    message: "duplicate key value violates unique constraint",
    stack:
      "error: duplicate key\n    at Parser.parseErrorMessage (node_modules/pg-protocol/dist/parser.js:1:1)",
    queue: "send-portal-link",
    worker: "w1",
  };

  it("keeps only the safe fields and the masked message", () => {
    expect(pgBossErrorFields(bossError)).toEqual({
      code: "23505",
      severity: "ERROR",
      table: "job_common",
      queue: "send-portal-link",
      worker: "w1",
      message: "duplicate key value violates unique constraint",
    });
  });

  it("logs a repeating error once a minute, with a count of the repeats", () => {
    const { logger, lines } = capture();
    let t = 0;
    const onError = createPgBossErrorLogger(logger, { now: () => t });
    onError(bossError);
    t = 30_000;
    onError(bossError);
    onError(bossError);
    t = 61_000;
    onError(bossError);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.json.suppressedRepeats).toBe(2);
    expect(lines.map((l) => l.raw).join()).not.toContain("7700900");
  });
});
