import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recreateDatabase } from "@/lib/db/admin/bootstrap";
import { MIGRATIONS_FOLDER } from "@/lib/db/admin/migrate";
import { withDatabase } from "@/lib/db/admin/urls";
import { automaticEventKey, automaticEventName } from "@/lib/roster/shift-events";
import { localDateOf } from "@/lib/time/zoned";
import { urls } from "../helpers/db";

// Migration 0035's backfill (12B.1): on a database at 0034 with shifts in it, every shift joins
// an automatic event for its site and its start's firm-local date, with the same name and key
// the app makes for new rows (src/lib/roster/shift-events.ts). The test database starts empty, so
// this builds its own: migrated to 0034, filled as the superuser, RLS forced as on a live
// database (the owner is bound by it, so the migration must set each firm in turn), then migrated
// to now. A last test-only migration, in the same transaction, proves 0035 cleared the firm it set.

const SCRATCH = `${urls.name.replace(/_test$/, "")}_backfill_test`;
const scratch = (url: string) => withDatabase(url, SCRATCH);
const LONG_SITE = `Very long site ${"x".repeat(185)}`; // 200 characters

interface Journal {
  entries: { idx: number; tag: string }[];
}

// The migrations folder with only the entries up to `lastIdx`, plus extra test-only SQL after.
function migrationsUpTo(lastIdx: number, extra: { tag: string; sql: string }[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "shiftdesk-migrations-"));
  mkdirSync(join(dir, "meta"));
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  ) as Journal & Record<string, unknown>;
  const kept = journal.entries.filter((e) => e.idx <= lastIdx);
  for (const e of kept)
    copyFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  const last = kept.at(-1) as Journal["entries"][number] & Record<string, unknown>;
  const added = extra.map((x, i) => {
    writeFileSync(join(dir, `${x.tag}.sql`), x.sql);
    return { ...last, idx: last.idx + 1 + i, tag: x.tag, when: Number(last.when) + 1 + i };
  });
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: [...kept, ...added] }),
  );
  return dir;
}

let su: Pool;
const folders: string[] = [];

interface FirmRow {
  id: string;
  timezone: string;
}
let london: FirmRow;
let newYork: FirmRow;
const site: Record<string, string> = {};
const shift: Record<string, { firmId: string; siteId: string | null; startsAt: Date }> = {};

