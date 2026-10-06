import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendLoginCode } from "@/lib/auth/send-login-code";
import { createSession } from "@/lib/auth/sessions";
import { scanCredentials } from "@/lib/credentials/scan";
import { createLineDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { createPayQueryUpdateTask, PAY_QUERY_UPDATE_QUEUE } from "@/lib/notices/pay-query-update";
import { sortPayQueries } from "@/lib/office/pay-sort";
import { firmShiftsLine } from "@/lib/tenancy/shifts-line";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { setShiftsLine, toE164 } from "../../scripts/shifts-line-owner";

// A firm's shifts line (Phase 7: firms.shifts_line_e164): the column's rules, finding the firm for
// an incoming message's number, messages going from the firm's number, and setting it. On the real
// database; the look-up and the senders as the app role. No Twilio: messages go to a capturing
// transport. The numbers are from Ofcom's drama range.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

// A drama-range number from 07700 900500-900999, kept for this test alone (the seed's Acme line is
// 900000 and the seed runs in this database too): freed first from any firm an earlier run gave it
// to (one number belongs to one firm, and test firms stay in the database).
let next = Math.floor(Math.random() * 500);
async function freshLine(): Promise<string> {
  next = (next + 1) % 500;
  const line = `+447700900${500 + next}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  return line;
}

async function lineFirm(line: string | null) {
  const f = await bookingFirm(su, withFirm);
  if (line)
    await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
  const { rows } = await su.query<{ slug: string; name: string }>(
    "select slug, name from firms where id = $1",
    [f.firmId],
  );
  return { f, slug: rows[0]?.slug ?? "", name: rows[0]?.name ?? "" };
}

describe("the shifts line column", () => {
  it("is an E.164 number, and one number belongs to one firm", async () => {
    const t = await lineFirm(null);
    await expect(
      su.query("update firms set shifts_line_e164 = '07700 900000' where id = $1", [t.f.firmId]),
    ).rejects.toMatchObject({ code: "23514" });
    const line = await freshLine();
    await su.query("update firms set shifts_line_e164 = $2 where id = $1", [t.f.firmId, line]);
    const other = await lineFirm(null);
    await expect(
      su.query("update firms set shifts_line_e164 = $2 where id = $1", [other.f.firmId, line]),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("the firm for an incoming message's number", () => {
  it("finds the one firm with that line, with directory fields only; unknown or malformed numbers are nobody", async () => {
    const line = await freshLine();
    const t = await lineFirm(line);
    await lineFirm(null);
    const byLine = createLineDirectory(app);
    expect(await byLine(line)).toEqual({
      id: t.f.firmId,
      slug: t.slug,
      name: t.name,
      timezone: "Europe/London",
      signOff: `${t.name} Shift Team`,
    });
    expect(await byLine("+447700900499")).toBeNull(); // a drama number no firm here is given
    // Not E.164 (as Twilio sends a WhatsApp "To": the caller strips "whatsapp:" first): nobody.
    for (const raw of ["", "07700 900000", `whatsapp:${line}`, `${line} `, "+0123"]) {
      expect(await byLine(raw)).toBeNull();
    }
  });
});

describe("app_firm_by_line()", () => {
  it("runs as its owner with a pinned search_path, only the app role may call it, directory fields only", async () => {
    const { rows } = await su.query<{
      definer: boolean;
      config: string[];
      acl: string[];
      result: string;
    }>(
      `select prosecdef as definer, proconfig as config, proacl::text[] as acl,
              pg_get_function_result(oid) as result
         from pg_proc where oid = 'app_firm_by_line(text)'::regprocedure`,
    );
    const fn = rows[0];
    expect(fn?.definer).toBe(true);
    expect(fn?.config).toEqual(["search_path=pg_catalog, pg_temp"]);
    expect(fn?.result).toBe("TABLE(id uuid, slug text, name text, timezone text, sign_off text)");
    // No "=X/..." entry: PUBLIC can't execute it; the jobs role can't either.
    expect(fn?.acl.filter((entry) => entry.startsWith("="))).toEqual([]);
    expect(fn?.acl.some((entry) => entry.startsWith("shiftdesk_app=X/"))).toBe(true);
    expect(fn?.acl.some((entry) => entry.startsWith("shiftdesk_jobs="))).toBe(false);
  });
});

describe("messages go from the firm's shifts line", () => {
  it("a login code from a firm with a line comes from it; from a firm without one, no `from`", async () => {
    for (const line of [await freshLine(), null]) {
      const t = await lineFirm(line);
      const worker = await t.f.worker({ first: "Ann" });
      const session = await withFirm(t.f.firmId, (tx) =>
        createSession(tx, { kind: "worker", subjectId: worker, now: NOW }),
      );
      const { transport, sent } = captureTransport();
      await sendLoginCode(
        { firmId: t.f.firmId, idempotencyKey: randomUUID(), sessionId: session.id },
        withFirm,
        { transport, clock: { now: () => NOW }, secret: "x".repeat(32), newCode: () => "123456" },
      );
      expect(sent).toHaveLength(1);
      if (line) expect(sent[0]).toMatchObject({ channel: "whatsapp", from: line });
      else expect(sent[0]).not.toHaveProperty("from");
    }
  });

  it("a credential warning and a pay query answer come from it too", async () => {
    const line = await freshLine();
    const t = await lineFirm(line);
    const ann = await t.f.worker({
      first: "Ann",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-09" }],
    });
    const { transport, sent } = captureTransport();
    await scanCredentials(
      { firmId: t.f.firmId, idempotencyKey: "credential-scan:2026-11-03" },
      withFirm,
      { transport },
    );
    expect(sent.filter((m) => m.channel === "whatsapp")).toEqual([
      expect.objectContaining({ from: line }),
    ]);

    // A sorted pay query's answer.
    await su.query(
      `insert into pay_queries (firm_id, worker_id, work_date, issue_type)
       values ($1, $2, '2026-10-31', 'late_pay')`,
      [t.f.firmId, ann],
    );
    const { rows } = await su.query<{ id: string }>(
      "select id::text as id from pay_queries where firm_id = $1",
      [t.f.firmId],
    );
    const payroll = await t.f.office("payroll");
    await sortPayQueries(
      { firm: { id: t.f.firmId }, officeUserId: payroll, run: withFirm, clock: { now: () => NOW } },
      [rows[0]?.id ?? ""],
      "Paid on Friday.",
    );
    const { rows: jobs } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [PAY_QUERY_UPDATE_QUEUE, t.f.firmId],
    );
    const answer = captureTransport();
    await runFirmTask(
      createPayQueryUpdateTask(() => ({
        transport: answer.transport,
        push: { name: "none", send: async () => ({ status: "skipped" as const }) },
        clock: { now: () => NOW },
      })),
      { id: "job", data: jobs[0]?.data ?? {} },
      withFirm,
    );
    expect(answer.sent).toEqual([expect.objectContaining({ channel: "whatsapp", from: line })]);
  });
});

describe("setting a firm's shifts line (npm run firm:line)", () => {
  it("sets, refuses a number another firm has or one it can't read, asks before replacing, and clears", async () => {
    const t = await lineFirm(null);
    const other = await lineFirm(null);
    const line = await freshLine();
    const spaced = `+44 ${line.slice(3, 7)} ${line.slice(7)}`;
    expect(await setShiftsLine(urls.admin, t.slug, spaced)).toEqual({
      status: "set",
      number: line,
      before: null,
    });
    expect(await firmShiftsLine({ firm: { id: t.f.firmId }, run: withFirm })).toBe(line);
    expect(await setShiftsLine(urls.admin, t.slug, line)).toEqual({ status: "unchanged" });
    // A different number while one is set: only with `replace`.
    const second = await freshLine();
    expect(await setShiftsLine(urls.admin, t.slug, second)).toEqual({
      status: "has_other",
      before: line,
    });
    expect(await firmShiftsLine({ firm: { id: t.f.firmId }, run: withFirm })).toBe(line);
    expect(await setShiftsLine(urls.admin, t.slug, second, { replace: true })).toEqual({
      status: "set",
      number: second,
      before: line,
    });
    expect(await setShiftsLine(urls.admin, t.slug, line, { replace: true })).toEqual({
      status: "set",
      number: line,
      before: second,
    });
    expect(await setShiftsLine(urls.admin, other.slug, line)).toEqual({ status: "taken" });
    expect(await setShiftsLine(urls.admin, other.slug, "not a number")).toEqual({
      status: "bad_number",
    });
    expect(await setShiftsLine(urls.admin, "no-such-firm-zz", line)).toEqual({ status: "no_firm" });
    expect(await setShiftsLine(urls.admin, t.slug, null)).toEqual({
      status: "cleared",
      before: line,
    });
    expect(await firmShiftsLine({ firm: { id: t.f.firmId }, run: withFirm })).toBeNull();
    // Each change is in the firm's action log, without the number (audit L79); the refusals
    // changed nothing and logged nothing.
    const { rows: logged } = await su.query<{
      actor_type: string;
      entity_id: string;
      data: object;
    }>(
      `select actor_type, entity_id::text, data from events
        where firm_id = $1 and action = 'firm.shifts_line_changed' order by id`,
      [t.f.firmId],
    );
    expect(logged.map((e) => e.data)).toEqual([
      { change: "set" },
      { change: "replaced" },
      { change: "replaced" },
      { change: "cleared" },
    ]);
    expect(logged.every((e) => e.actor_type === "system" && e.entity_id === t.f.firmId)).toBe(true);
    // No number in any form. The firm's id (pinned above) is a random UUID that holds "44" about
    // one run in nine, so the pattern reads everything but the id, and the whole rows, id
    // included, are checked for both numbers as stored and as written in the UK.
    const withoutId = logged.map((e) => ({ actor_type: e.actor_type, data: e.data }));
    expect(JSON.stringify(withoutId)).not.toMatch(/\+?44|7700/);
    for (const n of [line, second]) {
      for (const form of [n.slice(1), `0${n.slice(3)}`]) {
        expect(JSON.stringify(logged)).not.toContain(form);
      }
    }
    const { rows: theirs } = await su.query(
      "select 1 from events where firm_id = $1 and action = 'firm.shifts_line_changed'",
      [other.f.firmId],
    );
    expect(theirs).toEqual([]);
  });

  it("finds the firm however its slug is typed (audit L82)", async () => {
    const t = await lineFirm(null);
    const line = await freshLine();
    expect(await setShiftsLine(urls.admin, `  ${t.slug.toUpperCase()} `, line)).toMatchObject({
      status: "set",
    });
    expect(await firmShiftsLine({ firm: { id: t.f.firmId }, run: withFirm })).toBe(line);
  });

  it("reads UK numbers written the usual ways", () => {
    expect(toE164("07700 900123")).toBe("+447700900123");
    // "+44 (0)…": the "(0)" is dropped, as people mean it; a 0 straight after +44 is refused.
    expect(toE164("+44 (0)7700 900123")).toBe("+447700900123");
    expect(toE164("+4407700900123")).toBeNull();
    expect(toE164("+44 7700-900-123")).toBe("+447700900123");
    expect(toE164("7700900123")).toBeNull();
  });
});
