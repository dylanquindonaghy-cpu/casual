import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY } from "@/lib/auth/clock";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { MessagingTransport } from "@/lib/messaging/transport";
import { editSitePostcode, officeSettingsPage } from "@/lib/office/settings-page";
import { bookShift } from "@/lib/roster/book";
import {
  confirmedStrikesEmail,
  confirmStrikesEmail,
  runStrikesEmailLink,
  saveStrikesEmail,
  signStrikesEmailLink,
  STRIKES_EMAIL_LINK_QUEUE,
  type StrikesEmailLinkDeps,
} from "@/lib/office/strikes-email";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Settings (12B.7; docs/office-v2.md 3.10, S10) on the real database, as the app role, with a fixed
// clock (NOW is Monday 2 November 2026, 09:00 London): the one function the app may call to change
// firms.settings, the strikes team's email and its signed link, and the sites' postcodes. Nothing
// is sent anywhere (a capturing transport).

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

const SECRET = "a-test-secret-for-signing-links-0123456789";
const clockAt = (at: Date) => ({ now: () => at });
const clock = clockAt(NOW);
const MINUTE = 60_000;

const settles = (p: Promise<unknown>) => {
  const state = { done: false };
  void p.then(
    () => (state.done = true),
    () => (state.done = true),
  );
  return state;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A run that does its work, says so, and holds its transaction open (locks and all) until released.
function holdingRun() {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let worked: () => void = () => undefined;
  const hasWorked = new Promise<void>((resolve) => (worked = resolve));
  const run: WithFirm = (firmId, fn) =>
    withFirm(firmId, async (tx) => {
      const result = await fn(tx);
      worked();
      await held;
      return result;
    });
  return { run, hasWorked, release };
}

async function settingsFirm() {
  const f = await bookingFirm(su, withFirm, {
    settings: { retention: { message_days: 400, hold_until: "2027-01-31" }, wave_size: 4 },
  });
  const admin = await f.office("admin");
  const office = (officeUserId: string, at = NOW) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: clockAt(at),
    secret: SECRET,
  });
  const settings = async () =>
    (
      await su.query<{ settings: Record<string, unknown> }>(
        "select settings from firms where id = $1",
        [f.firmId],
      )
    ).rows[0]?.settings ?? {};
  const logged = async (action: string) =>
    (
      await su.query<{
        actor_type: string;
        actor_id: string | null;
        data: Record<string, unknown>;
      }>(
        `select actor_type, actor_id::text, data from events
          where firm_id = $1 and action = $2 order by id`,
        [f.firmId, action],
      )
    ).rows;
  const jobs = async () =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2 order by created_on",
        [STRIKES_EMAIL_LINK_QUEUE, f.firmId],
      )
    ).rows.map((r) => r.data);
  const confirmCtx = (at = NOW, ip = "203.0.113.7") => ({
    firm: { id: f.firmId },
    ip,
    run: withFirm,
    clock: clockAt(at),
    secret: SECRET,
  });
  // The latest save of the address: what a link signs besides the address.
  const saved = async () =>
    Number(
      (
        await su.query<{ id: string }>(
          `select coalesce(max(id), 0)::text as id from events
            where firm_id = $1 and action = 'firm.settings_changed' and data -> 'keys' ? 'strikes.email'`,
          [f.firmId],
        )
      ).rows[0]?.id ?? 0,
    );
  // A link as the job would sign it now (another secret or firm, to forge one).
  const link = async (
    address: string,
    expiresAt = new Date(NOW.getTime() + DAY),
    o: { secret?: string; firmId?: string } = {},
  ) =>
    signStrikesEmailLink(o.secret ?? SECRET, {
      firmId: o.firmId ?? f.firmId,
      address,
      saved: await saved(),
      expiresAt,
    });
  return { f, admin, office, settings, logged, jobs, confirmCtx, saved, link };
}

