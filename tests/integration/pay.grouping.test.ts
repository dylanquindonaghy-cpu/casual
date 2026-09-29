import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiUnavailableError, createFakeAi, noAi, type AiClient } from "@/lib/ai/client";
import { summarisePayGroup, type PayGroupFacts } from "@/lib/ai/pay-summary";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { OutboundMessage } from "@/lib/messaging/transport";
import { importPayFile } from "@/lib/office/pay-import";
import { loadPayQueryGroups } from "@/lib/office/pay-query-groups";
import { runPayDigest } from "@/lib/pay/digest";
import { regroupPayQueries } from "@/lib/pay/grouping";
import { raisePayQuery } from "@/lib/portal/pay-queries";
import type { PayQueryInput } from "@/lib/portal/pay-query-kinds";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Pay query grouping (docs/testing.md `pay.grouping.test.ts`): the keys are stable, and an AI
// failure falls back cleanly. On the real database, as the app role. The key rules and the
// summary's check are unit-tested (tests/unit/pay.group-keys.test.ts,
// tests/unit/ai.pay-summary.test.ts); this is what they can't see: keys set and kept through
// raising, regrouping, pay imports, digests and sorting; and the digest job with an AI that throws,
// hangs, answers late or answers nonsense. No real AI is called: a fake acts out each failure.
// NOW is Monday 2 November 2026, 09:00 London (GMT). The clocks went back on Sunday 25 October.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

// A worker who entered their pay code just before `when`.
const stepped = (workerId: string, when = NOW) => ({
  worker: { id: workerId },
  session: {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "worker",
    subjectId: workerId,
    expiresAt: new Date(when.getTime() + 86_400_000),
    rotatedAt: when,
    steppedUpUntil: new Date(when.getTime() + 600_000),
    rotationDue: false,
  } as ActiveSession,
});

async function groupingFirm() {
  const f = await bookingFirm(su, withFirm);
  const [ann, ben, cal] = [
    await f.worker({ first: "Ann" }),
    await f.worker({ first: "Ben" }),
    await f.worker({ first: "Cal" }),
  ];
  await su.query("update workers set external_ref = 'A1' where id = $1", [ann]);
  await su.query("update workers set external_ref = 'B2' where id = $1", [ben]);
  await su.query("update workers set external_ref = 'C3' where id = $1", [cal]);
  const { rows: siteRows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
    [f.firmId],
  );
  const arena = siteRows[0]?.id ?? "";
  const shiftAt = async (iso: string, workers: string[], site: string | null = arena) => {
    const id = await f.shift({ startsAt: new Date(iso), headcount: Math.max(1, workers.length) });
    if (site) await su.query("update shifts set site_id = $2 where id = $1", [id, site]);
    let slot = 1;
    for (const w of workers) await f.booking(w, id, "completed", slot++);
    return id;
  };
  const payroll = await f.office("payroll");
  const raise = async (workerId: string, input: Partial<PayQueryInput>, when = NOW) => {
    const r = await raisePayQuery(
      {
        firm: { id: f.firmId, timezone: "Europe/London", signOff: "Shift Team" },
        run: withFirm,
        clock: { now: () => when },
      },
      stepped(workerId, when),
      { shiftId: null, day: null, issue: "wrong_rate", details: null, ...input },
    );
    if (r.status !== "created") throw new Error(`not raised: ${r.status}`);
    // The reference the worker is shown is the first 8 characters of the id.
    const { rows } = await su.query<{ id: string }>(
      `select id::text as id from pay_queries
        where firm_id = $1 and upper(left(id::text, 8)) = $2`,
      [f.firmId, r.ref],
    );
    if (rows.length !== 1) throw new Error("no single query for the reference");
    return rows[0]?.id ?? "";
  };
  const keyOf = async (id: string) =>
    (await su.query<{ group_key: string }>("select group_key from pay_queries where id = $1", [id]))
      .rows[0]?.group_key;
  const importPay = (lines: string[]) =>
    importPayFile(
      { firm: { id: f.firmId }, officeUserId: payroll, run: withFirm, clock: { now: () => NOW } },
      new TextEncoder().encode(
        `${["Staff ID,Period start,Period end,Hours,Rate", ...lines].join("\n")}\n`,
      ),
      false,
    );
  const regroupedEvents = async () =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        "select data from events where firm_id = $1 and action = 'pay_query.regrouped' order by id",
        [f.firmId],
      )
    ).rows.map((r) => r.data);
  return { f, ann, ben, cal, arena, shiftAt, payroll, raise, keyOf, importPay, regroupedEvents };
}

