import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFirmIdLister } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { firmJobEnvelope, runFirmTask, type FirmTask } from "@/lib/jobs/firm-job";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import { SYNC_LEASE_MS } from "@/lib/roster/sheets/sync";
import { QUEUES } from "@/worker/jobs/queues";
import {
  runSheetsTick,
  SHEETS_SYNC_EXPIRE_SECONDS,
  SHEETS_SYNC_QUEUE,
  SHEETS_TICK_CRON,
  SHEETS_TICK_QUEUE,
  sheetsSyncTask,
} from "@/lib/roster/sheets/jobs";
import { registerJobs } from "@/worker/jobs";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";
import { FakeSheets, SHIFT_HEADER, STAFF_HEADER } from "../helpers/fake-sheets";

// The Sheets jobs: the once-a-minute tick that queues a sync for each firm that is due (every
// minute on event days, every 15 otherwise), the sync job itself, and the worker's wiring.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const NOW = new Date("2026-11-06T09:00:00Z");
const at = (d: Date) => ({ now: () => d });
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function firm(opts: {
  source?: "enabled" | "disabled";
  lastSyncedAt?: Date;
  shiftInHours?: number;
  failing?: { code: string; triedAt: Date };
}) {
  const slug = uniqueSlug("j");
  const { rows } = await su.query<{ id: string }>(
    "insert into firms (name, slug, sector) values ($1, $2, 'rail') returning id::text as id",
    [`Jobs Test ${slug}`, slug],
  );
  const firmId = rows[0]?.id ?? "";
  const sheetId = `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
  if (opts.source) {
    await su.query(
      `insert into roster_sources
         (firm_id, kind, enabled, spreadsheet_id, mapping, last_synced_at, last_error_code, last_attempted_at)
       values ($1, 'sheets', $2, $3, $4, $5, $6, $7)`,
      [
        firmId,
        opts.source === "enabled",
        sheetId,
        JSON.stringify(DEFAULT_SHEET_MAPPING),
        opts.lastSyncedAt ?? null,
        opts.failing?.code ?? null,
        opts.failing?.triedAt ?? null,
      ],
    );
  }
  if (opts.shiftInHours !== undefined) {
    const start = new Date(NOW.getTime() + opts.shiftInHours * 3_600_000);
    await su.query(
      "insert into shifts (firm_id, role, starts_at, ends_at) values ($1, 'steward', $2, $3)",
      [firmId, start, new Date(start.getTime() + 8 * 3_600_000)],
    );
  }
  return { firmId, sheetId };
}

const queuedFor = async (firmId: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [SHEETS_SYNC_QUEUE, firmId],
    )
  ).rows.map((r) => r.data);

describe("sheets-sync-tick", () => {
  it("queues one sync for each firm that is due, and none for the rest", async () => {
    const neverSynced = await firm({ source: "enabled" });
    const quiet = await firm({ source: "enabled", lastSyncedAt: minutesAgo(5) });
    const quietButStale = await firm({ source: "enabled", lastSyncedAt: minutesAgo(20) });
    const eventDay = await firm({
      source: "enabled",
      lastSyncedAt: minutesAgo(1),
      shiftInHours: 3,
    });
    const eventDayJustSynced = await firm({
      source: "enabled",
      lastSyncedAt: minutesAgo(0.25),
      shiftInHours: 3,
    });
    const farShift = await firm({
      source: "enabled",
      lastSyncedAt: minutesAgo(5),
      shiftInHours: 30,
    });
    const native = await firm({});
    const disabled = await firm({ source: "disabled" });

    const tick = () =>
      runSheetsTick({ listFirmIds: createFirmIdLister(app), run: withFirm, clock: at(NOW) });
    const { queued } = await tick();
    expect(queued).toBeGreaterThanOrEqual(3);

    for (const due of [neverSynced, quietButStale, eventDay]) {
      const jobs = await queuedFor(due.firmId);
      expect(jobs).toEqual([
        { firmId: due.firmId, idempotencyKey: `sheets-sync:${Math.floor(NOW.getTime() / 60_000)}` },
      ]);
    }
    for (const notDue of [quiet, eventDayJustSynced, farShift, native, disabled]) {
      expect(await queuedFor(notDue.firmId)).toEqual([]);
    }

    // A second tick in the same minute queues nothing new for a firm already queued.
    await tick();
    expect(await queuedFor(neverSynced.firmId)).toHaveLength(1);
  });

  it("backs off while a firm's syncs are failing", async () => {
    const tooSoon = await firm({
      source: "enabled",
      shiftInHours: 3,
      failing: { code: "sheet_not_shared", triedAt: minutesAgo(2) },
    });
    const retry = await firm({
      source: "enabled",
      shiftInHours: 3,
      failing: { code: "sheet_not_shared", triedAt: minutesAgo(6) },
    });
    await runSheetsTick({ listFirmIds: createFirmIdLister(app), run: withFirm, clock: at(NOW) });
    expect(await queuedFor(tooSoon.firmId)).toEqual([]);
    expect(await queuedFor(retry.firmId)).toHaveLength(1);
  });

  it("lists firms through app_firm_ids(): ids only, for every firm", async () => {
    const a = await firm({});
    const ids = await createFirmIdLister(app)();
    expect(ids).toContain(a.firmId);
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    const { rows } = await su.query("select count(*)::int as n from firms");
    expect(ids).toHaveLength(rows[0]?.n);
  });
});

describe("sheets-sync (a firm task)", () => {
  it("runs one firm's sync and completes with its outcome (ids and counts only)", async () => {
    const f = await firm({ source: "enabled" });
    const fake = new FakeSheets();
    fake.create(f.sheetId, { Staff: [STAFF_HEADER], Shifts: [SHIFT_HEADER] });
    const result = await runFirmTask(
      sheetsSyncTask(fake, at(NOW)),
      { id: "job-1", data: { firmId: f.firmId, idempotencyKey: "sheets-sync:1" } },
      withFirm,
    );
    expect(result).toMatchObject({
      id: "job-1",
      status: "completed",
      output: { status: "synced", staff: 0, shifts: 0 },
    });
    expect(fake.reads).toBe(1);
  });

  it("dead-letters a bad payload, and never lets a task use another firm", async () => {
    const task = sheetsSyncTask(new FakeSheets(), at(NOW));
    const bad = await runFirmTask(task, { id: "job-2", data: { firmId: "nope" } }, withFirm);
    expect(bad).toMatchObject({ status: "deadletter", output: { error: "invalid_payload" } });

    const a = await firm({});
    const b = await firm({});
    const sneaky: FirmTask<{ firmId: string; idempotencyKey: string }> = {
      queue: "test",
      schema: firmJobEnvelope,
      task: (_payload, run) => run(b.firmId, async () => "ran"),
    };
    const result = await runFirmTask(
      sneaky,
      { id: "job-3", data: { firmId: a.firmId, idempotencyKey: "k" } },
      withFirm,
    );
    expect(result).toEqual({
      id: "job-3",
      status: "failed",
      output: { error: "handler_failed", code: "Error" },
    });
  });
});

describe("worker wiring", () => {
  it("pg-boss gives up on a sync before its lease runs out, so two never overlap", () => {
    expect(SHEETS_SYNC_EXPIRE_SECONDS * 1000).toBeLessThan(SYNC_LEASE_MS);
    const queue = QUEUES.find((q) => q.name === SHEETS_SYNC_QUEUE);
    expect(queue?.options).toMatchObject({
      policy: "standard",
      expireInSeconds: SHEETS_SYNC_EXPIRE_SECONDS,
    });
  });

  // A stand-in that records calls, so this test never starts a real cron that could sync other
  // tests' firms.
  function recordingBoss() {
    const calls: string[] = [];
    const boss = {
      createQueue: async () => undefined,
      work: async (name: string) => {
        calls.push(`work ${name}`);
        return "worker-id";
      },
      schedule: async (name: string, cron: string) => {
        calls.push(`schedule ${name} ${cron}`);
      },
      unschedule: async (name: string) => {
        calls.push(`unschedule ${name}`);
      },
    };
    return { boss: boss as unknown as PgBoss, calls };
  }

  it("with a Sheets client: works both queues and schedules the tick every minute", async () => {
    const { boss, calls } = recordingBoss();
    await registerJobs(boss, { sheets: new FakeSheets() });
    expect(calls).toEqual(
      expect.arrayContaining([
        `work ${SHEETS_SYNC_QUEUE}`,
        `work ${SHEETS_TICK_QUEUE}`,
        `schedule ${SHEETS_TICK_QUEUE} ${SHEETS_TICK_CRON}`,
      ]),
    );
    expect(SHEETS_TICK_CRON).toBe("* * * * *");
  });

  it("without one (SHEETS_TRANSPORT=none): no Sheets workers, and the tick is unscheduled", async () => {
    const { boss, calls } = recordingBoss();
    await registerJobs(boss);
    expect(calls).toContain(`unschedule ${SHEETS_TICK_QUEUE}`);
    expect(calls.filter((c) => c.includes("sheets"))).toEqual([`unschedule ${SHEETS_TICK_QUEUE}`]);
  });
});
