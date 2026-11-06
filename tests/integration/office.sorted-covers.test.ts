import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { remindCasuals } from "@/lib/office/casual-follow-up";
import { casualsList } from "@/lib/office/casuals";
import { bookingFirm, NOW, type CredentialCells } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Phase 29.3: the office's "Sorted by" and "Remind all" count a "Mark as sorted" only while it
// covers the casual's problem as it stands (markCovers, the casual's own "in hand" rule,
// src/lib/portal/in-hand.ts). On the real database as the app role. NOW is Monday 2 November
// 2026, 09:00. The marks are written straight into the log with the day they were made, so the
// dates are fixed (the app writes them at the wall clock's time).

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

const clock = { now: () => NOW };
const lapsed = [
  { type: "STEWARD_L2", expiresOn: null },
  { type: "SIA_DS", expiresOn: "2026-10-28" },
];

async function firm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const ctx = { firm: { id: f.firmId }, officeUserId: resourcer, run: withFirm, clock };
  return { f, resourcer, ctx };
}

// The office's "Mark as sorted", as markNeedsSorted logs it, made at `at`.
async function markSorted(
  firmId: string,
  officeUserId: string,
  workerId: string,
  at: string,
  need = { type: "SIA_DS", status: "expired" },
) {
  await su.query(
    `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data, created_at)
     values ($1, 'office', $2, 'casual.needs_sorted', 'worker', $3, $4, $5)`,
    [firmId, officeUserId, workerId, JSON.stringify({ workerId, ...need }), at],
  );
}

const rowOf = async (ctx: Awaited<ReturnType<typeof firm>>["ctx"], id: string) =>
  (await casualsList(ctx, "needs"))?.rows.find((r) => r.id === id);