describe("app_set_firm_setting(): the only way the app may change firms.settings", () => {
  it("the app's login can't update firms itself, so retention and the hold can't be touched directly", async () => {
    const t = await settingsFirm();
    const client = await app.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.current_firm_id', $1, true)", [t.f.firmId]);
      await expect(
        client.query(
          `update firms set settings = jsonb_set(settings, '{retention,message_days}', '30')
            where id = $1`,
          [t.f.firmId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect((await t.settings()).retention).toEqual({ message_days: 400, hold_until: "2027-01-31" });
  });

  it.each([
    ["retention.message_days", "30"],
    ["retention.hold_until", "2020-01-01"],
    ["retention.request_note_days", "30"],
    ["wave_size", "1"],
    ["strikes.notice_hours", "1"],
    ["webhook.url", "https://hooks.example.com/x"],
    ["strikes", '{"email":"a@example.com"}'],
    [null, "x"],
  ])("refuses %s through the function", async (key, value) => {
    const t = await settingsFirm();
    const before = await t.settings();
    await expect(
      withFirm(t.f.firmId, async (tx) => {
        const { sql } = await import("drizzle-orm");
        await tx.execute(sql`select app_set_firm_setting(${key}, ${value})`);
      }),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    expect(await t.settings()).toEqual(before);
  });

  it("sets the address, clears its confirmed time when it changes, and checks what it's given", async () => {
    const t = await settingsFirm();
    const { sql } = await import("drizzle-orm");
    const set = (key: string, value: string | null) =>
      withFirm(t.f.firmId, (tx) => tx.execute(sql`select app_set_firm_setting(${key}, ${value})`));
    await set("strikes.email", "strikes.team@example.com");
    await set("strikes.email_verified_at", "2026-11-02T09:00:00Z");
    expect((await t.settings()).strikes).toEqual({
      email: "strikes.team@example.com",
      email_verified_at: "2026-11-02T09:00:00.000Z",
    });
    // The same address again: still confirmed. A new one: not.
    await set("strikes.email", "strikes.team@example.com");
    expect((await t.settings()).strikes).toMatchObject({
      email_verified_at: "2026-11-02T09:00:00.000Z",
    });
    await set("strikes.email", "other.team@example.com");
    expect((await t.settings()).strikes).toEqual({ email: "other.team@example.com" });
    // Not an address, not a time, a time with no address: refused, nothing changed.
    await expect(set("strikes.email", "not an address")).rejects.toMatchObject({
      cause: { code: "22023" },
    });
    // Only an ISO time in UTC: never a word Postgres would read as a time.
    for (const notATime of ["yesterday-ish", "now", "epoch", "infinity", "2026-11-02 09:00"]) {
      await expect(set("strikes.email_verified_at", notATime)).rejects.toMatchObject({
        cause: { code: "22023" },
      });
    }
    await set("strikes.email", null);
    expect((await t.settings()).strikes).toEqual({});
    await expect(set("strikes.email_verified_at", "2026-11-02T09:00:00Z")).rejects.toMatchObject({
      cause: { code: "22023" },
    });
    // The rest of the settings never moved.
    expect(await t.settings()).toMatchObject({
      retention: { message_days: 400, hold_until: "2027-01-31" },
      wave_size: 4,
    });
  });

  it("refuses settings or settings.strikes that aren't objects, rather than replacing them", async () => {
    const t = await settingsFirm();
    const { sql } = await import("drizzle-orm");
    const set = () =>
      withFirm(t.f.firmId, (tx) =>
        tx.execute(sql`select app_set_firm_setting('strikes.email', 'strikes.team@example.com')`),
      );
    await su.query(
      `update firms set settings = jsonb_set(settings, '{strikes}', '"x"') where id = $1`,
      [t.f.firmId],
    );
    await expect(set()).rejects.toMatchObject({ cause: { code: "22023" } });
    expect((await t.settings()).strikes).toBe("x");
    await su.query("update firms set settings = '[]' where id = $1", [t.f.firmId]);
    await expect(set()).rejects.toMatchObject({ cause: { code: "22023" } });
    expect(await t.settings()).toEqual([]);
  });

  it("changes only the firm the transaction is in, and needs one", async () => {
    const t = await settingsFirm();
    const other = await settingsFirm();
    const { sql } = await import("drizzle-orm");
    await withFirm(t.f.firmId, (tx) =>
      tx.execute(sql`select app_set_firm_setting('strikes.email', 'strikes.team@example.com')`),
    );
    expect((await other.settings()).strikes).toBeUndefined();
    const client = await app.connect();
    try {
      await expect(
        client.query("select app_set_firm_setting('strikes.email', 'x@example.com')"),
      ).rejects.toThrow(/needs a firm/);
    } finally {
      client.release();
    }
  });

  it("runs as its owner, with a pinned search_path; only the app role may call it", async () => {
    const { rows } = await su.query<{ definer: boolean; config: string[]; acl: string[] }>(
      `select prosecdef as definer, proconfig as config, proacl::text[] as acl
         from pg_proc where oid = 'app_set_firm_setting(text, text)'::regprocedure`,
    );
    expect(rows[0]?.definer).toBe(true);
    expect(rows[0]?.config).toEqual(["search_path=pg_catalog, pg_temp"]);
    expect(rows[0]?.acl.filter((entry) => entry.startsWith("="))).toEqual([]);
    expect(rows[0]?.acl.some((entry) => entry.startsWith("shiftdesk_app=X/"))).toBe(true);
    expect(rows[0]?.acl.some((entry) => entry.startsWith("shiftdesk_jobs="))).toBe(false);
  });
});

describe("saving the strikes team's email", () => {
  it("only active admins; a resourcer, payroll or a disabled admin changes nothing", async () => {
    const t = await settingsFirm();
    for (const id of [
      await t.f.office("resourcer"),
      await t.f.office("payroll"),
      await t.f.office("admin", "disabled"),
    ]) {
      expect(await saveStrikesEmail(t.office(id), { address: "strikes.team@example.com" })).toEqual(
        { status: "not_allowed" },
      );
    }
    expect((await t.settings()).strikes).toBeUndefined();
    expect(await t.jobs()).toEqual([]);
  });

  it("saves, logs the key only, and queues the link (ids only); again resends; confirmed: unchanged", async () => {
    const t = await settingsFirm();
    expect(
      await saveStrikesEmail(t.office(t.admin), { address: " strikes.team@example.com " }),
    ).toEqual({ status: "saved" });
    expect((await t.settings()).strikes).toEqual({ email: "strikes.team@example.com" });
    expect(await t.logged("firm.settings_changed")).toEqual([
      { actor_type: "office", actor_id: t.admin, data: { by: "firm", keys: ["strikes.email"] } },
    ]);
    const [job] = await t.jobs();
    expect(Object.keys(job ?? {}).sort()).toEqual(["firmId", "idempotencyKey"]);
    expect(JSON.stringify(await t.jobs())).not.toContain("@");
    // Not confirmed yet: the same address sends the link again, without another settings entry.
    expect(
      await saveStrikesEmail(t.office(t.admin), { address: "Strikes.Team@example.com" }),
    ).toEqual({ status: "sent_again" });
    expect(await t.jobs()).toHaveLength(2);
    expect(await t.logged("firm.settings_changed")).toHaveLength(1);
    // Confirmed: the same address changes nothing; a new one clears the confirmation.
    await confirmStrikesEmail(t.confirmCtx(), await t.link("strikes.team@example.com"));
    expect(
      await saveStrikesEmail(t.office(t.admin), { address: "strikes.team@example.com" }),
    ).toEqual({ status: "unchanged" });
    expect(await saveStrikesEmail(t.office(t.admin), { address: "new.team@example.com" })).toEqual({
      status: "saved",
    });
    expect((await t.settings()).strikes).toEqual({ email: "new.team@example.com" });
    expect((await t.logged("firm.settings_changed")).at(-1)?.data).toEqual({
      by: "firm",
      keys: ["strikes.email", "strikes.email_verified_at"],
    });
    expect(await saveStrikesEmail(t.office(t.admin), { address: "" })).toEqual({
      status: "cleared",
    });
    expect((await t.settings()).strikes).toEqual({});
    expect(await saveStrikesEmail(t.office(t.admin), { address: "not an address" })).toEqual({
      status: "invalid",
    });
  });
});

describe("how many links a firm can send", () => {
  it("3 every 15 minutes and 10 a day; over that nothing changes, and the first refusal is logged", async () => {
    const t = await settingsFirm();
    const save = (address: string, at = NOW) =>
      saveStrikesEmail(t.office(t.admin, at), { address });
    expect(await save("first.team@example.com")).toEqual({ status: "saved" });
    expect(await save("first.team@example.com")).toEqual({ status: "sent_again" });
    expect(await save("second.team@example.com")).toEqual({ status: "saved" });
    // The fourth in the window: refused, the address isn't changed and no link is queued.
    const refused = await save("third.team@example.com");
    expect(refused).toMatchObject({ status: "too_many" });
    expect(refused.status === "too_many" && refused.retryAfterMinutes).toBeGreaterThan(0);
    expect(await save("second.team@example.com")).toMatchObject({ status: "too_many" });
    expect((await t.settings()).strikes).toEqual({ email: "second.team@example.com" });
    expect(await t.jobs()).toHaveLength(3);
    expect((await t.logged("auth.rate_limited")).map((e) => e.data)).toEqual([
      { limit: "strikes_link:firm" },
    ]);
    // Clearing the address, or a confirmed one saved again, sends nothing and isn't counted.
    expect(await save("")).toEqual({ status: "cleared" });
    // Later windows: 3, 3 and 1 more make 10 that day; the 11th waits for the next day.
    for (const [minutes, n] of [
      [15, 3],
      [30, 3],
      [45, 1],
    ] as const) {
      for (let i = 0; i < n; i++) {
        expect(
          await save(
            `team.${minutes}.${i}@example.com`,
            new Date(NOW.getTime() + minutes * MINUTE),
          ),
        ).toEqual({ status: "saved" });
      }
    }
    expect(
      await save("eleventh.team@example.com", new Date(NOW.getTime() + 60 * MINUTE)),
    ).toMatchObject({ status: "too_many" });
    expect(await t.jobs()).toHaveLength(10);
    expect((await t.logged("auth.rate_limited")).map((e) => e.data)).toEqual([
      { limit: "strikes_link:firm" },
      { limit: "strikes_link:firm_day" },
    ]);
  });
});

describe("the link: sent once, signed for the address, 7 days", () => {
  const transportWith = (fail = false) => {
    const { transport, sent } = captureTransport();
    const t: MessagingTransport = fail
      ? {
          name: "failing",
          async send() {
            throw new Error("down");
          },
        }
      : transport;
    return { transport: t, sent };
  };
  const deps = (transport: MessagingTransport, at = NOW): StrikesEmailLinkDeps => ({
    transport,
    baseDomain: "localhost:3000",
    clock: clockAt(at),
    secret: SECRET,
  });

  it("emails the address a link; a second run sends nothing; a failure is logged", async () => {
    const t = await settingsFirm();
    await saveStrikesEmail(t.office(t.admin), { address: "strikes.team@example.com" });
    const [payload] = (await t.jobs()) as { firmId: string; idempotencyKey: string }[];
    if (!payload) throw new Error("no job");
    const { transport, sent } = transportWith();
    expect(await runStrikesEmailLink(payload, withFirm, deps(transport))).toEqual({
      status: "sent",
    });
    expect(await runStrikesEmailLink(payload, withFirm, deps(transport))).toEqual({
      status: "already",
    });
    expect(sent).toHaveLength(1);
    const email = sent[0];
    if (email?.channel !== "email") throw new Error("not an email");
    expect(email.to).toBe("strikes.team@example.com");
    const link = /(http:\/\/\S+\/confirm-email#([A-Za-z0-9_-]{28}\.[A-Za-z0-9_-]{43}))/.exec(
      email.body,
    );
    expect(link?.[1]).toMatch(/^http:\/\/[a-z0-9-]+\.localhost:3000\/confirm-email#/);
    // Logged without the address or the link.
    const claimed = await t.logged("firm.strikes_email_link");
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.data).toEqual({
      request: payload.idempotencyKey,
      expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString(),
    });
    expect(await t.logged("firm.strikes_email_link_sent")).toHaveLength(1);
    // The link confirms the address.
    expect(await confirmStrikesEmail(t.confirmCtx(), link?.[2] ?? "")).toEqual({
      status: "confirmed",
    });
    expect(confirmedStrikesEmail(await t.settings())).toBe("strikes.team@example.com");

    // A job for a confirmed address: nothing to send. A failing send: logged, not retried.
    await saveStrikesEmail(t.office(t.admin), { address: "other.team@example.com" });
    const second = (await t.jobs()).at(-1) as { firmId: string; idempotencyKey: string };
    const failing = transportWith(true);
    expect(await runStrikesEmailLink(second, withFirm, deps(failing.transport))).toEqual({
      status: "failed",
    });
    expect((await t.logged("firm.strikes_email_link_failed"))[0]?.data).toMatchObject({
      request: second.idempotencyKey,
    });
    expect(await runStrikesEmailLink(second, withFirm, deps(transport))).toEqual({
      status: "already",
    });
    await confirmStrikesEmail(t.confirmCtx(), await t.link("other.team@example.com"));
    await saveStrikesEmail(t.office(t.admin), { address: "other.team@example.com" });
    const third = (await t.jobs()).at(-1) as { firmId: string; idempotencyKey: string };
    expect(await runStrikesEmailLink(third, withFirm, deps(transport))).toMatchObject({
      status: expect.stringMatching(/^(not_needed|already)$/),
    });
  });

  it("a changed, another firm's or expired link is refused; one for an old address doesn't confirm a new one", async () => {
    const t = await settingsFirm();
    const other = await settingsFirm();
    await saveStrikesEmail(t.office(t.admin), { address: "strikes.team@example.com" });
    const expiresAt = new Date(NOW.getTime() + 7 * DAY);
    const good = await t.link("strikes.team@example.com", expiresAt);
    const [packedText = "", mac] = good.split(".");
    const flip = (s = "") => (s.startsWith("A") ? `B${s.slice(1)}` : `A${s.slice(1)}`);
    const later = Buffer.from(packedText, "base64url");
    later.writeUIntBE(later.readUIntBE(16, 5) + 86_400, 16, 5);
    for (const bad of [
      `${packedText}.${flip(mac)}`, // a changed signature
      `${later.toString("base64url")}.${mac}`, // a later expiry
      await t.link("strikes.team@example.com", expiresAt, {
        secret: "another-secret-entirely-0123456789abcdef",
      }),
      // Another firm's link, for the same address.
      await t.link("strikes.team@example.com", expiresAt, { firmId: other.f.firmId }),
      "",
      "v1.not-a-link",
    ]) {
      expect(await confirmStrikesEmail(t.confirmCtx(), bad)).toEqual({ status: "invalid" });
    }
    // Seven days and a second later: expired.
    expect(
      await confirmStrikesEmail(t.confirmCtx(new Date(expiresAt.getTime() + 1000)), good),
    ).toEqual({ status: "expired" });
    // The address changes: the old link no longer works, and the new address isn't confirmed.
    await saveStrikesEmail(t.office(t.admin), { address: "new.team@example.com" });
    expect(await confirmStrikesEmail(t.confirmCtx(), good)).toEqual({ status: "invalid" });
    expect(confirmedStrikesEmail(await t.settings())).toBeNull();
    expect(await t.logged("firm.settings_changed")).toHaveLength(2); // the two saves only
    // The good link confirms once; again: already.
    const fresh = await t.link("new.team@example.com", expiresAt);
    expect(await confirmStrikesEmail(t.confirmCtx(), fresh)).toEqual({ status: "confirmed" });
    expect(await confirmStrikesEmail(t.confirmCtx(), fresh)).toEqual({ status: "already" });
    expect((await t.logged("firm.settings_changed")).at(-1)).toEqual({
      actor_type: "system",
      actor_id: null,
      data: { by: "link", keys: ["strikes.email_verified_at"] },
    });
  });
});

describe("the link, used again or guessed at", () => {
  it("a link sent before the address was saved again doesn't confirm it (cleared and added back, or changed back)", async () => {
    const t = await settingsFirm();
    await saveStrikesEmail(t.office(t.admin), { address: "strikes.team@example.com" });
    const first = await t.link("strikes.team@example.com");
    await saveStrikesEmail(t.office(t.admin), { address: "" });
    await saveStrikesEmail(t.office(t.admin, new Date(NOW.getTime() + 16 * MINUTE)), {
      address: "strikes.team@example.com",
    });
    expect(await confirmStrikesEmail(t.confirmCtx(), first)).toEqual({ status: "invalid" });
    expect(confirmedStrikesEmail(await t.settings())).toBeNull();
    // The link sent for this save works.
    expect(
      await confirmStrikesEmail(t.confirmCtx(), await t.link("strikes.team@example.com")),
    ).toEqual({ status: "confirmed" });
  });

  it("failed links count against the IP: after 20, none is checked from it for 15 minutes; junk isn't counted", async () => {
    const t = await settingsFirm();
    await saveStrikesEmail(t.office(t.admin), { address: "strikes.team@example.com" });
    const good = await t.link("strikes.team@example.com");
    const [packed = "", mac = ""] = good.split(".");
    const forged = `${packed}.${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`;
    // Junk (no link, or another firm's) is refused before the database: not counted.
    for (let i = 0; i < 30; i++) {
      expect(await confirmStrikesEmail(t.confirmCtx(), "v1.not-a-link")).toEqual({
        status: "invalid",
      });
    }
    for (let i = 0; i < 20; i++) {
      expect(await confirmStrikesEmail(t.confirmCtx(), forged)).toEqual({ status: "invalid" });
    }
    expect((await t.logged("auth.rate_limited")).map((e) => e.data)).toEqual([
      { limit: "link_fail:ip" },
    ]);
    const paused = await confirmStrikesEmail(t.confirmCtx(), good);
    expect(paused).toMatchObject({ status: "rate_limited" });
    expect(confirmedStrikesEmail(await t.settings())).toBeNull();
    // Another IP isn't held back; nor this one once the window has passed.
    expect(
      await confirmStrikesEmail(t.confirmCtx(new Date(NOW.getTime() + 16 * MINUTE)), good),
    ).toEqual({ status: "confirmed" });
    const other = await settingsFirm();
    await saveStrikesEmail(other.office(other.admin), { address: "strikes.team@example.com" });
    expect(
      await confirmStrikesEmail(
        other.confirmCtx(NOW, "198.51.100.23"),
        await other.link("strikes.team@example.com"),
      ),
    ).toEqual({ status: "confirmed" });
  });

  it("saving and confirming take turns: a link used while the address is being changed waits, then is refused", async () => {
    const t = await settingsFirm();
    await saveStrikesEmail(t.office(t.admin), { address: "strikes.team@example.com" });
    const old = await t.link("strikes.team@example.com");
    // A save in progress: it holds the firm's strikes-email lock and has changed the address.
    const c = await su.connect();
    try {
      await c.query("begin");
      await c.query(
        "select pg_advisory_xact_lock(hashtextextended('strikes-email:' || $1::text, 0))",
        [t.f.firmId],
      );
      await c.query(
        `update firms set settings = jsonb_set(settings, '{strikes}', '{"email":"new.team@example.com"}')
          where id = $1`,
        [t.f.firmId],
      );
      const confirming = confirmStrikesEmail(t.confirmCtx(), old);
      const state = settles(confirming);
      await pause(400);
      expect(state.done).toBe(false);
      await c.query("commit");
      expect(await confirming).toEqual({ status: "invalid" });
    } finally {
      await c.query("rollback").catch(() => undefined); // after a failure: let the locks go
      c.release();
    }
    expect((await t.settings()).strikes).toEqual({ email: "new.team@example.com" });
  });
});

describe("a site's postcode", () => {
  async function siteFirm() {
    const t = await settingsFirm();
    const { rows } = await su.query<{ id: string }>(
      `insert into sites (firm_id, name, postcode) values ($1, 'Riverside Arena', 'ZZ1 1AA')
       returning id::text as id`,
      [t.f.firmId],
    );
    const siteId = rows[0]?.id ?? "";
    return { ...t, siteId };
  }
  const postcodeOf = async (siteId: string) =>
    (
      await su.query<{ postcode: string | null }>("select postcode from sites where id = $1", [
        siteId,
      ])
    ).rows[0]?.postcode;

  it("refused while live bookings on sessions to come use the site; allowed without them", async () => {
    const t = await siteFirm();
    const casual = await t.f.worker();
    const later = await t.f.shift({ startsAt: hoursFromNow(48) });
    const later2 = await t.f.shift({ startsAt: hoursFromNow(96) });
    const past = await t.f.shift({ startsAt: hoursFromNow(-48) });
    await su.query("update shifts set site_id = $2 where id = any($1)", [
      [later, later2, past],
      t.siteId,
    ]);
    await t.f.booking(casual, later);
    await t.f.booking(await t.f.worker({ first: "Two" }), later2);
    await t.f.booking(await t.f.worker({ first: "Old" }), past);
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "ZZ9 9ZZ" })).toEqual({
      status: "in_use",
      sessions: 2,
    });
    expect(await postcodeOf(t.siteId)).toBe("ZZ1 1AA");
    // Those bookings cancelled (only the past one is left): allowed, tidied, logged without it.
    await su.query(
      `update assignments set status = 'cancelled_worker', cancelled_at = now(),
              cancel_reason = 'Unwell', notice_hours = 40
        where shift_id = any($1)`,
      [[later, later2]],
    );
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: " zz9  9zz " })).toEqual(
      {
        status: "saved",
      },
    );
    expect(await postcodeOf(t.siteId)).toBe("ZZ9 9ZZ");
    expect(await t.logged("site.changed")).toEqual([
      { actor_type: "office", actor_id: t.admin, data: { siteId: t.siteId, fields: ["postcode"] } },
    ]);
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "ZZ9 9ZZ" })).toEqual({
      status: "unchanged",
    });
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "not one" })).toEqual({
      status: "invalid",
    });
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "" })).toEqual({
      status: "saved",
    });
    expect(await postcodeOf(t.siteId)).toBeNull();
  });

  it("only sessions still to come count: one under way, or a cancelled one, doesn't", async () => {
    const t = await siteFirm();
    const underWay = await t.f.shift({ startsAt: hoursFromNow(-2) }); // 8 hours: ends in 6
    const cancelled = await t.f.shift({ startsAt: hoursFromNow(30), status: "cancelled" });
    const soon = await t.f.shift({ startsAt: hoursFromNow(1) });
    await su.query("update shifts set site_id = $2 where id = any($1)", [
      [underWay, cancelled, soon],
      t.siteId,
    ]);
    await t.f.booking(await t.f.worker(), underWay);
    await t.f.booking(await t.f.worker({ first: "Two" }), cancelled);
    await t.f.booking(await t.f.worker({ first: "Three" }), soon);
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "ZZ9 9ZZ" })).toEqual({
      status: "in_use",
      sessions: 1,
    });
    await su.query("update shifts set starts_at = $2 where id = $1", [soon, hoursFromNow(-1)]);
    expect(await editSitePostcode(t.office(t.admin), t.siteId, { postcode: "ZZ9 9ZZ" })).toEqual({
      status: "saved",
    });
  });

  it("a booking in progress at the site: the change waits for it, then is refused", async () => {
    const t = await siteFirm();
    const session = await t.f.shift({ startsAt: hoursFromNow(48) });
    await su.query("update shifts set site_id = $2 where id = $1", [session, t.siteId]);
    const casual = await t.f.worker();
    // A booking as the roster takes one: the session's row first, then the slot; not committed.
    const c = await su.connect();
    try {
      await c.query("begin");
      await c.query("select id from shifts where id = $1 for no key update", [session]);
      await c.query(
        `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
         values ($1, $2, 1, $3, 'confirmed', now())`,
        [t.f.firmId, session, casual],
      );
      const edit = editSitePostcode(t.office(t.admin), t.siteId, { postcode: "ZZ9 9ZZ" });
      const state = settles(edit);
      await pause(400);
      expect(state.done).toBe(false);
      await c.query("commit");
      expect(await edit).toEqual({ status: "in_use", sessions: 1 });
    } finally {
      await c.query("rollback").catch(() => undefined); // after a failure: let the locks go
      c.release();
    }
    expect(await postcodeOf(t.siteId)).toBe("ZZ1 1AA");
  });

  it("while a change is being made, a booking at the site and a session moved to it wait for it", async () => {
    const t = await siteFirm();
    const session = await t.f.shift({ startsAt: hoursFromNow(48) });
    const elsewhere = await t.f.shift({ startsAt: hoursFromNow(72) });
    await su.query("update shifts set site_id = $2 where id = $1", [session, t.siteId]);
    const casual = await t.f.worker();
    const holding = holdingRun();
    const edit = editSitePostcode({ ...t.office(t.admin), run: holding.run }, t.siteId, {
      postcode: "ZZ9 9ZZ",
    });
    await holding.hasWorked;
    const booking = bookShift(
      withFirm,
      t.f.firmId,
      { shiftId: session, workerId: casual, by: { type: "worker", id: casual } },
      { clock },
    );
    const moving = su.query("update shifts set site_id = $2 where id = $1", [elsewhere, t.siteId]);
    const states = [settles(booking), settles(moving)];
    await pause(400);
    expect(states.map((s) => s.done)).toEqual([false, false]);
    holding.release();
    expect(await edit).toEqual({ status: "saved" });
    expect(await booking).toMatchObject({ status: "booked" });
    await moving;
    expect(await postcodeOf(t.siteId)).toBe("ZZ9 9ZZ");
  });

  it("only active admins, and only the firm's own sites", async () => {
    const t = await siteFirm();
    const other = await siteFirm();
    for (const id of [
      await t.f.office("resourcer"),
      await t.f.office("payroll"),
      await t.f.office("admin", "disabled"),
    ]) {
      expect(await editSitePostcode(t.office(id), t.siteId, { postcode: "ZZ9 9ZZ" })).toEqual({
        status: "not_allowed",
      });
    }
    expect(await postcodeOf(t.siteId)).toBe("ZZ1 1AA");
    expect(await t.logged("site.changed")).toEqual([]);
    expect(
      await editSitePostcode(t.office(t.admin), other.siteId, { postcode: "ZZ9 9ZZ" }),
    ).toEqual({ status: "not_found" });
    expect(await postcodeOf(other.siteId)).toBe("ZZ1 1AA");
  });
});