describe("stable keys", () => {
  it("the same facts give the same key, whoever raises it, whatever they write, whenever and in any order", async () => {
    const t = await groupingFirm();
    const thursday = await t.shiftAt("2026-10-29T08:00:00Z", [t.ann, t.ben, t.cal]);
    const friday = await t.shiftAt("2026-10-30T18:00:00Z", [t.ann, t.cal]);
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    // Ben first, then Ann three hours later with a long note, then Cal: one wrong-rate group.
    const b = await t.raise(t.ben, { shiftId: thursday });
    const a = await t.raise(
      t.ann,
      { shiftId: thursday, details: "Paid £12.50 an hour, should be £13. Please check!" },
      later,
    );
    const c = await t.raise(t.cal, { shiftId: thursday, details: "?" });
    expect(new Set([await t.keyOf(a), await t.keyOf(b), await t.keyOf(c)])).toEqual(
      new Set(["pay1:wrong_rate:2026-10-26:rate:none"]),
    );
    // Hours missing at one site on two different shifts that week: one group.
    const m1 = await t.raise(t.ann, { shiftId: thursday, issue: "missing_hours" });
    const m2 = await t.raise(t.cal, { shiftId: friday, issue: "missing_hours" });
    expect(await t.keyOf(m1)).toBe(`pay1:missing_hours:2026-10-26:site:${t.arena}`);
    expect(await t.keyOf(m2)).toBe(await t.keyOf(m1));
    // The grouped view agrees: two groups, of 3 and 2.
    const { groups } = await withFirm(t.f.firmId, (tx) => loadPayQueryGroups(tx));
    expect(groups.map((g) => g.queries.length)).toEqual([3, 2]);
  });

  it("the week is the firm's: Monday and Sunday share a key, and the clocks going back move nothing", async () => {
    const t = await groupingFirm();
    // Monday 19 October 00:30 in London is Sunday 23:30 UTC (summer time): still the week of the
    // 19th. Sunday 25 October 23:30 (after the clocks went back) is the same week. Monday 26
    // October 00:30 is the next.
    const earlyMonday = await t.shiftAt("2026-10-18T23:30:00Z", [t.ann]);
    const lateSunday = await t.shiftAt("2026-10-25T23:30:00Z", [t.ben]);
    const nextMonday = await t.shiftAt("2026-10-26T00:30:00Z", [t.cal]);
    const keys = [
      await t.keyOf(await t.raise(t.ann, { shiftId: earlyMonday, issue: "late_pay" })),
      await t.keyOf(await t.raise(t.ben, { shiftId: lateSunday, issue: "late_pay" })),
      await t.keyOf(await t.raise(t.cal, { shiftId: nextMonday, issue: "late_pay" })),
    ];
    expect(keys).toEqual([
      "pay1:late_pay:2026-10-19",
      "pay1:late_pay:2026-10-19",
      "pay1:late_pay:2026-10-26",
    ]);
    // A day typed in, not a shift: the same week rule.
    expect(
      await t.keyOf(await t.raise(t.ann, { day: "2026-10-25", issue: "other", details: "x" })),
    ).toBe("pay1:other:2026-10-19");
  });

  it("regrouping again and again, or importing the same pay file again, changes nothing", async () => {
    const t = await groupingFirm();
    const thursday = await t.shiftAt("2026-10-29T08:00:00Z", [t.ann, t.ben]);
    const a = await t.raise(t.ann, { shiftId: thursday });
    const b = await t.raise(t.ben, { shiftId: thursday });
    const FILE = ["A1,26/10/2026,01/11/2026,8,12.50", "B2,26/10/2026,01/11/2026,8,12.50"];
    expect(await t.importPay(FILE)).toMatchObject({ result: { created: 2 }, regrouped: 2 });
    const after = [await t.keyOf(a), await t.keyOf(b)];
    expect(after).toEqual([
      "pay1:wrong_rate:2026-10-26:rate:1250",
      "pay1:wrong_rate:2026-10-26:rate:1250",
    ]);
    expect(await t.importPay(FILE)).toMatchObject({ result: { unchanged: 2 }, regrouped: 0 });
    for (let i = 0; i < 3; i++) {
      expect(await withFirm(t.f.firmId, (tx) => regroupPayQueries(tx))).toEqual({ changed: 0 });
    }
    expect([await t.keyOf(a), await t.keyOf(b)]).toEqual(after);
    // One regroup, logged once.
    expect(await t.regroupedEvents()).toEqual([{ changed: 2 }]);
  });

  it("a key changes only when its facts do: open and in-digest queries follow a new or corrected pay line, sorted ones never move", async () => {
    const t = await groupingFirm();
    const thursday = await t.shiftAt("2026-10-29T08:00:00Z", [t.ann, t.ben, t.cal]);
    const a = await t.raise(t.ann, { shiftId: thursday });
    const b = await t.raise(t.ben, { shiftId: thursday });
    const c = await t.raise(t.cal, { shiftId: thursday });
    await su.query("update pay_queries set status = 'in_digest' where id = $1", [b]);
    await su.query(
      `update pay_queries set status = 'resolved', resolved_at = now(), resolution_note = 'Sorted.'
        where id = $1`,
      [c],
    );
    await t.importPay([
      "A1,26/10/2026,01/11/2026,8,12.50",
      "B2,26/10/2026,01/11/2026,8,12.50",
      "C3,26/10/2026,01/11/2026,8,12.50",
    ]);
    expect([await t.keyOf(a), await t.keyOf(b), await t.keyOf(c)]).toEqual([
      "pay1:wrong_rate:2026-10-26:rate:1250",
      "pay1:wrong_rate:2026-10-26:rate:1250",
      "pay1:wrong_rate:2026-10-26:rate:none",
    ]);
    // A corrected rate comes in as a second line (the rate is part of a line's identity): Ann's
    // key now names both rates; the others are unchanged.
    expect(await t.importPay(["A1,26/10/2026,01/11/2026,8,13.00"])).toMatchObject({
      regrouped: 1,
    });
    expect(await t.keyOf(a)).toBe("pay1:wrong_rate:2026-10-26:rate:1250+1300");
    expect(await t.keyOf(b)).toBe("pay1:wrong_rate:2026-10-26:rate:1250");
    expect(await t.keyOf(c)).toBe("pay1:wrong_rate:2026-10-26:rate:none");
  });

  it("two firms with the same facts get the same key text, but never share a group", async () => {
    const one = await groupingFirm();
    const two = await groupingFirm();
    const k1 = await one.keyOf(await one.raise(one.ann, { day: "2026-10-31", issue: "late_pay" }));
    const k2 = await two.keyOf(await two.raise(two.ann, { day: "2026-10-31", issue: "late_pay" }));
    expect(k1).toBe("pay1:late_pay:2026-10-26");
    expect(k2).toBe(k1);
    for (const t of [one, two]) {
      const { groups } = await withFirm(t.f.firmId, (tx) => loadPayQueryGroups(tx));
      expect(groups.map((g) => [g.key, g.queries.length])).toEqual([[k1, 1]]);
    }
  });
});

