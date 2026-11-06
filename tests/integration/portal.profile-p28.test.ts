import type { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { purgeExpired } from "@/lib/gdpr/retention";
import { runImport } from "@/lib/imports/import";
import { readTable } from "@/lib/imports/table";
import { markNeedsSorted } from "@/lib/office/casual-follow-up";
import { worstNeed } from "@/lib/office/casuals";
import { myProfile } from "@/lib/portal/profile";
import { IN_HAND, meaning } from "@/lib/portal/qualification-copy";
import { bookShift } from "@/lib/roster/book";
import { rejectUpload } from "@/lib/uploads/check";
import { saveMyUpload } from "@/lib/uploads/save";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Profile, Phase 28 (28.11; docs/screens.md "### 28.11"), on the real database as the app role:
// "The office has this in hand." once the office marks her need sorted, which never lets her be
// booked until a checked record is in date (golden rule 6), and the number on her own records, read
// inside her firm only, never another firm's and never one the office records itself. NOW is
// Monday 2 November 2026, 09:00 London.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const clock = { now: () => NOW };
const casualCtx = (f: BookingFirm) => ({
  firm: { id: f.firmId, timezone: "Europe/London" },
  run: withFirm,
  clock,
});
const takeAsHer = (f: BookingFirm, workerId: string, shiftId: string) =>
  bookShift(
    withFirm,
    f.firmId,
    { shiftId, workerId, by: { type: "worker", id: workerId } },
    { clock },
  );
const numberOn = (workerId: string, type: string, number: string) =>
  su.query("update credentials set number = $3 where worker_id = $1 and type = $2", [
    workerId,
    type,
    number,
  ]);

describe("The office has this in hand (28.11)", () => {
  it("a need the office marked sorted reads 'The office has this in hand', and still blocks booking until a valid record exists", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    // Her SIA door supervisor licence ran out on 1 October.
    const zoe = await f.worker({
      first: "Zoe",
      roles: ["door_supervisor"],
      credentials: [{ type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" }],
    });
    const shift = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(48) });

    // Before: what to do is hers ("Upload the new one."), and she can't be booked.
    const before = await myProfile(casualCtx(f), zoe);
    const licence = before?.qualifications.find((q) => q.type === "SIA_DS");
    expect(licence).toMatchObject({ status: "expired", inHand: false });
    expect(licence && meaning(licence)).toBe(
      "Until it's renewed you won't see door supervisor shifts. Upload the new one.",
    );

    // The office marks it sorted (it has her renewed card in hand), as Casuals does.
    expect(
      await markNeedsSorted(
        { firm: { id: f.firmId }, officeUserId: resourcer, run: withFirm, clock },
        zoe,
        worstNeed,
      ),
    ).toEqual({ status: "sorted" });

    const after = await myProfile(casualCtx(f), zoe);
    const held = after?.qualifications.find((q) => q.type === "SIA_DS");
    expect(held).toMatchObject({ status: "expired", inHand: true });
    expect(held && meaning(held)).toBe(
      `Until it's renewed you won't see door supervisor shifts. ${IN_HAND}`,
    );
    // Words only: the rules engine still refuses her, the licence still expired.
    expect(await takeAsHer(f, zoe, shift)).toMatchObject({
      status: "not_eligible",
      codes: ["credential_expired"],
    });
    const { rows: none } = await su.query(
      "select 1 from assignments where shift_id = $1 and worker_id = $2 and status = 'confirmed'",
      [shift, zoe],
    );
    expect(none).toHaveLength(0);

    // The office records the renewal, checked and in date: in hand goes, and she can be booked.
    await su.query(
      `insert into credentials (firm_id, worker_id, type, status, expires_on)
       values ($1, $2, 'SIA_DS', 'valid', '2029-10-01')`,
      [f.firmId, zoe],
    );
    const renewed = await myProfile(casualCtx(f), zoe);
    expect(renewed?.qualifications.find((q) => q.type === "SIA_DS")).toMatchObject({
      status: "valid",
      inHand: false,
    });
    expect(await takeAsHer(f, zoe, shift)).toMatchObject({ status: "booked" });
  });

  it("a mark about something else, or made in another firm, never reads as in hand", async () => {
    const a = await bookingFirm(su, withFirm);
    const b = await bookingFirm(su, withFirm);
    const sam = await a.worker({
      roles: ["door_supervisor", "steward"],
      credentials: [{ type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" }],
    });
    // The office's latest mark was about her missing steward qualification, not the licence.
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'office', 'casual.needs_sorted', 'worker', $2, $3)`,
      [a.firmId, sam, JSON.stringify({ workerId: sam, type: "STEWARD_L2", status: "missing" })],
    );
    // A row in firm B naming her, about the licence: firm B's, so never read in hers.
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'office', 'casual.needs_sorted', 'worker', $2, $3)`,
      [b.firmId, sam, JSON.stringify({ workerId: sam, type: "SIA_DS", status: "expired" })],
    );
    const profile = await myProfile(casualCtx(a), sam);
    expect(profile?.qualifications.find((q) => q.type === "SIA_DS")).toMatchObject({
      status: "expired",
      inHand: false,
    });
    expect(profile?.qualifications.find((q) => q.type === "STEWARD_L2")).toMatchObject({
      status: "missing",
      inHand: true,
    });
  });

  // Found by the guardrails review: no date says when a suspension (or a missing record) began,
  // so only the log can tell a newer one from the one the office marked.
  it("a suspension lifted and imposed again after the mark is not in hand, until the office marks the new one", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const office = { firm: { id: f.firmId }, officeUserId: resourcer, run: withFirm, clock };
    const kit = await f.worker({
      first: "Kit",
      roles: ["door_supervisor"],
      credentials: [{ type: "SIA_DS", status: "suspended", expiresOn: "2029-01-01" }],
    });
    await su.query("update workers set external_ref = 'K1' where id = $1", [kit]);
    // The office's own file sets the licence's status (logged credential.updated each time).
    const fileSays = (status: string) =>
      withFirm(f.firmId, (tx) =>
        runImport(tx, {
          kind: "credentials",
          rows: readTable(new TextEncoder().encode(`Staff ID,Type,Status\nK1,SIA_DS,${status}`)),
          dryRun: false,
          actorId: resourcer,
          timeZone: "Europe/London",
          now: NOW,
        }),
      );
    const licence = async () =>
      (await myProfile(casualCtx(f), kit))?.qualifications.find((q) => q.type === "SIA_DS");

    expect(await markNeedsSorted(office, kit, worstNeed)).toEqual({ status: "sorted" });
    expect(await licence()).toMatchObject({ status: "suspended", inHand: true });

    // Lifted, then suspended again, with no mark in between: a newer suspension, not the one the
    // office marked, so she's told to message the office (a link to Messages).
    expect(await fileSays("valid")).toMatchObject({ updated: 1 });
    expect(await licence()).toMatchObject({ status: "valid", inHand: false });
    expect(await fileSays("suspended")).toMatchObject({ updated: 1 });
    const again = await licence();
    expect(again).toMatchObject({ status: "suspended", inHand: false });
    expect(again && meaning(again)).toBe(
      "You can't take door supervisor shifts. Message the office.",
    );

    // The office marks this one sorted: in hand again.
    expect(await markNeedsSorted(office, kit, worstNeed)).toEqual({ status: "sorted" });
    const marked = await licence();
    expect(marked).toMatchObject({ status: "suspended", inHand: true });
    expect(marked && meaning(marked)).toBe(`You can't take door supervisor shifts. ${IN_HAND}`);

    // Rows in firm B naming her, or her licence's record, after that mark: firm B's, so never
    // read in hers, and the mark still stands.
    const b = await bookingFirm(su, withFirm);
    const { rows: recs } = await su.query<{ id: string }>(
      "select id::text as id from credentials where worker_id = $1 and type = 'SIA_DS'",
      [kit],
    );
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'worker', 'upload.received', 'upload', gen_random_uuid(), $2),
              ($1, 'office', 'credential.updated', 'credential', $3, '{"type": "SIA_DS"}')`,
      [
        b.firmId,
        JSON.stringify({ workerId: kit, kind: "certificate", qualificationType: "SIA_DS" }),
        recs[0]?.id,
      ],
    );
    expect(await licence()).toMatchObject({ status: "suspended", inHand: true });
  });

  it("missing again after her own upload was turned down and purged is not in hand", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const office = { firm: { id: f.firmId }, officeUserId: resourcer, run: withFirm, clock };
    const lou = await f.worker({ first: "Lou", roles: ["steward"], credentials: [] });
    const steward = async () =>
      (await myProfile(casualCtx(f), lou))?.qualifications.find((q) => q.type === "STEWARD_L2");

    expect(await markNeedsSorted(office, lou, worstNeed)).toEqual({ status: "sorted" });
    expect(await steward()).toMatchObject({ status: "missing", inHand: true });

    // She sends one, the office turns it down, and the purge takes it 30 days on: missing again,
    // but her records of it changed after the mark (her upload, its check).
    const picture = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 90, b: 160 } },
    })
      .jpeg()
      .toBuffer();
    const sent = await saveMyUpload(
      { firm: { id: f.firmId }, run: withFirm, clock },
      lou,
      { kind: "certificate", type: "STEWARD_L2" },
      picture,
    );
    if (sent.status !== "sent") throw new Error(`not sent: ${sent.status}`);
    expect(await rejectUpload(office, sent.uploadId, "blurry")).toEqual({ status: "rejected" });
    expect(await steward()).toMatchObject({ status: "rejected", inHand: false });
    const DAY = 86_400_000;
    await withFirm(f.firmId, (tx) => purgeExpired(tx, new Date(NOW.getTime() + 40 * DAY)));
    expect(await steward()).toMatchObject({ status: "missing", inHand: false });
  });
});

describe("Her own record's number (28.11)", () => {
  it("shows for her own records only, never firm B's", async () => {
    const a = await bookingFirm(su, withFirm);
    const b = await bookingFirm(su, withFirm);
    const amy = await a.worker({ first: "Amy" });
    const bea = await b.worker({ first: "Bea" });
    await numberOn(amy, "SIA_DS", "1012 3456 7890 1111");
    await numberOn(bea, "SIA_DS", "2024 6810 1214 2222");

    const mine = await myProfile(casualCtx(a), amy);
    expect(mine?.qualifications.find((q) => q.type === "SIA_DS")?.number).toBe(
      "1012 3456 7890 1111",
    );
    expect(JSON.stringify(mine)).not.toContain(" 2222"); // even masked ("•••• 2222"); an id has no space
    // Firm B's casual can't be read from inside firm A at all.
    expect(await myProfile(casualCtx(a), bea)).toBeNull();
    // Inside her own firm, she sees her own.
    const hers = await myProfile(casualCtx(b), bea);
    expect(hers?.qualifications.find((q) => q.type === "SIA_DS")?.number).toBe(
      "2024 6810 1214 2222",
    );
    expect(JSON.stringify(hers)).not.toContain(" 1111"); // even masked; an id has no space
  });

  it("never for one the office records itself, nor one on file only for a shift's extra", async () => {
    const f = await bookingFirm(su, withFirm);
    const cas = await f.worker({
      first: "Cas",
      roles: ["csas_officer", "door_supervisor"],
      credentials: [
        { type: "CSAS", expiresOn: "2028-01-01" },
        { type: "SIA_DS", expiresOn: "2029-01-01" },
        { type: "FIRST_AID", expiresOn: "2028-01-01" },
      ],
    });
    await numberOn(cas, "CSAS", "CSAS-0042");
    await numberOn(cas, "SIA_DS", "1012 3456 7890 3333");
    await numberOn(cas, "FIRST_AID", "FA-0099");
    // A booked shift that needs first aid on top of its role: "Other qualifications on file".
    const shift = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(30) });
    await su.query("update shifts set required_credentials = '{FIRST_AID}' where id = $1", [shift]);
    await f.booking(cas, shift);

    const profile = await myProfile(casualCtx(f), cas);
    const byType = new Map(profile?.qualifications.map((q) => [q.type, q]));
    expect(byType.get("SIA_DS")?.number).toBe("1012 3456 7890 3333");
    expect(byType.get("CSAS")).toMatchObject({ uploadable: false, number: null });
    expect(profile?.others?.map((o) => o.type)).toEqual(["FIRST_AID"]);
    expect(profile?.others?.[0]?.number ?? null).toBeNull();
    const json = JSON.stringify(profile);
    expect(json).not.toContain("CSAS-0042");
    expect(json).not.toContain("FA-0099");
  });
});
