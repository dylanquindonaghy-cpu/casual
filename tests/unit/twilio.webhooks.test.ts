import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every Twilio webhook checks Twilio's signature before anything else and stores what it receives
// at most once (golden rule 3; docs/api-and-jobs.md "Twilio webhooks"). This reads the source, so a
// new webhook (the delivery-status one, say) can't skip either: it fails here until it's listed and
// follows the same shape. Each webhook's own tests prove the behaviour (tests/integration/
// inbound.whatsapp, inbound.sms, inbound.voice: refusals store nothing, a repeat stores and sends
// nothing more); the shared checks are src/lib/inbound/twilio-request.ts.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
// Without comment lines.
const code = (path: string) =>
  read(path)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

function routesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (statSync(join(ROOT, path)).isDirectory()) return routesUnder(path);
    return entry === "route.ts" ? [path] : [];
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = join(ROOT, dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(relative(ROOT, path));
    return /\.tsx?$/.test(entry) ? [relative(ROOT, path)] : [];
  });
}

// Each route and the handler it hands the request to.
const WEBHOOKS: Record<string, { handler: string; file: string }> = {
  "src/app/api/webhooks/twilio/whatsapp/route.ts": {
    handler: "handleTwilioWhatsApp",
    file: "src/lib/inbound/webhook.ts",
  },
  "src/app/api/webhooks/twilio/sms/route.ts": {
    handler: "handleTwilioSms",
    file: "src/lib/inbound/webhook.ts",
  },
  "src/app/api/webhooks/twilio/voice/route.ts": {
    handler: "handleTwilioVoice",
    file: "src/lib/inbound/voice.ts",
  },
  "src/app/api/webhooks/twilio/voice/transcription/route.ts": {
    handler: "handleTwilioTranscription",
    file: "src/lib/inbound/voice.ts",
  },
  "src/app/api/webhooks/twilio/voice/done/route.ts": {
    handler: "handleTwilioVoiceDone",
    file: "src/lib/inbound/voice.ts",
  },
};