beforeAll(async () => {
  await recreateDatabase(urls.superuser, SCRATCH, urls.owner);
  const before = migrationsUpTo(34);
  folders.push(before);
  const owner = new Pool({ connectionString: scratch(urls.admin), max: 1 });
  try {
    await migrate(drizzle(owner), { migrationsFolder: before });
  } finally {
    await owner.end();
  }

  su = new Pool({ connectionString: scratch(urls.superuser), max: 2 });
  const id = async (text: string, values: unknown[]) => {
    const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
    if (!rows[0]) throw new Error(`no id: ${text}`);
    return rows[0].id;
  };
  const firm = async (slug: string, timezone: string) => ({
    id: await id(
      "insert into firms (name, slug, sector, timezone) values ($1, $2, 'security', $3)",
      [`Backfill ${slug}`, slug, timezone],
    ),
    timezone,
  });
  london = await firm("backfill-ldn", "Europe/London");
  newYork = await firm("backfill-ny", "America/New_York");
  await firm("backfill-none", "Europe/London"); // a firm with no shifts: nothing to do
  const addSite = async (key: string, firmId: string, name: string) => {
    site[key] = await id("insert into sites (firm_id, name) values ($1, $2)", [firmId, name]);
  };
  await addSite("arena", london.id, "Acme Demo Arena");
  await addSite("racecourse", london.id, "Acme Demo Racecourse");
  await addSite("long", london.id, LONG_SITE);
  await addSite("nyArena", newYork.id, "Acme Demo Arena");

  // created_at decides each event's source (its earliest shift's).
  let created = Date.parse("2026-09-01T00:00:00Z");
  const addShift = async (
    key: string,
    f: FirmRow,
    siteKey: string | null,
    startsAt: string,
    source: "native" | "sheets" | "csv" = "native",
  ) => {
    const start = new Date(startsAt);
    created += 60_000;
    await su.query(
      `insert into shifts (firm_id, site_id, role, starts_at, ends_at, source, external_ref, created_at)
       values ($1, $2, 'steward', $3, $4, $5, $6, $7)`,
      [
        f.id,
        siteKey ? site[siteKey] : null,
        start,
        new Date(start.getTime() + 8 * 3_600_000),
        source,
        source === "native" ? null : `row-${key}`,
        new Date(created),
      ],
    );
    shift[key] = {
      firmId: f.id,
      siteId: siteKey ? (site[siteKey] ?? null) : null,
      startsAt: start,
    };
  };
  // Saturday 10 October 2026 (British Summer Time, UTC+1).
  await addShift("arenaDay", london, "arena", "2026-10-10T08:00:00Z"); // 09:00
  await addShift("arenaSheet", london, "arena", "2026-10-10T16:00:00Z", "sheets"); // mixed source
  await addShift("arenaNight", london, "arena", "2026-10-10T22:00:00Z"); // 23:00, ends Sunday
  await addShift("arenaAfterMidnight", london, "arena", "2026-10-10T23:30:00Z"); // 00:30 Sun 11
  await addShift("racecourse", london, "racecourse", "2026-10-10T09:00:00Z", "csv");
  await addShift("noSite", london, null, "2026-10-10T10:00:00Z");
  await addShift("long", london, "long", "2026-10-12T08:00:00Z");
  // The night the clocks go back (02:00 BST to 01:00 GMT on Sunday 25 October): 00:30 UTC is
  // 01:30 BST, Sunday.
  await addShift("clocksBack", london, "racecourse", "2026-10-25T00:30:00Z");
  // New York: 02:00 UTC on the 10th is 22:00 on Friday 9 October there.
  await addShift("nyArena", newYork, "nyArena", "2026-10-10T02:00:00Z");
  await addShift("nyNoSite", newYork, null, "2026-10-10T14:00:00Z"); // same key as London's

  // As on a live database (db:migrate forces RLS after every run): the owner is bound too.
  const { rows: tables } = await su.query<{ name: string }>(
    "select relname as name from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
  );
  for (const t of tables) {
    await su.query(`alter table public."${t.name}" force row level security`);
  }

  const after = migrationsUpTo(Number.MAX_SAFE_INTEGER, [
    {
      tag: "9999_test_firm_cleared",
      sql: `DO $$ BEGIN
  IF coalesce(current_setting('app.current_firm_id', true), '') <> '' THEN
    RAISE EXCEPTION 'migration 0035 left app.current_firm_id set';
  END IF;
END $$;`,
    },
  ]);
  folders.push(after);
  const owner2 = new Pool({ connectionString: scratch(urls.admin), max: 1 });
  try {
    await migrate(drizzle(owner2), { migrationsFolder: after });
  } finally {
    await owner2.end();
  }
}, 120_000);

afterAll(async () => {
  await su?.end();
  for (const dir of folders) rmSync(dir, { recursive: true, force: true });
  const c = new Client({ connectionString: withDatabase(urls.superuser, "postgres") });
  await c.connect();
  try {
    await c.query(`drop database if exists ${c.escapeIdentifier(SCRATCH)} with (force)`);
  } finally {
    await c.end();
  }
});

const tzOf = (firmId: string) => (firmId === london.id ? london : newYork).timezone;
const expectedKey = (key: string) => {
  const s = shift[key];
  if (!s) throw new Error(key);
  return automaticEventKey(s.siteId, localDateOf(s.startsAt, tzOf(s.firmId)));
};