describe("Sorted by and Remind all: only while the mark covers the problem as it stands", () => {
  it("sorted after the licence expired: stays sorted, out of Remind all, left alone by Remind", async () => {
    const { f, resourcer, ctx } = await firm();
    const kim = await f.worker({ first: "Kim", credentials: lapsed });
    await markSorted(f.firmId, resourcer, kim, "2026-10-30T10:00:00Z");
    expect((await rowOf(ctx, kim))?.sorted).toMatchObject({ by: "Office Person" });
    expect((await casualsList(ctx, "needs"))?.remindAll).toEqual([]);
    expect(await remindCasuals(ctx, [kim])).toMatchObject({ reminded: 0, sorted: 1 });
  });

  it("sorted, then the licence expires again (a newer date): needs action and is in Remind all", async () => {
    const { f, resourcer, ctx } = await firm();
    const kim = await f.worker({ first: "Kim", credentials: lapsed });
    await markSorted(f.firmId, resourcer, kim, "2026-10-30T10:00:00Z");
    expect((await rowOf(ctx, kim))?.sorted).not.toBeNull();
    // Renewed, and that one lapsed on 31 Oct, after the mark: the same type and status, but a
    // newer problem than the one the office marked.
    await su.query(
      "update credentials set expires_on = '2026-10-31' where worker_id = $1 and type = 'SIA_DS'",
      [kim],
    );
    const row = await rowOf(ctx, kim);
    expect(row?.needs[0]?.qualification).toMatchObject({ type: "SIA_DS", status: "expired" });
    expect(row?.sorted).toBeNull();
    expect((await casualsList(ctx, "needs"))?.remindAll).toEqual([kim]);
    expect(await remindCasuals(ctx, [kim])).toMatchObject({ reminded: 1, sorted: 0 });
  });

  it("a record of that type added after the mark ends it, even with the same dates", async () => {
    const { f, resourcer, ctx } = await firm();
    const lou = await f.worker({ first: "Lou", credentials: lapsed });
    await markSorted(f.firmId, resourcer, lou, "2026-10-30T10:00:00Z");
    expect((await rowOf(ctx, lou))?.sorted).not.toBeNull();
    const {
      rows: [cred],
    } = await su.query<{ id: string }>(
      "select id from credentials where worker_id = $1 and type = 'SIA_DS'",
      [lou],
    );
    await su.query(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data)
       values ($1, 'office', $2, 'credential.updated', 'credential', $3, $4)`,
      [f.firmId, resourcer, cred?.id, JSON.stringify({ workerId: lou, type: "SIA_DS" })],
    );
    expect((await rowOf(ctx, lou))?.sorted).toBeNull();
    expect((await casualsList(ctx, "needs"))?.remindAll).toEqual([lou]);
  });

  it("a mark about another type, or made before the licence expired, covers nothing", async () => {
    const { f, resourcer, ctx } = await firm();
    const ana = await f.worker({ first: "Ana", credentials: lapsed });
    const ben = await f.worker({ first: "Ben", credentials: lapsed });
    await markSorted(f.firmId, resourcer, ana, "2026-10-30T10:00:00Z", {
      type: "STEWARD_L2",
      status: "expired",
    });
    // Marked on 20 Oct about an earlier lapse of the same kind: not this one (expired 28 Oct).
    await markSorted(f.firmId, resourcer, ben, "2026-10-20T10:00:00Z");
    expect((await rowOf(ctx, ana))?.sorted).toBeNull();
    expect((await rowOf(ctx, ben))?.sorted).toBeNull();
    expect([...((await casualsList(ctx, "needs"))?.remindAll ?? [])].sort()).toEqual(
      [ana, ben].sort(),
    );
  });

  it("the worst need and the one to remind about differ: the list and Remind agree on sorted", async () => {
    const { f, resourcer, ctx } = await firm();
    // Worst: a suspended steward qualification (no date, so nothing to remind about). The one to
    // remind about: the SIA licence that expired on 28 Oct.
    const split: CredentialCells[] = [
      { type: "STEWARD_L2", status: "suspended", expiresOn: null },
      { type: "SIA_DS", expiresOn: "2026-10-28" },
    ];
    const ana = await f.worker({ first: "Ana", credentials: split });
    const ben = await f.worker({ first: "Ben", credentials: split });
    // Ana's mark is about the SIA licence: not her worst need, so not sorted.
    await markSorted(f.firmId, resourcer, ana, "2026-10-30T10:00:00Z");
    // Ben's mark is about his worst need, the suspension: sorted.
    await markSorted(f.firmId, resourcer, ben, "2026-10-30T10:00:00Z", {
      type: "STEWARD_L2",
      status: "suspended",
    });
    const list = await casualsList(ctx, "needs");
    const anaRow = list?.rows.find((r) => r.id === ana);
    expect(anaRow?.needs[0]?.qualification).toMatchObject({ type: "STEWARD_L2" });
    expect(anaRow?.remindAbout).toBe("SIA_DS");
    expect(anaRow?.sorted).toBeNull();
    expect(list?.rows.find((r) => r.id === ben)?.sorted).not.toBeNull();
    expect(list?.remindAll).toEqual([ana]);
    // Remind does what the list says: Ana reminded, Ben left alone as sorted.
    expect(await remindCasuals(ctx, [ana])).toMatchObject({ reminded: 1, sorted: 0 });
    expect(await remindCasuals(ctx, [ben])).toMatchObject({ reminded: 0, sorted: 1 });
  });

  it("another firm's marks never count", async () => {
    const { f, ctx } = await firm();
    const other = await bookingFirm(su, withFirm);
    const theirs = await other.office("resourcer");
    const kim = await f.worker({ first: "Kim", credentials: lapsed });
    // A mark logged under the other firm, naming this firm's casual.
    await markSorted(other.firmId, theirs, kim, "2026-10-30T10:00:00Z");
    expect((await rowOf(ctx, kim))?.sorted).toBeNull();
    expect((await casualsList(ctx, "needs"))?.remindAll).toEqual([kim]);
    expect(await remindCasuals(ctx, [kim])).toMatchObject({ reminded: 1, sorted: 0 });
  });
});