describe("the Settings page's data", () => {
  it("admins only: the address and its state, each site with its booked sessions", async () => {
    const t = await settingsFirm();
    const tokenFor = async (id: string) =>
      (
        await withFirm(t.f.firmId, (tx) =>
          createSession(tx, { kind: "office", subjectId: id, now: NOW }),
        )
      ).token;
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock };
    expect(await officeSettingsPage(ctx, await tokenFor(await t.f.office("resourcer")))).toBeNull();
    await saveStrikesEmail(t.office(t.admin), { address: "strikes.team@example.com" });
    const [payload] = (await t.jobs()) as { firmId: string; idempotencyKey: string }[];
    if (!payload) throw new Error("no job");
    const { transport } = captureTransport();
    await runStrikesEmailLink(payload, withFirm, {
      transport,
      baseDomain: "localhost:3000",
      clock,
      secret: SECRET,
    });
    const page = await officeSettingsPage(ctx, await tokenFor(t.admin));
    expect(page?.strikesEmail).toMatchObject({
      address: "strikes.team@example.com",
      confirmedAt: null,
    });
    expect(page?.strikesEmail.linkSentAt).toBeInstanceOf(Date);
  });

  it("lists the firm's own sites only, each with its booked sessions still to come", async () => {
    const t = await settingsFirm();
    const other = await settingsFirm();
    const site = async (firmId: string, name: string) =>
      (
        await su.query<{ id: string }>(
          `insert into sites (firm_id, name, postcode) values ($1, $2, 'ZZ1 1AA') returning id::text as id`,
          [firmId, name],
        )
      ).rows[0]?.id ?? "";
    const arena = await site(t.f.firmId, "Riverside Arena");
    const park = await site(t.f.firmId, "Northgate Park");
    await site(other.f.firmId, "Another Firm's Ground");
    const session = await t.f.shift({ startsAt: hoursFromNow(48) });
    await su.query("update shifts set site_id = $2 where id = $1", [session, arena]);
    await t.f.booking(await t.f.worker(), session);
    const { token } = await withFirm(t.f.firmId, (tx) =>
      createSession(tx, { kind: "office", subjectId: t.admin, now: NOW }),
    );
    const page = await officeSettingsPage(
      { firm: { id: t.f.firmId }, run: withFirm, clock },
      token,
    );
    expect(page?.sites).toEqual([
      { siteId: park, name: "Northgate Park", postcode: "ZZ1 1AA", bookedSessions: 0 },
      { siteId: arena, name: "Riverside Arena", postcode: "ZZ1 1AA", bookedSessions: 1 },
    ]);
  });
});
