import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { BASELINE_KEYS } from "@/lib/metrics/definitions";
import { firmReadiness, readinessText, type ReadinessItem } from "@/lib/onboarding/readiness";
import { addOfficeUser, createFirm } from "../../scripts/firm-create-owner";
import { readFirmSettings, setFirmSettings } from "../../scripts/firm-settings-owner";
import { connectSheet } from "../../scripts/firm-sheet-owner";
import { appRolePool, superuserPool, testEvent, uniqueSlug, urls } from "../helpers/db";

// Onboarding a pilot firm (docs/runbooks.md "Onboarding a pilot firm"): creating it, agreeing its
// settings, and the checklist from its data.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool();
  withFirm = createWithFirm(app);
});

afterAll(async () => {
  await app.end();
  await su.end();
});

const newFirm = (over: Partial<Parameters<typeof createFirm>[2]> = {}) => ({
  slug: uniqueSlug("o"),
  name: "Onboard Test Events",
  sector: "security",
  adminEmail: "Owner.Person@Example.com",
  adminName: "Owner Person",
  ...over,
});

async function created(over: Partial<Parameters<typeof createFirm>[2]> = {}) {
  const input = newFirm(over);
  const result = await createFirm(urls.admin, withFirm, input);
  if (result.status !== "created") throw new Error(`not created: ${result.status}`);
  return { ...input, firmId: result.firmId, result };
}

