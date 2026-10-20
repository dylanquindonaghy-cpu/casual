import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedFirms } from "@/lib/db/admin/seed-data";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { realPeopleIn } from "@/lib/demo/people";
import { demoPhoneMessages } from "@/lib/demo/phone";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";

// The Demo phone's messages (16.1; ADR-025), on the real database as the app role, inside each
// firm's own withFirm transaction: a firm sees what it sent its own casuals and office team, and
// never what another firm sent (even to a number both firms have), what went to a number nobody
// has, or a line no firm's job wrote (golden rule 2).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let file: string;

beforeAll(async () => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
  file = join(await mkdtemp(join(tmpdir(), "demo-phone-")), "outbox.jsonl");
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function firmWith(mobile: string, email: string) {
  const slug = uniqueSlug("d");
  const { rows } = await su.query<{ id: string }>(
    "insert into firms (name, slug, sector) values ($1, $2, 'security') returning id::text as id",
    [`Demo Test ${slug}`, slug],
  );
  const firmId = rows[0]?.id;
  if (!firmId) throw new Error("no firm");
  await su.query(
    "insert into workers (firm_id, first_name, last_name, mobile_e164) values ($1, 'Zoe', $2, $3)",
    [firmId, slug, mobile],
  );
  await su.query(
    "insert into office_users (firm_id, email, name, role) values ($1, $2, 'Payroll (demo)', 'payroll')",
    [firmId, email],
  );
  return { firmId, slug };
}

// An outbox line as the console transport writes it inside a firm's job (firmId: the firm).
const line = (
  firmId: string | null,
  at: string,
  channel: string,
  to: string,
  body: string,
  subject?: string,
) =>
  JSON.stringify({
    at,
    channel,
    to,
    body,
    ...(subject ? { subject } : {}),
    ...(firmId ? { firmId } : {}),
  });

describe("the Demo phone's messages", () => {
  it("each firm sees only its own people's messages, newest first; a stranger's never", async () => {
    const a = await firmWith("+447700900761", "pay-a@example.com");
    const b = await firmWith("+447700900762", "pay-b@example.com");
    await writeFile(
      file,
      [
        line(a.firmId, "2026-10-20T09:00:00.000Z", "sms", "+447700900761", "A's login link"),
        line(b.firmId, "2026-10-20T09:01:00.000Z", "sms", "+447700900762", "B's login link"),
        line(a.firmId, "2026-10-20T09:02:00.000Z", "sms", "+447700900999", "a stranger"),
        line(
          a.firmId,
          "2026-10-20T09:03:00.000Z",
          "email",
          "PAY-A@example.com",
          "A's digest",
          "Digest",
        ),
        line(
          b.firmId,
          "2026-10-20T09:04:00.000Z",
          "email",
          "pay-b@example.com",
          "B's digest",
          "Digest",
        ),
        // To A's own casual, but written outside any firm's job: no firm's.
        line(null, "2026-10-20T09:05:00.000Z", "sms", "+447700900761", "no firm"),
      ].join("\n"),
    );
    const forA = await withFirm(a.firmId, (tx) => demoPhoneMessages(tx, file));
    expect(forA.map((m) => m.body)).toEqual(["A's digest", "A's login link"]);
    expect(forA[0]).toMatchObject({
      channel: "email",
      toName: "Payroll (demo)",
      subject: "Digest",
    });
    expect(forA[1]).toMatchObject({ channel: "sms", toName: `Zoe ${a.slug}`, to: "+447700900761" });
    const forB = await withFirm(b.firmId, (tx) => demoPhoneMessages(tx, file));
    expect(forB.map((m) => m.body)).toEqual(["B's digest", "B's login link"]);
  });

  it("a casual in both firms (one number): each firm sees only what it sent them", async () => {
    // The guardrails review's case: a visitor imports one firm's casual into the other firm.
    const shared = "+447700900765";
    const a = await firmWith(shared, "pay-e@example.com");
    const b = await firmWith(shared, "pay-f@example.com");
    await writeFile(
      file,
      [
        line(a.firmId, "2026-10-20T11:00:00.000Z", "sms", shared, "A's shift and login link"),
        line(b.firmId, "2026-10-20T11:01:00.000Z", "sms", shared, "B's shift and login link"),
      ].join("\n"),
    );
    const forA = await withFirm(a.firmId, (tx) => demoPhoneMessages(tx, file));
    const forB = await withFirm(b.firmId, (tx) => demoPhoneMessages(tx, file));
    expect(forA.map((m) => [m.body, m.toName])).toEqual([
      ["A's shift and login link", `Zoe ${a.slug}`],
    ]);
    expect(forB.map((m) => [m.body, m.toName])).toEqual([
      ["B's shift and login link", `Zoe ${b.slug}`],
    ]);
  });

  it("only inside a firm's withFirm", async () => {
    await expect(demoPhoneMessages({} as never, file)).rejects.toThrow(/inside withFirm/);
  });

  it("keeps to the newest `limit`; no outbox yet is no messages", async () => {
    const a = await firmWith("+447700900763", "pay-c@example.com");
    const many = Array.from({ length: 60 }, (_, i) =>
      line(
        a.firmId,
        `2026-10-20T10:${String(i).padStart(2, "0")}:00.000Z`,
        "sms",
        "+447700900763",
        `m${i}`,
      ),
    );
    await writeFile(file, many.join("\n"));
    const got = await withFirm(a.firmId, (tx) => demoPhoneMessages(tx, file, 50));
    expect(got).toHaveLength(50);
    expect(got[0]?.body).toBe("m59");
    expect(got.at(-1)?.body).toBe("m10");
    const none = await withFirm(a.firmId, (tx) =>
      demoPhoneMessages(tx, join(file, "..", "x.jsonl")),
    );
    expect(none).toEqual([]);
  });

  it("in the made-up demo, no number or email belongs to both demo firms", () => {
    // So matching a message to a firm by who it went to is exact on a demo server, where demo
    // mode allows only these firms (src/lib/demo/guard.ts).
    const [acme, northline] = seedFirms(new Date("2026-10-20T09:00:00Z"));
    const keys = (f: typeof acme) => [
      ...(f?.workers ?? []).map((w) => w.mobileE164),
      ...(f?.officeUsers ?? []).map((o) => o.email.toLowerCase()),
    ];
    const acmeKeys = new Set(keys(acme));
    expect(acmeKeys.size).toBeGreaterThan(0);
    expect(keys(northline).filter((k) => acmeKeys.has(k))).toEqual([]);
  });
});

describe("the made-up people check", () => {
  it("counts this firm's people with a number or email that isn't made up, each once", async () => {
    const a = await firmWith("+447700900766", "pay-g@example.com");
    expect(await withFirm(a.firmId, realPeopleIn)).toBe(0);
    // A casual with a real number and a real email (one person), one with a real email only, and
    // an office user with a real email: 3.
    await su.query(
      `insert into workers (firm_id, first_name, last_name, mobile_e164, email) values
         ($1, 'Real', 'One', '+447911123456', 'one@gmail.com'),
         ($1, 'Real', 'Two', '+447700900767', 'two@firm.co.uk')`,
      [a.firmId],
    );
    await su.query(
      "insert into office_users (firm_id, email, name, role) values ($1, 'boss@firm.co.uk', 'Boss', 'admin')",
      [a.firmId],
    );
    expect(await withFirm(a.firmId, realPeopleIn)).toBe(3);
    // Another firm's real people aren't this one's.
    const b = await firmWith("+447700900768", "pay-h@example.com");
    expect(await withFirm(b.firmId, realPeopleIn)).toBe(0);
  });
});
