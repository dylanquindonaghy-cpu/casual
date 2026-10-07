import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_PURPOSES } from "@/lib/ai/client";

// "AI never answers a dispute" (Phase 6; golden rules 1 and 9; docs/compliance.md "Pay disputes
// always go to a person"). The AI code (src/lib/ai/) does two things: a summary line for payroll
// about a group of pay queries, beneath the app's own line; and (Phase 7) a label for a worker's
// WhatsApp on the shifts line that no keyword matched, which only picks which of the app's own fixed
// replies goes back (src/lib/inbound/reply.ts). This test is a tripwire:
// - the AI's purposes are a fixed list: that summary, and the shifts line label;
// - only three files import src/lib/ai/: payroll's grouped view, the digest job, and the shifts
//   line's reply job (which only ever sends shiftsLineReply()'s fixed words); the AI line is made
//   in one place (summariseGroups, called only by the digest); the files that import those are
//   listed too, so passing their output anywhere new means changing this test;
// - no AI SDK (Bedrock, Anthropic) is imported outside src/lib/ai/;
// - nothing a worker sees or receives can reach src/lib/ai/: the staff pages, the portal code, the
//   notices and notify code, the message templates; nor can payroll's "sort and tell them" path,
//   from the form where the note is typed through the server action to the database (so the note
//   the worker gets is the person's own words), and the form takes nothing but the query ids; nor
//   can payroll's pay import, where the pay figures come in.
// A new use of AI must be added here on purpose. It can't see everything (an AI client handed
// around as a plain object without its type, say); it catches the likely mistakes. The behaviour (the worker's message is payroll's
// note in the doc's template, word for word) is tested in tests/integration/pay.resolve.test.ts.

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const rel = (path: string) => relative(process.cwd(), path).replace(/\\/g, "/");

// Every import and re-export, type-only ones included (even a type ties code to the AI module).
function imports(text: string): string[] {
  const specs: string[] = [];
  const statement = /^\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const m of text.matchAll(statement)) if (m[1]) specs.push(m[1]);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) if (m[1]) specs.push(m[1]);
  return specs;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

const files = sourceFiles(SRC);
const graph = new Map(
  files.map((file) => [
    file,
    imports(readFileSync(file, "utf8"))
      .map((spec) => resolveLocal(file, spec))
      .filter((f): f is string => f !== null),
  ]),
);
const isAi = (file: string) => rel(file).startsWith("src/lib/ai/");

// The first chain from `entry` into src/lib/ai/, or null.
function aiChain(entry: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    if (isAi(file)) return [...chain, rel(file)];
    for (const next of graph.get(file) ?? []) {
      const found = walk(next, [...chain, rel(file)]);
      if (found) return found;
    }
    return null;
  };
  return walk(entry, []);
}