// A function's body, from its declaration to the next top-level declaration.
function body(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`no function ${name}`);
  const next = source.slice(start + 1).search(/\n(export |async function |function |const )/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("every Twilio webhook", () => {
  it("is listed here (a new one must be added, and so checked)", () => {
    expect(routesUnder("src/app/api/webhooks/twilio").sort()).toEqual(Object.keys(WEBHOOKS).sort());
  });

  it.each(Object.entries(WEBHOOKS))(
    "%s: POST only, the configured token, its own address from configuration (never the request's)",
    (route, { handler }) => {
      const source = read(route);
      expect(
        [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]),
      ).toEqual(["POST"]);
      expect(source).toMatch(new RegExp(`return ${handler}\\(request, \\{`));
      expect(source).toMatch(/authToken: env\.TWILIO_AUTH_TOKEN,/);
      expect(source).not.toMatch(/request\.url|headers\.get\(|nextUrl/);
      // The address the signature is checked against: this route's own path.
      const own = /(?:webhookUrl|voiceUrl): platformUrl\(env\.APP_BASE_DOMAIN, ([^)]+)\)/.exec(
        source,
      )?.[1];
      const path =
        own && /^"[^"]+"$/.test(own)
          ? own.slice(1, -1)
          : new RegExp(`const ${own ?? "?"} = "([^"]+)";`).exec(source)?.[1];
      expect(path).toBe(`/${route.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "")}`);
    },
  );

  it.each(Object.entries(WEBHOOKS))(
    "%s: the handler's first step is Twilio's checks, and a refusal returns at once",
    (_route, { handler, file }) => {
      const fn = body(read(file), handler);
      const firstAwait = fn.indexOf("await ");
      expect(fn.slice(firstAwait)).toMatch(
        /^await readTwilioRequest\(request, \{\s*authToken: deps\.authToken,\s*webhookUrl: deps\.(webhookUrl|voiceUrl),/,
      );
      expect(fn).toMatch(/\}\);\s*if \(!read\.ok\) return read\.response;/);
      // Nothing from the request is read before the checks pass.
      expect(fn.slice(0, firstAwait)).not.toMatch(/request\./);
    },
  );

  it("the shared checks: the token, the size, a repeated field, then the signature for this address", () => {
    const checks = body(read("src/lib/inbound/twilio-request.ts"), "readTwilioRequest");
    const order = [
      "if (!opts.authToken)",
      "if (declared > MAX_WEBHOOK_BYTES)",
      "if (Object.hasOwn(fields, name))",
      "isValidTwilioSignature(opts.authToken, opts.webhookUrl, fields, signature)",
      "return { ok: true",
    ].map((s) => checks.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("only these handlers read Twilio's requests; nothing else in the app checks a Twilio signature", () => {
    const readers = sourceFiles("src")
      .filter((f) =>
        /readTwilioRequest\(|isValidTwilioSignature\(|x-twilio-signature/i.test(code(f)),
      )
      .sort();
    expect(readers).toEqual([
      "src/lib/inbound/twilio-request.ts",
      "src/lib/inbound/twilio-signature.ts",
      "src/lib/inbound/voice.ts",
      "src/lib/inbound/webhook.ts",
    ]);
  });
});

describe("what a Twilio webhook stores, it stores once", () => {
  // Every inbound row: keyed by Twilio's id (MessageSid, CallSid, RecordingSid) within the firm; a
  // repeat (Twilio's retry, or a replayed request: the signature has no timestamp) inserts nothing.
  // A casual's message in the app (Phase 25.6, src/lib/inbound/app.ts) is the one inbound row that
  // isn't Twilio's: its id is the form's own (one per message, kept for a repeat), checked apart.
  const APP = "src/lib/inbound/app.ts";
  const all = sourceFiles("src/lib").flatMap((file) =>
    [...read(file).matchAll(/\.insert\(messages\)\s*\.values\(\{([\s\S]*?)\}\)([\s\S]*?);/g)]
      .filter((m) => /direction: "in"/.test(m[1] ?? ""))
      .map((m) => ({ file, values: m[1] ?? "", after: m[2] ?? "", at: m.index ?? 0 })),
  );
  const inserts = all.filter((i) => i.file !== APP);

  it("every inbound insert is in the webhooks' storage (none anywhere else)", () => {
    expect(all.map((i) => i.file).sort()).toEqual([
      APP,
      "src/lib/inbound/receive.ts",
      "src/lib/inbound/voice.ts",
      "src/lib/inbound/voice.ts",
    ]);
  });

  it("a message in the app: channel app, the form's own id, theirs, and its job in the same transaction", () => {
    const [app] = all.filter((i) => i.file === APP);
    expect(app?.values).toMatch(/channel: "app",/);
    expect(app?.values).toMatch(/providerMessageId,/);
    expect(read(APP)).toContain("const providerMessageId = `app:${clientId ?? randomUUID()}`;");
    // A repeat of the form's own id stores nothing and queues nothing.
    expect(app?.after).toMatch(
      /^\s*\.onConflictDoNothing\(\{ target: \[messages\.firmId, messages\.providerMessageId\] \}\)\s*\.returning\(\{ id: messages\.id \}\)$/,
    );
    expect(app?.values).toMatch(/workerId,/);
    const rest = read(APP).slice(app?.at ?? 0);
    expect(rest).toMatch(/^[\s\S]*?await queueInboundMessage\(tx, row\.id\);/);
  });

  it("each one does nothing on a repeat of Twilio's id, and only a new row gets a job or an event", () => {
    for (const { file, after, at } of inserts) {
      expect(after, file).toMatch(
        /^\s*\.onConflictDoNothing\(\{ target: \[messages\.firmId, messages\.providerMessageId\] \}\)\s*\.returning\(\{ id: messages\.id \}\)$/,
      );
      // The next thing after the insert: nothing more unless a row came back.
      const rest = read(file).slice(at);
      const next = rest.slice(rest.indexOf(".returning({ id: messages.id });") + 1);
      expect(next.trimStart().slice(0, 60), file).toMatch(/^[^\n]*\n\s*if \(!row\) return/);
    }
  });

  it("the key it relies on is unique within the firm", () => {
    expect(read("src/lib/db/schema/messages.ts")).toMatch(
      /unique\("messages_firm_id_provider_message_id_key"\)\.on\(t\.firmId, t\.providerMessageId\)/,
    );
  });
});