describe("creating a firm", () => {
  it("makes the firm, applies its sector's pack, adds its first admin, and logs it", async () => {
    const f = await created();
    expect(f.result).toMatchObject({ status: "created", resumed: false });
    expect(f.result.status === "created" && f.result.typesAdded).toBeGreaterThan(0);
    expect(f.result.status === "created" && f.result.rulesAdded).toBeGreaterThan(0);
    const { rows: firm } = await su.query(
      "select name, slug, sector, settings from firms where id = $1",
      [f.firmId],
    );
    expect(firm[0]).toEqual({
      name: "Onboard Test Events",
      slug: f.slug,
      sector: "security",
      settings: {},
    });
    const { rows: users } = await su.query(
      "select email, name, role, status from office_users where firm_id = $1",
      [f.firmId],
    );
    expect(users).toEqual([
      { email: "owner.person@example.com", name: "Owner Person", role: "admin", status: "active" },
    ]);
    const { rows: events } = await su.query<{ action: string; data: unknown }>(
      "select action, data from events where firm_id = $1 order by id",
      [f.firmId],
    );
    // The firm's row and its event in one transaction (the owner's), then the rest.
    expect(events.map((e) => e.action)).toEqual([
      "firm.created",
      "credential_pack.applied",
      "office_user.added",
    ]);
    expect(events[0]?.data).toEqual({ sector: "security" });
    expect(events[2]?.data).toEqual({ role: "admin" });
  });

  it("refuses a bad slug, name, sector, email or admin name, and a slug already taken", async () => {
    const bad = async (over: Partial<Parameters<typeof createFirm>[2]>) =>
      createFirm(urls.admin, withFirm, newFirm(over));
    expect(await bad({ slug: "Acme Events" })).toEqual({ status: "bad", field: "slug" });
    expect(await bad({ slug: "admin" })).toEqual({ status: "bad", field: "slug" });
    expect(await bad({ name: "A" })).toEqual({ status: "bad", field: "name" });
    expect(await bad({ name: "Acme\nEvents" })).toEqual({ status: "bad", field: "name" });
    expect(await bad({ sector: "retail" })).toEqual({ status: "bad", field: "sector" });
    expect(await bad({ adminEmail: "jo" })).toEqual({ status: "bad", field: "adminEmail" });
    expect(await bad({ adminName: " " })).toEqual({ status: "bad", field: "adminName" });
    const f = await created();
    expect(await bad({ slug: f.slug })).toEqual({ status: "taken" });
    expect(await bad({ slug: f.slug.toUpperCase() })).toEqual({ status: "taken" });
  });

  it("two runs finishing the same half-made firm at once: one admin, the other is told it's taken", async () => {
    const input = newFirm();
    await expect(
      createFirm(urls.admin, () => Promise.reject(new Error("stopped")), input),
    ).rejects.toThrow(/stopped/);
    const results = await Promise.all([
      createFirm(urls.admin, withFirm, input),
      createFirm(urls.admin, withFirm, { ...input, adminEmail: "second.person@example.com" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["created", "taken"]);
    const { rows } = await su.query(
      "select count(*)::int as n from office_users o join firms f on f.id = o.firm_id where f.slug = $1",
      [input.slug],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });

  it("a setup that stopped after the firm's row is finished by running it again", async () => {
    const input = newFirm();
    const broken: WithFirm = () => Promise.reject(new Error("the database went away"));
    await expect(createFirm(urls.admin, broken, input)).rejects.toThrow(/went away/);
    const { rows } = await su.query<{ id: string }>(
      "select id::text as id from firms where slug = $1",
      [input.slug],
    );
    expect(rows).toHaveLength(1);
    // The firm was logged with its row, even though the rest didn't happen.
    const { rows: logged } = await su.query(
      "select action from events where firm_id = $1 order by id",
      [rows[0]?.id],
    );
    expect(logged).toEqual([{ action: "firm.created" }]);
    // A different name or sector isn't the same setup: refused.
    expect(await createFirm(urls.admin, withFirm, { ...input, sector: "rail" })).toEqual({
      status: "taken",
    });
    expect(await createFirm(urls.admin, withFirm, { ...input, name: "Someone Else Ltd" })).toEqual({
      status: "taken",
    });
    const again = await createFirm(urls.admin, withFirm, input);
    expect(again).toMatchObject({ status: "created", resumed: true });
    // Once it has an office user, it's taken.
    expect(await createFirm(urls.admin, withFirm, input)).toEqual({ status: "taken" });
    const { rows: users } = await su.query(
      "select count(*)::int as n from office_users o join firms f on f.id = o.firm_id where f.slug = $1",
      [input.slug],
    );
    expect(users[0]).toEqual({ n: 1 });
  });
});

describe("adding office users", () => {
  it("a resourcer or payroll user, logged; the same email again is left alone; bad values refused", async () => {
    const f = await created();
    const add = (email: string, role: string, name = "Sam Rota") =>
      addOfficeUser(withFirm, f.firmId, { email, name, role });
    expect(await add("Sam.Rota@Example.com", "resourcer")).toEqual({ status: "added" });
    expect(await add("pay@example.com", "payroll", "Pat Pay")).toEqual({ status: "added" });
    // Already there: left as it is, and said how it is.
    expect(await add("sam.rota@example.com", "admin")).toEqual({
      status: "already",
      role: "resourcer",
      active: true,
    });
    expect(await add("x@example.com", "boss")).toEqual({ status: "bad", field: "role" });
    expect(await add("nope", "resourcer")).toEqual({ status: "bad", field: "email" });
    expect(await add("y@example.com", "resourcer", "S")).toEqual({ status: "bad", field: "name" });
    expect(
      await addOfficeUser(withFirm, null, { email: "z@example.com", name: "Zed", role: "admin" }),
    ).toEqual({ status: "no_firm" });
    const { rows } = await su.query(
      "select email, role from office_users where firm_id = $1 order by email",
      [f.firmId],
    );
    expect(rows).toEqual([
      { email: "owner.person@example.com", role: "admin" },
      { email: "pay@example.com", role: "payroll" },
      { email: "sam.rota@example.com", role: "resourcer" },
    ]);
    const { rows: events } = await su.query(
      "select data from events where firm_id = $1 and action = 'office_user.added' order by id",
      [f.firmId],
    );
    expect(events.map((e) => e.data)).toEqual([
      { role: "admin" },
      { role: "resourcer" },
      { role: "payroll" },
    ]);
  });
});

describe("a firm's settings", () => {
  it("shows what the app reads, defaults marked", async () => {
    const f = await created();
    const result = await readFirmSettings(urls.admin, f.slug);
    if (result.status !== "ok") throw new Error(result.status);
    expect(Object.fromEntries(result.settings.map((s) => [s.key, [s.value, s.source]]))).toEqual({
      allocation_mode: ["first_come_first_served", "default"],
      wave_size: [4, "default"],
      wave_minutes: [15, "default"],
      urgent_window_hours: [24, "default"],
      escalate_hours_before_start: [3, "default"],
      short_notice_threshold_hours: [48, "default"],
      "quiet_hours.start": ["22:00", "default"],
      "quiet_hours.end": ["07:00", "default"],
      "quiet_hours.urgent_override": [true, "default"],
      // How long the firm keeps things (Phase 10, audit M24): the spec's defaults until agreed.
      "retention.message_days": [90, "default"],
      "retention.request_note_days": [365, "default"],
      "retention.hold_until": ["none", "default"],
      // Strikes (12C.1): the notice that avoids one, how long it counts, when its record goes.
      "strikes.notice_hours": [48, "default"],
      "strikes.live_days": [90, "default"],
      "strikes.keep_months": [12, "default"],
      // Travel: off until the owner switches it on (13.4), and a casual's time limit until they
      // choose their own (12G.1).
      "travel.enabled": [false, "default"],
      "travel.default_max_minutes": [45, "default"],
      // Staff photo (12F.2): how often it's renewed.
      "photo.renewal_months": [36, "default"],
    });
    expect(await readFirmSettings(urls.admin, "no-such-firm")).toEqual({ status: "no_firm" });
  });

  it("saves values the app would use, and logs the keys with their old and new values (settings, never personal data)", async () => {
    const f = await created();
    const result = await setFirmSettings(urls.admin, f.slug, [
      ["allocation_mode", "fair_rotation"],
      ["wave_size", "6"],
      ["urgent_window_hours", "12"],
      ["quiet_hours.start", "21:30"],
    ]);
    expect(result).toMatchObject({
      status: "saved",
      keys: ["allocation_mode", "wave_size", "urgent_window_hours", "quiet_hours.start"],
    });
    const { rows } = await su.query<{ settings: Record<string, unknown> }>(
      "select settings from firms where id = $1",
      [f.firmId],
    );
    // The end and the override are kept as the app read them (it reads quiet hours whole).
    expect(rows[0]?.settings).toEqual({
      allocation_mode: "fair_rotation",
      wave_size: 6,
      urgent_window_hours: 12,
      quiet_hours: { start: "21:30", end: "07:00", urgent_override: true },
    });
    const { rows: events } = await su.query(
      "select data from events where firm_id = $1 and action = 'firm.settings_changed'",
      [f.firmId],
    );
    expect(events).toEqual([
      {
        data: {
          keys: ["allocation_mode", "wave_size", "urgent_window_hours", "quiet_hours.start"],
          from: {
            allocation_mode: "first_come_first_served",
            wave_size: 4,
            urgent_window_hours: 24,
            "quiet_hours.start": "22:00",
          },
          to: {
            allocation_mode: "fair_rotation",
            wave_size: 6,
            urgent_window_hours: 12,
            "quiet_hours.start": "21:30",
          },
        },
      },
    ]);
    expect(await setFirmSettings(urls.admin, f.slug, [["wave_size", "6"]])).toEqual({
      status: "unchanged",
    });
  });

  it("refuses a value the app would ignore or fall back from; nothing is saved", async () => {
    const f = await created();
    for (const [key, value] of [
      ["allocation_mode", "random"],
      ["wave_size", "0"],
      ["wave_size", "4.5"],
      ["wave_minutes", "500"],
      ["urgent_window_hours", "500"],
      ["escalate_hours_before_start", "-1"],
      ["short_notice_threshold_hours", "0"],
      ["quiet_hours.start", "25:00"],
      ["quiet_hours.end", "7am"],
      ["quiet_hours.urgent_override", "maybe"],
      ["urgent_window_hours", ""],
    ] as const) {
      expect(await setFirmSettings(urls.admin, f.slug, [[key, value]]), `${key}=${value}`).toEqual({
        status: "bad",
        key,
      });
    }
    // One bad value among good ones: none are saved.
    expect(
      await setFirmSettings(urls.admin, f.slug, [
        ["urgent_window_hours", "6"],
        ["wave_size", "0"],
      ]),
    ).toEqual({ status: "bad", key: "wave_size" });
    const { rows } = await su.query("select settings from firms where id = $1", [f.firmId]);
    expect(rows[0]).toEqual({ settings: {} });
    expect(await setFirmSettings(urls.admin, "no-such-firm", [["wave_size", "5"]])).toEqual({
      status: "no_firm",
    });
  });
});

describe("the onboarding checklist from a firm's data", () => {
  const byItem = (items: ReadinessItem[]) =>
    Object.fromEntries(items.map((i) => [i.item, i.state]));

  it("a firm just created: what's done, what's left, what to confirm", async () => {
    const f = await created();
    const items = await withFirm(f.firmId, (tx) => firmReadiness(tx));
    expect(byItem(items)).toEqual({
      // Recorded with npm run firm:agreement (Gate B, audit L39): not yet, so it's still to do.
      "Agreement + DPA signed": "todo",
      "Firm branding and sign-off": "todo",
      "Office users": "done",
      "Rota source": "confirm",
      "Workers and credentials imported": "todo",
      "Credential rules for every role": "done",
      "Settings agreed": "confirm",
      "Shifts line (Twilio number) and WhatsApp display name": "todo",
      "Privacy notice line added by the firm": "confirm",
      "Staff briefing message sent with the portal link": "confirm",
      "Dry-run event day with the resourcer": "confirm",
      "Baseline numbers recorded": "todo",
    });
    const text = readinessText("Onboard Test Events", items);
    expect(text.split("\n")[0]).toBe(
      "Onboarding Onboard Test Events: 5 things to do, 5 to confirm yourself.",
    );
    expect(text).toContain("[ ] Firm branding and sign-off: Colour not set");
    expect(text).toContain("[x] Office users: 1 admin, 0 resourcers, 0 payroll users (active).");
    expect(text).toContain("urgent_window_hours 24 (default)");
    // Never a person's name or email.
    expect(text).not.toMatch(/Owner Person|owner\.person/);
  });

  it("follows the data: branding, workers and credentials, a role with no rule, the line, a baseline", async () => {
    const f = await created();
    await su.query("update firms set brand_primary_color = '#1d4ed8' where id = $1", [f.firmId]);
    // A drama-range line (Ofcom's fake numbers); lines are unique across firms, so try another if
    // a test firm already has it.
    for (let tries = 0; ; tries += 1) {
      // 900500-900999: away from the workers' 900301 and 900302 below, and from NO_FIRM_LINE
      // (900499).
      const line = `+447700900${500 + Math.floor(Math.random() * 500)}`;
      const ok = await su
        .query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line])
        .then(() => true)
        .catch((err: { code?: string }) => {
          if (err.code !== "23505" || tries > 20) throw err;
          return false;
        });
      if (ok) break;
    }
    const worker = async (role: string, mobile: string) => {
      const { rows } = await su.query<{ id: string }>(
        `insert into workers (firm_id, first_name, last_name, mobile_e164, roles)
         values ($1, 'Pat', 'Checker', $2, $3) returning id::text as id`,
        [f.firmId, mobile, [role]],
      );
      return rows[0]?.id ?? "";
    };
    const steward = await worker("steward", "+447700900301");
    await worker("forklift_driver", "+447700900302");
    await su.query(
      "insert into credentials (firm_id, worker_id, type) values ($1, $2, 'STEWARD_L2')",
      [f.firmId, steward],
    );
    // Baseline figures the admin entered (baseline figures always say who): one, then all 8.
    const baseline = (metrics: readonly string[]) =>
      su.query(
        `insert into metrics_daily (firm_id, day, kind, metric, value, recorded_by)
         select $1, '2026-10-05', 'baseline', m, 60, o.id from office_users o, unnest($2::text[]) m
          where o.firm_id = $1`,
        [f.firmId, metrics],
      );
    await baseline(["emails_per_day"]);
    const partial = await withFirm(f.firmId, (tx) => firmReadiness(tx));
    // One of the 8 isn't a baseline (audit L40): the pilot is compared against each.
    expect(byItem(partial)["Baseline numbers recorded"]).toBe("todo");
    expect(partial.find((i) => i.item === "Baseline numbers recorded")?.detail).toBe(
      "1 of 8 baseline figures saved. Still to enter: Calls per day; WhatsApp messages per day; Shift queries unanswered after 24 hours (%); Time to refill a cancellation (median, in minutes); No-shows per week; Resourcer hours on staff admin per week; Short-notice cancellations per week (firm and worker). The office's Pilot figures page, Baseline week.",
    );
    await baseline(BASELINE_KEYS.filter((k) => k !== "emails_per_day"));
    const items = await withFirm(f.firmId, (tx) => firmReadiness(tx));
    const states = byItem(items);
    expect(states["Firm branding and sign-off"]).toBe("done");
    expect(states["Workers and credentials imported"]).toBe("done");
    expect(states["Shifts line (Twilio number) and WhatsApp display name"]).toBe("confirm");
    expect(states["Baseline numbers recorded"]).toBe("done");
    // A role in use with no credential rule: the rules refuse its shifts to everyone.
    expect(states["Credential rules for every role"]).toBe("todo");
    const detail = (item: string) => items.find((i) => i.item === item)?.detail ?? "";
    expect(detail("Credential rules for every role")).toBe(
      "No rule for: forklift_driver. Shifts for a role with no rule are refused to everyone.",
    );
    expect(detail("Workers and credentials imported")).toContain(
      "2 active workers, 1 credential; 1 active worker has no credential on file.",
    );
    expect(readinessText("x", items)).not.toMatch(/Pat|Checker|\+447700900301|\+447700900302/);

    // A sign-off stored past firm:brand's check (a direct edit) that breaks golden rule 8 isn't
    // used in messages, and the checklist says so (audit L31).
    await su.query(
      "update firms set settings = jsonb_set(settings, '{sign_off}', to_jsonb('Sarah'::text)) where id = $1",
      [f.firmId],
    );
    const after = await withFirm(f.firmId, (tx) => firmReadiness(tx));
    expect(byItem(after)["Firm branding and sign-off"]).toBe("todo");
    expect(after.find((i) => i.item === "Firm branding and sign-off")?.detail).toContain(
      `isn't "… Shift Team", so it isn't used`,
    );
  });

  it("a rota sheet: connected and never synced, then failing, in plain words", async () => {
    const f = await created();
    const sheet = `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
    await connectSheet(urls.admin, f.slug, { spreadsheetId: sheet, replace: false });
    const rota = async () =>
      (await withFirm(f.firmId, (tx) => firmReadiness(tx))).find((i) => i.item === "Rota source");
    expect(await rota()).toEqual({
      item: "Rota source",
      state: "todo",
      detail: "Google Sheet added, never synced.",
    });
    await su.query(
      "update roster_sources set last_error_code = 'sheet_locale_not_uk' where firm_id = $1",
      [f.firmId],
    );
    expect((await rota())?.detail).toBe(
      "Google Sheet added, never synced (sheet_locale_not_uk): the sheet's locale isn't United Kingdom, so its dates could be read the wrong way round. In Google Sheets: File, Settings, Locale: United Kingdom, then Save settings. Then check the sheet's dates: ones typed before the change may have moved.",
    );
    await su.query(
      "update roster_sources set last_error_code = null, last_synced_at = '2026-10-04T09:00:00Z' where firm_id = $1",
      [f.firmId],
    );
    expect(await rota()).toEqual({
      item: "Rota source",
      state: "done",
      detail: "Google Sheet, last synced 2026-10-04T09:00:00.000Z.",
    });
  });

  it("counts only its own firm's data, and only roles on shifts that are still to come", async () => {
    const f = await created();
    const other = await created();
    await su.query(
      `insert into workers (firm_id, first_name, last_name, mobile_e164, roles)
       values ($1, 'Oth', 'Er', '+447700900311', '{crane_operator}')`,
      [other.firmId],
    );
    await addOfficeUser(withFirm, other.firmId, {
      email: "their.rota@example.com",
      name: "Their Rota",
      role: "resourcer",
    });
    // A cancelled shift, and one long over, for a role with no rule: not "in use".
    await su.query(
      `insert into shifts (firm_id, event_id, role, starts_at, ends_at, status)
       values ($1, $2, 'barista', now() + interval '1 day', now() + interval '1 day 8 hours', 'cancelled'),
              ($1, $2, 'barista', now() - interval '10 days', now() - interval '9 days 16 hours', 'filled')`,
      [f.firmId, await testEvent(su, f.firmId)],
    );
    const items = await withFirm(f.firmId, (tx) => firmReadiness(tx));
    const detail = (item: string) => items.find((i) => i.item === item)?.detail ?? "";
    expect(byItem(items)["Credential rules for every role"]).toBe("done");
    expect(detail("Workers and credentials imported")).toContain("0 active workers");
    expect(detail("Office users")).toBe("1 admin, 0 resourcers, 0 payroll users (active).");
  });
});