describe("AI never answers a dispute", () => {
  it("the AI does two jobs: a summary line for payroll, and a label for a shifts line message", () => {
    expect([...AI_PURPOSES]).toEqual(["pay_group_summary", "classify_message"]);
  });

  it("only payroll's grouped view, the digest and the shifts line's reply job import the AI code", () => {
    const importers = files
      .filter((file) => !isAi(file) && (graph.get(file) ?? []).some(isAi))
      .map(rel)
      .sort();
    expect(importers).toEqual([
      "src/lib/inbound/reply.ts",
      "src/lib/office/pay-query-groups.ts",
      "src/lib/pay/digest.ts",
    ]);
  });

  it("only these files import the two modules that use AI", () => {
    const AI_USERS = ["src/lib/office/pay-query-groups.ts", "src/lib/pay/digest.ts"];
    const importersOf = (target: string) =>
      files
        .filter((file) => (graph.get(file) ?? []).some((f) => rel(f) === target))
        .map(rel)
        .sort();
    expect(importersOf(AI_USERS[0] ?? "")).toEqual([
      "src/app/office/pay-queries/page.tsx",
      "src/lib/pay/digest-list.ts",
      "src/lib/pay/digest.ts",
    ]);
    expect(importersOf(AI_USERS[1] ?? "")).toEqual([
      "src/app/office/pay-queries/actions.ts",
      "src/lib/office/pay-digest-copy.ts",
      "src/lib/office/pay-digest-view.ts",
      "src/lib/office/quick-actions.ts",
      "src/worker/jobs/index.ts",
      "src/worker/jobs/queues.ts",
    ]);
  });

  it("the shifts line's reply job is only worked by the job worker; its reply is always a fixed text", () => {
    const importers = files
      .filter((file) => (graph.get(file) ?? []).some((f) => rel(f) === "src/lib/inbound/reply.ts"))
      .map(rel);
    expect(importers).toEqual(["src/worker/jobs/index.ts"]);
    const reply = readFileSync(join(SRC, "lib/inbound/reply.ts"), "utf8");
    // Every message it sends is one of the app's fixed texts: the worker's reply (`replyText`, which is
    // shiftsLineReply()'s answer, or voicemailReceivedMessage()'s for a voicemail, through
    // sendToWorker), the polite reply to a number we don't know
    // (`plan.reply`, from unknownNumberMessage()) and the office's alert email
    // (unknownNumberAlertEmail()).
    expect(reply.match(/sendToWorker\(deps, \{[\s\S]*?\}\)/g)).toEqual([
      expect.stringMatching(/body: \{ whatsapp: replyText, sms: replyText \},/),
    ]);
    expect(reply.match(/transport\.send\(\{[\s\S]*?\}\)/g)).toEqual([
      expect.stringMatching(/body: plan\.reply,/),
      expect.stringMatching(/\.\.\.email \}/),
    ]);
    expect(reply).toMatch(
      /return c\.channel === "voice" && reply\.intent === "office"\s*\? voicemailReceivedMessage\(voice, reply\.ref\)\s*: shiftsLineReply\(voice, reply\);/,
    );
    expect(reply).toMatch(/\? unknownNumberMessage\(c\.firm\)\s*: null,/);
    expect(reply).toMatch(/const email = unknownNumberAlertEmail\(/);
    // The AI's answer is only ever a label: classifyMessage() returns an intent or null.
    const classify = readFileSync(join(SRC, "lib/ai/classify-message.ts"), "utf8");
    expect(classify).toMatch(/Promise<Intent \| null>/);
  });

  it("STOP and START get only the app's fixed confirmation texts", () => {
    const optOut = readFileSync(join(SRC, "lib/inbound/opt-out.ts"), "utf8");
    expect(optOut.match(/transport\.send\(\{[\s\S]*?\}\)/g)).toEqual([
      'transport.send({ channel: "sms", to: c.from, from: c.line, body })',
    ]);
    expect(optOut).toMatch(
      /const body = c\.word === "stop" \? smsStoppedMessage\(c\.firm\) : smsStartedMessage\(c\.firm\);/,
    );
  });

  it("the AI code is these files, and only anthropic.ts imports the Anthropic SDK (12X.3)", () => {
    const aiFiles = files.filter(isAi).map(rel).sort();
    expect(aiFiles).toEqual([
      "src/lib/ai/anthropic.ts",
      "src/lib/ai/ask.ts",
      "src/lib/ai/classify-message.ts",
      "src/lib/ai/client.ts",
      "src/lib/ai/pay-summary.ts",
    ]);
    const sdk = files
      .filter((file) =>
        imports(readFileSync(file, "utf8")).some((spec) => /^@anthropic-ai\//.test(spec)),
      )
      .map(rel);
    expect(sdk).toEqual(["src/lib/ai/anthropic.ts"]);
  });

  // An import of the app's own src/lib/ai/anthropic.ts is the AI code itself (who may import that
  // is pinned above), not an SDK; every other import is checked.
  it("no AI SDK is imported outside src/lib/ai/", () => {
    const sdk = files
      .filter((file) => !isAi(file))
      .filter((file) =>
        imports(readFileSync(file, "utf8")).some((spec) => {
          const local = resolveLocal(file, spec);
          return !(local && isAi(local)) && /bedrock|anthropic|openai/i.test(spec);
        }),
      )
      .map(rel);
    expect(sdk).toEqual([]);
  });

  it("the AI line is made in one place, and only the digest asks for it", () => {
    const callers = files
      .filter((file) => /\bsummariseGroups\(/.test(readFileSync(file, "utf8")))
      .map(rel)
      .sort();
    expect(callers).toEqual(["src/lib/office/pay-query-groups.ts", "src/lib/pay/digest.ts"]);
    const direct = files
      .filter(
        (file) =>
          !isAi(file) && /\bsummarisePayGroup\(|\.complete\(\{/.test(readFileSync(file, "utf8")),
      )
      .map(rel);
    expect(direct).toEqual(["src/lib/office/pay-query-groups.ts"]);
  });

  // The shifts line's webhook, which only checks, stores and queues (the reply job is apart).
  const WEBHOOK_PATH = [
    "src/app/api/webhooks/twilio/whatsapp/route.ts",
    "src/app/api/webhooks/twilio/sms/route.ts",
    "src/app/api/webhooks/twilio/voice/route.ts",
    "src/app/api/webhooks/twilio/voice/transcription/route.ts",
    "src/app/api/webhooks/twilio/voice/done/route.ts",
    "src/lib/inbound/voice.ts",
    "src/lib/inbound/twilio-request.ts",
    "src/lib/inbound/webhook.ts",
    "src/lib/inbound/receive.ts",
    "src/lib/inbound/job.ts",
    "src/lib/inbound/keywords.ts",
    "src/lib/inbound/twilio-signature.ts",
    // STOP and START by text: answered with fixed texts only, never through the AI.
    "src/lib/inbound/opt-out.ts",
    "src/lib/inbound/claim.ts",
  ];

  // Payroll's "Mark as sorted and tell them", where the note to the workers is typed and saved;
  // and payroll's pay import, where the pay figures come in (read by code, never by AI: rule 1).
  const PAYROLL_PATHS = [
    "src/app/office/pay/import/page.tsx",
    "src/app/office/pay/import/actions.ts",
    "src/app/office/pay/import/import-form.tsx",
    "src/lib/office/pay-import.ts",
    "src/lib/office/pay-import-copy.ts",
    "src/lib/office/office-import.ts",
    "src/lib/imports/import.ts",
    "src/lib/imports/columns.ts",
    "src/lib/imports/table.ts",
    "src/app/office/pay-queries/sort-group-form.tsx",
    "src/app/office/pay-queries/sort-actions.ts",
    "src/app/office/pay-queries/as-payroll.ts",
    "src/lib/office/pay-sort.ts",
    "src/lib/office/pay-sort-copy.ts",
    "src/lib/office/office-context.ts",
    "src/lib/pay/resolve.ts",
  ];

  it("the sort form takes only the query ids: no note or draft handed to it", () => {
    const form = readFileSync(join(SRC, "app/office/pay-queries/sort-group-form.tsx"), "utf8");
    expect(form).toMatch(/export function SortGroupForm\(\{ ids \}: \{ ids: string\[\] \}\)/);
    expect(form).toMatch(/const \[note, setNote\] = useState\(""\);/);
    const page = readFileSync(join(SRC, "app/office/pay-queries/page.tsx"), "utf8");
    expect(page).toMatch(/<SortGroupForm ids=\{g\.queries\.map\(\(q\) => q\.id\)\} \/>/);
  });

  it("nothing a worker sees or receives, and nothing on payroll's sorting path, can reach the AI code", () => {
    const workerFacing = files.filter((file) => {
      const path = rel(file);
      return (
        (path.startsWith("src/app/") && !path.startsWith("src/app/office/")) ||
        path.startsWith("src/lib/portal/") ||
        path.startsWith("src/lib/notices/") ||
        path.startsWith("src/lib/notify/") ||
        path.startsWith("src/lib/messaging/") ||
        PAYROLL_PATHS.includes(path) ||
        WEBHOOK_PATH.includes(path)
      );
    });
    for (const path of [...PAYROLL_PATHS, ...WEBHOOK_PATH]) {
      expect(workerFacing.map(rel)).toContain(path);
    }
    expect(workerFacing.length).toBeGreaterThan(50);
    expect(workerFacing.map(rel)).toContain("src/lib/notices/pay-query-update.ts");
    expect(workerFacing.map(rel)).toContain("src/app/pay/pay-view.tsx");
    const reaching = workerFacing
      .map((file) => aiChain(file))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.join(" -> "));
    expect(reaching).toEqual([]);
  });
});