describe("AI failure falls back cleanly", () => {
  const facts: PayGroupFacts = {
    count: 2,
    issue: "wrong_rate",
    week: "2026-10-26",
    site: null,
    ratesPence: [1250],
  };
  const CODE_LINE = "2 queries: wrong rate, the week of Mon 26 Oct, paid at £12.50.";

  it("a summary that doesn't come within the timeout, or late, or isn't text, uses the code's line", async () => {
    const hangs = createFakeAi(() => new Promise<string>(() => undefined));
    const started = Date.now();
    expect(await summarisePayGroup(facts, hangs, { timeoutMs: 30 })).toEqual({
      text: CODE_LINE,
      byAi: false,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    // A good answer that arrives after the timeout is ignored; so is a late failure.
    const late = createFakeAi(
      () => new Promise<string>((r) => setTimeout(() => r("2 queries: still at £12.50."), 150)),
    );
    const lateFail = createFakeAi(
      () => new Promise<string>((_, reject) => setTimeout(() => reject(new Error("x")), 150)),
    );
    expect(await summarisePayGroup(facts, late, { timeoutMs: 30 })).toMatchObject({ byAi: false });
    expect(await summarisePayGroup(facts, lateFail, { timeoutMs: 30 })).toMatchObject({
      byAi: false,
    });
    await new Promise((r) => setTimeout(r, 200)); // let the late ones settle: no unhandled errors
    // Answers that aren't text at all.
    for (const answer of [undefined, null, 42, { text: "2 queries" }]) {
      const odd: AiClient = { name: "odd", complete: async () => answer as unknown as string };
      expect(await summarisePayGroup(facts, odd)).toEqual({ text: CODE_LINE, byAi: false });
    }
    // A client that answers a plain value (not a promise), or throws at once: still handled.
    const plain: AiClient = {
      name: "plain",
      complete: (() => "2 queries: still paid at £12.50.") as unknown as AiClient["complete"],
    };
    expect(await summarisePayGroup(facts, plain)).toMatchObject({ byAi: true });
    const throwsAtOnce: AiClient = {
      name: "throws",
      complete: (() => {
        throw new Error("no");
      }) as unknown as AiClient["complete"],
    };
    expect(await summarisePayGroup(facts, throwsAtOnce)).toEqual({ text: CODE_LINE, byAi: false });
    // An answer within the timeout is still used.
    const quick = createFakeAi(() => "2 queries: still paid at £12.50.");
    expect(await summarisePayGroup(facts, quick, { timeoutMs: 1000 })).toEqual({
      text: "2 queries: still paid at £12.50.",
      byAi: true,
    });
  });

  // One firm with the usual week, and a digest run again and again with a different AI each time
  // (the queries put back to open in between): every failure gives the no-AI email, word for word.
  async function digestBench() {
    const t = await groupingFirm();
    const thursday = await t.shiftAt("2026-10-29T08:00:00Z", [t.ann, t.ben, t.cal]);
    await t.importPay(["A1,26/10/2026,01/11/2026,8,12.50", "B2,26/10/2026,01/11/2026,8,12.50"]);
    await t.raise(t.ann, { shiftId: thursday, details: "Paid £12.50, should be £13" });
    await t.raise(t.ben, { shiftId: thursday });
    await t.raise(t.cal, { shiftId: thursday, issue: "missing_hours" });
    let n = 0;
    const run = async (ai: AiClient) => {
      await su.query(
        "update pay_queries set status = 'open' where firm_id = $1 and status = 'in_digest'",
        [t.f.firmId],
      );
      const { transport, sent } = captureTransport();
      n += 1;
      const result = await runPayDigest(
        {
          firmId: t.f.firmId,
          idempotencyKey: `pay-digest:2026-11-02:now:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        },
        withFirm,
        { transport, ai, baseDomain: "shiftdesk.test", aiTimeoutMs: 50 },
      );
      const email = sent.find(
        (m): m is Extract<OutboundMessage, { channel: "email" }> => m.channel === "email",
      );
      return { result, body: email?.body ?? "", list: email?.attachments?.[0]?.content ?? "" };
    };
    return { t, run };
  }

  it("in the digest, every kind of AI failure gives the email the app sends with no AI, sent and logged as usual", async () => {
    const { t, run } = await digestBench();
    const baseline = await run(noAi);
    expect(baseline.result).toMatchObject({ status: "sent", queries: 3, groups: 2 });
    expect(baseline.body).toContain(
      "- 2 queries: wrong rate, the week of Mon 26 Oct, paid at £12.50.",
    );
    expect(baseline.body).not.toContain("AI summary");

    const failures: Record<string, AiClient> = {
      "not connected": createFakeAi(() => {
        throw new AiUnavailableError("not connected");
      }),
      "an error": createFakeAi(() => {
        throw new Error("500 from the model");
      }),
      "a rejection later": createFakeAi(
        () => new Promise<string>((_, reject) => setTimeout(() => reject(new Error("x")), 5)),
      ),
      "no answer (hangs)": createFakeAi(() => new Promise<string>(() => undefined)),
      "an empty answer": createFakeAi(() => ""),
      "not text": { name: "odd", complete: async () => undefined as unknown as string },
      "too long": createFakeAi(() => "x".repeat(400)),
      "two lines": createFakeAi(() => "2 queries.\nPaid at £12.50."),
      "an invented number": createFakeAi(() => "37 queries: paid at £11.00."),
      advice: createFakeAi(() => "Payroll should pay them the difference."),
      // A good line (it would pass the check) that comes after the 50 ms timeout.
      "a good answer, too late": createFakeAi(
        () =>
          new Promise<string>((r) => setTimeout(() => r("2 queries: still paid at £12.50."), 150)),
      ),
    };
    for (const [why, ai] of Object.entries(failures)) {
      // Counted, so no case passes without the AI having been asked (once for each group).
      let calls = 0;
      const counted: AiClient = {
        name: ai.name,
        complete: (request) => {
          calls += 1;
          return ai.complete(request);
        },
      };
      const started = Date.now();
      const got = await run(counted);
      expect(calls, why).toBe(2);
      expect(got.result, why).toMatchObject({ status: "sent", queries: 3, groups: 2 });
      expect(got.body, why).toBe(baseline.body);
      expect(got.list, why).toBe(baseline.list);
      // Two groups, 50 ms each at most for a hang: no stall.
      expect(Date.now() - started, why).toBeLessThan(3000);
    }
    await new Promise((r) => setTimeout(r, 200)); // let the late answers settle
    const sentEvents = (
      await su.query(
        "select count(*)::int as n from events where firm_id = $1 and action = 'pay_digest.sent'",
        [t.f.firmId],
      )
    ).rows[0] as { n: number };
    expect(sentEvents.n).toBe(1 + Object.keys(failures).length);
    // What the AI failed with is never in the log.
    const logged = JSON.stringify(
      (await su.query("select data from events where firm_id = $1", [t.f.firmId])).rows,
    );
    expect(logged).not.toMatch(/500 from the model|should pay/);
  });

  it("an AI failing for some groups leaves just those without a line", async () => {
    const { run } = await digestBench();
    let calls = 0;
    const flaky = createFakeAi(() => {
      calls += 1;
      if (calls === 1) return "2 queries: last week still paid at £12.50.";
      throw new Error("rate limited");
    });
    const got = await run(flaky);
    expect(got.body).toContain(
      "- 2 queries: wrong rate, the week of Mon 26 Oct, paid at £12.50.\n  AI summary: 2 queries: last week still paid at £12.50. (written by AI)\n- 1 query: hours missing, the week of Mon 26 Oct, at Riverside Arena.\n\n",
    );
    expect(got.body.match(/AI summary/g)).toHaveLength(1);
  });

  // The page's loader takes no AI client at all, so it can't wait for one; that the digest is the
  // only code that asks for AI lines is held by tests/unit/ai.boundary.test.ts.
  it("payroll's page shows the app's own lines only", async () => {
    const { t } = await digestBench();
    const { groups } = await withFirm(t.f.firmId, (tx) => loadPayQueryGroups(tx));
    expect(groups.map((g) => [g.heading, g.aiLine])).toEqual([
      ["2 queries: wrong rate, the week of Mon 26 Oct, paid at £12.50.", null],
      ["1 query: hours missing, the week of Mon 26 Oct, at Riverside Arena.", null],
    ]);
  });
});