describe("migration 0035: every existing shift joins its site and day's automatic event", () => {
  it("leaves no shift without an event, and no event across firms", async () => {
    const { rows } = await su.query<{ missing: number; crossed: number; shifts: number }>(
      `select count(*) filter (where s.event_id is null)::int as missing,
              count(*) filter (where e.firm_id <> s.firm_id)::int as crossed,
              count(*)::int as shifts
         from shifts s left join shift_events e on e.id = s.event_id`,
    );
    expect(rows[0]).toEqual({ missing: 0, crossed: 0, shifts: Object.keys(shift).length });
  });

  it("groups by site and firm-local start date: night shifts stay on the day they start", async () => {
    const eventOf = async (key: string) => {
      const s = shift[key];
      const { rows: r } = await su.query<{ event: string; ref: string }>(
        `select e.id::text as event, e.planner_ref as ref from shifts s
           join shift_events e on e.id = s.event_id
          where s.firm_id = $1 and s.starts_at = $2 and s.site_id is not distinct from $3`,
        [s?.firmId, s?.startsAt, s?.siteId ?? null],
      );
      return r[0];
    };
    const day = await eventOf("arenaDay");
    expect((await eventOf("arenaSheet"))?.event).toBe(day?.event);
    expect((await eventOf("arenaNight"))?.event).toBe(day?.event); // 23:00 Saturday
    expect((await eventOf("arenaAfterMidnight"))?.event).not.toBe(day?.event); // 00:30 Sunday
    for (const key of Object.keys(shift)) expect((await eventOf(key))?.ref).toBe(expectedKey(key));
  });

  it("names and keys each event as the app does, its source the earliest shift's", async () => {
    const { rows } = await su.query<{
      firm: string;
      name: string;
      key: string;
      site: string | null;
      source: string;
      showing: boolean;
      shifts: number;
    }>(
      `select e.firm_id::text as firm, e.name, e.planner_ref as key, e.site_id::text as site,
              e.source, e.showing_to_casuals as showing,
              (select count(*)::int from shifts s where s.event_id = e.id) as shifts
         from shift_events e order by e.firm_id, e.planner_ref`,
    );
    const expected = [
      {
        firm: london.id,
        name: "Acme Demo Arena · Sat 10 Oct",
        site: "arena",
        source: "native",
        shifts: 3,
        shiftKey: "arenaDay",
      },
      {
        firm: london.id,
        name: "Acme Demo Arena · Sun 11 Oct",
        site: "arena",
        source: "native",
        shifts: 1,
        shiftKey: "arenaAfterMidnight",
      },
      {
        firm: london.id,
        name: "Acme Demo Racecourse · Sat 10 Oct",
        site: "racecourse",
        source: "csv",
        shifts: 1,
        shiftKey: "racecourse",
      },
      {
        firm: london.id,
        name: "Acme Demo Racecourse · Sun 25 Oct",
        site: "racecourse",
        source: "native",
        shifts: 1,
        shiftKey: "clocksBack",
      },
      {
        firm: london.id,
        name: automaticEventName(LONG_SITE, "2026-10-12"),
        site: "long",
        source: "native",
        shifts: 1,
        shiftKey: "long",
      },
      {
        firm: london.id,
        name: "Sat 10 Oct",
        site: null,
        source: "native",
        shifts: 1,
        shiftKey: "noSite",
      },
      {
        firm: newYork.id,
        name: "Acme Demo Arena · Fri 9 Oct",
        site: "nyArena",
        source: "native",
        shifts: 1,
        shiftKey: "nyArena",
      },
      {
        firm: newYork.id,
        name: "Sat 10 Oct",
        site: null,
        source: "native",
        shifts: 1,
        shiftKey: "nyNoSite",
      },
    ].map((e) => ({
      firm: e.firm,
      name: e.name,
      key: expectedKey(e.shiftKey),
      site: e.site ? (site[e.site] ?? null) : null,
      source: e.source,
      showing: true,
      shifts: e.shifts,
    }));
    const sort = <T extends { firm: string; key: string }>(list: T[]) =>
      [...list].sort((a, b) => `${a.firm}${a.key}`.localeCompare(`${b.firm}${b.key}`));
    expect(sort(rows)).toEqual(sort(expected));
    // The long name is cut to fit 200 characters, its date kept.
    const long = rows.find((r) => r.site === site.long);
    expect([...(long?.name ?? "")].length).toBe(200);
    expect(long?.name.endsWith(" · Mon 12 Oct")).toBe(true);
  });
});
