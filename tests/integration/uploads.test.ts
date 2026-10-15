import type { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { collectFirmData } from "@/lib/gdpr/firm-export";
import { purgeExpired } from "@/lib/gdpr/retention";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import { exportWorkerData } from "@/lib/gdpr/worker-export";
import { casualsList, uploadsToCheck } from "@/lib/office/casuals";
import { workerAccessView } from "@/lib/office/worker-access";
import { myProfile } from "@/lib/portal/profile";
import { bookShift } from "@/lib/roster/book";
import { approveUpload, recordCsas, rejectUpload } from "@/lib/uploads/check";
import { casualFile, officeFile } from "@/lib/uploads/files";
import { saveMyUpload } from "@/lib/uploads/save";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Photos and certificate images on the real database, as the app role (12F.2; docs/office-v2.md
// 3.7, 4.6, 5.5; S6, S7, D3): a casual sends one, the office approves or rejects it, and only
// checked, in-date records count in the rules; who may see each image; Uploads to check; the
// staff photo; the retention purge; erasure and the exports. NOW is Monday 2 November 2026, 09:00
// London.

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
const DAY = 86_400_000;
const picture = (width = 400, height = 300) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 160 } } })
    .jpeg()
    .toBuffer();

async function uploadsFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const casual = { firm: { id: f.firmId }, run: withFirm, clock };
  const office = (officeUserId = resourcer) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock,
  });
  const send = async (
    workerId: string,
    target: { kind: "photo" } | { kind: "certificate"; type: string },
  ) => {
    const r = await saveMyUpload(casual, workerId, target, await picture());
    if (r.status !== "sent") throw new Error(`not sent: ${r.status}`);
    return r.uploadId;
  };
  const row = async (table: string, id: string) =>
    (await su.query(`select * from ${table} where id = $1`, [id])).rows[0] as
      Record<string, unknown> | undefined;
  const eventsOf = async (action: string) =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        "select data from events where firm_id = $1 and action = $2 order by id",
        [f.firmId, action],
      )
    ).rows.map((r) => r.data);
  const book = (shiftId: string, workerId: string) =>
    bookShift(
      withFirm,
      f.firmId,
      { shiftId, workerId, by: { type: "worker", id: workerId } },
      {
        clock,
      },
    );
  return { f, resourcer, casual, office, send, row, eventsOf, book };
}

describe("a casual's certificate counts only once the office approves it", () => {
  it("waiting, then approved with the date and number a person read; the rules follow", async () => {
    const t = await uploadsFirm();
    const ann = await t.f.worker({ first: "Ann", roles: ["door_supervisor"], credentials: [] });
    const shift = await t.f.shift({ role: "door_supervisor", startsAt: hoursFromNow(48) });
    const uploadId = await t.send(ann, { kind: "certificate", type: "SIA_DS" });

    // Stored as a JPEG the server made, with its fingerprint; and a waiting record that counts
    // for nothing.
    const stored = await t.row("uploads", uploadId);
    expect(stored).toMatchObject({
      kind: "certificate",
      credential_type: "SIA_DS",
      content_type: "image/jpeg",
      status: "waiting",
      uploaded_by: "casual",
      checked_by: null,
    });
    expect((stored?.data as Buffer).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(stored?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const { rows: records } = await su.query(
      "select status, check_state, evidence_upload_id::text as upload from credentials where worker_id = $1",
      [ann],
    );
    expect(records).toEqual([{ status: "expired", check_state: "waiting", upload: uploadId }]);
    expect(await t.eventsOf("upload.received")).toEqual([
      { workerId: ann, kind: "certificate", qualificationType: "SIA_DS" },
    ]);

    // The rules ignore it, and her Profile says it's being checked.
    expect(await t.book(shift, ann)).toMatchObject({
      status: "not_eligible",
      codes: ["credential_missing"],
    });
    const before = await myProfile(
      { ...t.casual, firm: { id: t.f.firmId, timezone: "Europe/London" } },
      ann,
    );
    expect(before?.qualifications.map((q) => [q.type, q.status])).toEqual([
      ["SIA_DS", "being_checked"],
    ]);

    // Approved: the office's own record from now on.
    expect(
      await approveUpload(t.office(), uploadId, {
        expiresOn: "2029-05-01",
        noExpiry: false,
        number: " 1234 5678 ",
      }),
    ).toEqual({ status: "approved" });
    const { rows: after } = await su.query(
      `select status, check_state, expires_on::text as expires_on, number, verified_by::text as by,
              verified_at is not null as verified
         from credentials where worker_id = $1`,
      [ann],
    );
    expect(after).toEqual([
      {
        status: "valid",
        check_state: "verified",
        expires_on: "2029-05-01",
        number: "1234 5678",
        by: t.resourcer,
        verified: true,
      },
    ]);
    expect(await t.row("uploads", uploadId)).toMatchObject({
      status: "approved",
      checked_by: t.resourcer,
    });
    expect(await t.eventsOf("upload.approved")).toEqual([
      { workerId: ann, kind: "certificate", qualificationType: "SIA_DS", expiresOn: "2029-05-01" },
    ]);
    expect(await t.book(shift, ann)).toMatchObject({ status: "booked" });
    // Checked once: a second click finds it done.
    expect(
      await approveUpload(t.office(), uploadId, {
        expiresOn: "2029-05-01",
        noExpiry: false,
        number: "",
      }),
    ).toEqual({ status: "not_waiting" });
  });

  it("turned down: Not accepted with the reason, and never counted", async () => {
    const t = await uploadsFirm();
    const ben = await t.f.worker({ first: "Ben", roles: ["door_supervisor"], credentials: [] });
    const shift = await t.f.shift({ role: "door_supervisor" });
    const uploadId = await t.send(ben, { kind: "certificate", type: "SIA_DS" });
    expect(await rejectUpload(t.office(), uploadId, "blurry")).toEqual({ status: "rejected" });
    expect(await t.row("uploads", uploadId)).toMatchObject({
      status: "rejected",
      reject_reason: "blurry",
      checked_by: t.resourcer,
    });
    const { rows } = await su.query(
      "select status, check_state, rejected_reason from credentials where worker_id = $1",
      [ben],
    );
    expect(rows).toEqual([
      { status: "expired", check_state: "rejected", rejected_reason: "blurry" },
    ]);
    expect(await t.eventsOf("upload.rejected")).toEqual([
      { workerId: ben, kind: "certificate", qualificationType: "SIA_DS", reason: "blurry" },
    ]);
    expect(await t.book(shift, ben)).toMatchObject({ status: "not_eligible" });
    const profile = await myProfile(
      { ...t.casual, firm: { id: t.f.firmId, timezone: "Europe/London" } },
      ben,
    );
    expect(profile?.qualifications[0]).toMatchObject({
      status: "rejected",
      rejected: { uploadId, reason: "blurry" },
    });
  });

  it("an unchecked record can never be stored as valid (the database refuses it)", async () => {
    const t = await uploadsFirm();
    const cy = await t.f.worker({ first: "Cy", roles: ["door_supervisor"], credentials: [] });
    await t.send(cy, { kind: "certificate", type: "SIA_DS" });
    await expect(
      su.query(
        "update credentials set status = 'valid', expires_on = '2030-01-01' where worker_id = $1",
        [cy],
      ),
    ).rejects.toThrow(/credentials_unchecked_never_valid/);
  });

  it("a renewal sent while hers is still in date: the old one counts until the new one is approved", async () => {
    const t = await uploadsFirm();
    const di = await t.f.worker({
      first: "Di",
      roles: ["door_supervisor"],
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-20" }],
    });
    const renewal = await t.send(di, { kind: "certificate", type: "SIA_DS" });
    const view = await workerAccessView(t.office(), di);
    expect(view?.qualifications[0]).toMatchObject({
      status: "expiring_soon",
      renewing: true,
      waiting: { uploadId: renewal },
    });
    expect(view?.needs).toEqual([]); // renewing: nothing for her to sort out
    // A shift after it expires: the waiting one doesn't count yet.
    const late = await t.f.shift({ role: "door_supervisor", startsAt: hoursFromNow(24 * 20) });
    expect(await t.book(late, di)).toMatchObject({ status: "not_eligible" });
    await approveUpload(t.office(), renewal, {
      expiresOn: "2029-11-20",
      noExpiry: false,
      number: "",
    });
    expect(await t.book(late, di)).toMatchObject({ status: "booked" });
  });

  it("refuses a date already gone, a bad or missing date, and anyone but an active admin or resourcer", async () => {
    const t = await uploadsFirm();
    const ed = await t.f.worker({ first: "Ed", roles: ["door_supervisor"], credentials: [] });
    const id = await t.send(ed, { kind: "certificate", type: "SIA_DS" });
    expect(
      await approveUpload(t.office(), id, { expiresOn: "2026-11-01", noExpiry: false, number: "" }),
    ).toEqual({
      status: "date_passed",
    });
    expect(
      await approveUpload(t.office(), id, { expiresOn: "2026-02-30", noExpiry: false, number: "" }),
    ).toEqual({
      status: "invalid",
    });
    expect(
      await approveUpload(t.office(await t.f.office("payroll")), id, {
        expiresOn: "",
        noExpiry: false,
        number: "",
      }),
    ).toEqual({ status: "not_allowed" });
    expect(
      await rejectUpload(t.office(await t.f.office("resourcer", "disabled")), id, "other"),
    ).toEqual({ status: "not_allowed" });
    // No date: refused unless the person ticks that the card has none (a forgotten date must never
    // make a licence count for ever). More than 10 years ahead is a typo.
    expect(
      await approveUpload(t.office(), id, { expiresOn: "", noExpiry: false, number: "" }),
    ).toEqual({ status: "date_needed" });
    expect(
      await approveUpload(t.office(), id, { expiresOn: "2207-01-01", noExpiry: false, number: "" }),
    ).toEqual({ status: "invalid" });
    // A date and "no expiry date" both: refused, never guessed.
    expect(
      await approveUpload(t.office(), id, { expiresOn: "2028-01-01", noExpiry: true, number: "" }),
    ).toEqual({ status: "invalid" });
    expect(await t.row("uploads", id)).toMatchObject({ status: "waiting" });
    // An admin may; ticked as having no expiry date, it doesn't expire.
    expect(
      await approveUpload(t.office(await t.f.office("admin")), id, {
        expiresOn: "",
        noExpiry: true,
        number: "",
      }),
    ).toEqual({ status: "approved" });
    expect(
      (await su.query("select expires_on from credentials where worker_id = $1", [ed])).rows,
    ).toEqual([{ expires_on: null }]);
  });
});

describe("what a casual may send", () => {
  it("only the types her roles need, never one the office records (CSAS), and only while active", async () => {
    const t = await uploadsFirm();
    const fi = await t.f.worker({
      first: "Fi",
      roles: ["steward", "csas_officer"],
      credentials: [],
    });
    const send = async (type: string) =>
      (await saveMyUpload(t.casual, fi, { kind: "certificate", type }, await picture())).status;
    expect(await send("SIA_DS")).toBe("not_needed"); // not a door supervisor
    expect(await send("CSAS")).toBe("not_needed"); // the office records it
    expect(await send("RTW")).toBe("not_needed");
    expect(await send("drop table")).toBe("not_needed");
    expect(await send("STEWARD_L2")).toBe("sent");
    await su.query("update workers set status = 'inactive' where id = $1", [fi]);
    expect(await send("STEWARD_L2")).toBe("not_active");
    expect(await su.query("select 1 from uploads where worker_id = $1", [fi])).toMatchObject({
      rowCount: 1,
    });
  });

  it("a file that isn't a picture, or is too big, saves nothing", async () => {
    const t = await uploadsFirm();
    const gu = await t.f.worker({ first: "Gu" });
    const save = (bytes: Uint8Array) => saveMyUpload(t.casual, gu, { kind: "photo" }, bytes);
    expect(await save(Buffer.from("<html>not a picture</html>"))).toEqual({
      status: "not_an_image",
    });
    expect(await save(Buffer.alloc(2_000_000, 0xff))).toEqual({ status: "too_big" });
    expect(await save(new Uint8Array())).toEqual({ status: "empty" });
    expect((await su.query("select 1 from uploads where worker_id = $1", [gu])).rowCount).toBe(0);
  });

  it("a new one replaces her own waiting one (and its record); never one already checked", async () => {
    const t = await uploadsFirm();
    const hal = await t.f.worker({ first: "Hal", roles: ["door_supervisor"], credentials: [] });
    const first = await t.send(hal, { kind: "certificate", type: "SIA_DS" });
    const second = await t.send(hal, { kind: "certificate", type: "SIA_DS" });
    expect(await t.row("uploads", first)).toBeUndefined();
    const { rows } = await su.query(
      "select check_state, evidence_upload_id::text as upload from credentials where worker_id = $1",
      [hal],
    );
    expect(rows).toEqual([{ check_state: "waiting", upload: second }]);
    expect((await t.eventsOf("upload.received")).at(-1)).toMatchObject({ replaced: true });
    // Photos: an approved one stays when a new one is sent.
    const photo = await t.send(hal, { kind: "photo" });
    await approveUpload(t.office(), photo, { expiresOn: "", noExpiry: false, number: "" });
    const next = await t.send(hal, { kind: "photo" });
    expect(await t.row("uploads", photo)).toMatchObject({ status: "approved" });
    const view = await workerAccessView(t.office(), hal);
    expect(view?.photo).toMatchObject({
      status: "waiting",
      current: { id: photo, uploadedOn: "2026-11-02", renewBy: "2029-11-02" },
      waiting: { id: next },
    });
  });
});

describe("a resend while the office checks the one waiting", () => {
  it("never deletes one the office just approved (her row is locked first by both)", async () => {
    const t = await uploadsFirm();
    const vi = await t.f.worker({ first: "Vi" });
    for (let round = 0; round < 6; round += 1) {
      const waiting = await t.send(vi, { kind: "photo" });
      const bytes = await picture();
      const [checked, resent] = await Promise.all([
        approveUpload(t.office(), waiting, { expiresOn: "", noExpiry: false, number: "" }),
        saveMyUpload(t.casual, vi, { kind: "photo" }, bytes),
      ]);
      expect(resent.status).toBe("sent");
      if (checked.status === "approved") {
        // Approved first: it stays, and the resend waits beside it.
        expect(await t.row("uploads", waiting)).toMatchObject({ status: "approved" });
      } else {
        // The resend first: it replaced the waiting one, so there was nothing left to approve.
        expect(checked).toEqual({ status: "not_waiting" });
        expect(await t.row("uploads", waiting)).toBeUndefined();
      }
    }
    // Every approval logged is of a photo that's still there.
    const { rows } = await su.query<{ id: string }>(
      `select e.entity_id::text as id from events e
        where e.firm_id = $1 and e.action = 'upload.approved'
          and not exists (select 1 from uploads u where u.id = e.entity_id)`,
      [t.f.firmId],
    );
    expect(rows).toEqual([]);
  });
});

describe("nothing waits for ever, and the firm's own word on what the office records", () => {
  it("one sent for a type her roles no longer need can still be checked on her page", async () => {
    const t = await uploadsFirm();
    const wyn = await t.f.worker({ first: "Wyn", roles: ["door_supervisor"], credentials: [] });
    const card = await t.send(wyn, { kind: "certificate", type: "SIA_DS" });
    await su.query("update workers set roles = '{steward}' where id = $1", [wyn]);
    const page = await workerAccessView(t.office(), wyn);
    expect(page?.qualifications.map((q) => q.type)).toEqual(["STEWARD_L2"]);
    expect(page?.waitingUploads).toEqual([
      {
        id: card,
        kind: "certificate",
        type: "SIA_DS",
        name: "SIA door supervisor licence",
        sentAt: NOW,
      },
    ]);
    expect(await rejectUpload(t.office(), card, "other")).toEqual({ status: "rejected" });
    expect((await workerAccessView(t.office(), wyn))?.waitingUploads).toEqual([]);
  });

  it("a type the firm marks as recorded by the office can't be uploaded, as the packs' list can't", async () => {
    const t = await uploadsFirm();
    const xan = await t.f.worker({ first: "Xan", roles: ["steward"], credentials: [] });
    await su.query(
      "update credential_types set office_recorded = true where firm_id = $1 and code = 'STEWARD_L2'",
      [t.f.firmId],
    );
    expect(
      (
        await saveMyUpload(
          t.casual,
          xan,
          { kind: "certificate", type: "STEWARD_L2" },
          await picture(),
        )
      ).status,
    ).toBe("not_needed");
    const profile = await myProfile(
      { ...t.casual, firm: { id: t.f.firmId, timezone: "Europe/London" } },
      xan,
    );
    expect(profile?.qualifications[0]).toMatchObject({ type: "STEWARD_L2", uploadable: false });
    // The packs mark their own for every new firm.
    const { rows } = await su.query<{ code: string }>(
      "select code from credential_types where firm_id = $1 and office_recorded order by code",
      [t.f.firmId],
    );
    expect(rows.map((r) => r.code)).toEqual(["CSAS", "RTW", "STEWARD_L2"]);
  });
});

describe("CSAS: recorded by the office only, under the firm's own scheme", () => {
  it("not without confirming the scheme; then the office's own record", async () => {
    const t = await uploadsFirm();
    const ida = await t.f.worker({ first: "Ida", roles: ["csas_officer"], credentials: [] });
    const input = { expiresOn: "2028-01-31", noExpiry: false, number: "CS-1", ownScheme: false };
    expect(await recordCsas(t.office(), ida, input)).toEqual({ status: "not_confirmed" });
    expect(
      await recordCsas(t.office(await t.f.office("payroll")), ida, { ...input, ownScheme: true }),
    ).toEqual({ status: "not_allowed" });
    expect(await recordCsas(t.office(), ida, { ...input, ownScheme: true })).toEqual({
      status: "recorded",
    });
    const { rows } = await su.query(
      `select type, status, check_state, expires_on::text as expires_on, verified_by::text as by
         from credentials where worker_id = $1`,
      [ida],
    );
    expect(rows).toEqual([
      {
        type: "CSAS",
        status: "valid",
        check_state: "verified",
        expires_on: "2028-01-31",
        by: t.resourcer,
      },
    ]);
    expect(await t.eventsOf("credential.added")).toEqual([
      { workerId: ida, type: "CSAS", via: "office", ownScheme: true },
    ]);
  });
});

describe("who may see an image (/files)", () => {
  it("the casual's own, and her firm's active admins and resourcers; nobody else", async () => {
    const t = await uploadsFirm();
    const other = await uploadsFirm();
    const jo = await t.f.worker({ first: "Jo" });
    const kay = await t.f.worker({ first: "Kay" });
    const id = await t.send(jo, { kind: "photo" });
    expect(await casualFile(t.casual, jo, id)).toMatchObject({
      status: "ok",
      contentType: "image/jpeg",
      kind: "photo",
    });
    expect(await casualFile(t.casual, kay, id)).toEqual({ status: "not_found" });
    expect(await officeFile(t.office(), id)).toMatchObject({ status: "ok" });
    expect(await officeFile(t.office(await t.f.office("admin")), id)).toMatchObject({
      status: "ok",
    });
    expect(await officeFile(t.office(await t.f.office("payroll")), id)).toEqual({
      status: "not_found",
    });
    expect(await officeFile(t.office(await t.f.office("resourcer", "disabled")), id)).toEqual({
      status: "not_found",
    });
    // Another firm's office, even knowing the id, and even naming this firm.
    expect(await officeFile(other.office(), id)).toEqual({ status: "not_found" });
    expect(await officeFile({ ...other.office(), firm: { id: t.f.firmId } }, id)).toEqual({
      status: "not_found",
    });
    expect(await casualFile(other.casual, jo, id)).toEqual({ status: "not_found" });
    expect(await officeFile(t.office(), "not-an-id")).toEqual({ status: "not_found" });
  });
});

describe("the office's Casuals pages", () => {
  it("Uploads to check: every waiting one, oldest first, with the menu's count; checked ones leave it", async () => {
    const t = await uploadsFirm();
    const lu = await t.f.worker({ first: "Lu", roles: ["door_supervisor"], credentials: [] });
    const mo = await t.f.worker({ first: "Mo" });
    const newer = await t.send(lu, { kind: "certificate", type: "SIA_DS" });
    const older = await t.send(mo, { kind: "photo" });
    await su.query("update uploads set created_at = $2 where id = $1", [older, hoursFromNow(-30)]);
    const list = await casualsList(t.office(), "uploads");
    expect(list?.counts.uploads).toBe(2);
    expect(list?.uploads.map((u) => [u.id, u.kind, u.qualificationType, u.name])).toEqual([
      [older, "photo", null, "Mo Booker"],
      [newer, "certificate", "SIA_DS", "Lu Booker"],
    ]);
    expect(list?.uploads[1]?.qualificationName).toBe("SIA door supervisor licence");
    expect(await uploadsToCheck(t.office())).toBe(2);
    expect(await uploadsToCheck(t.office(await t.f.office("payroll")))).toBeNull();
    await rejectUpload(t.office(), older, "wrong_document");
    expect(await uploadsToCheck(t.office())).toBe(1);
    expect((await casualsList(t.office(), "all"))?.counts.uploads).toBe(1);
  });

  it("the Staff photo column: the current photo's upload date and its status", async () => {
    const t = await uploadsFirm();
    const ned = await t.f.worker({ first: "Ned" });
    const ola = await t.f.worker({ first: "Ola" });
    const photo = await t.send(ned, { kind: "photo" });
    await approveUpload(t.office(), photo, { expiresOn: "", noExpiry: false, number: "" });
    // Uploaded 3 Aug 2024 (London): renew by 3 Aug 2027.
    await su.query("update uploads set created_at = '2024-08-03T10:00:00Z' where id = $1", [photo]);
    const rows = (await casualsList(t.office(), "all"))?.rows ?? [];
    expect(rows.find((r) => r.id === ned)?.photo).toEqual({
      status: "up_to_date",
      current: { id: photo, uploadedOn: "2024-08-03", renewBy: "2027-08-03" },
      waiting: null,
    });
    expect(rows.find((r) => r.id === ola)?.photo).toEqual({
      status: "missing",
      current: null,
      waiting: null,
    });
    // The firm's own renewal setting.
    await su.query(
      `update firms set settings = settings || '{"photo": {"renewal_months": 24}}' where id = $1`,
      [t.f.firmId],
    );
    const later = (await casualsList(t.office(), "all"))?.rows.find((r) => r.id === ned);
    expect(later?.photo).toMatchObject({ status: "overdue", current: { renewBy: "2026-08-03" } });
  });
});

describe("the retention purge (none during a hold)", () => {
  it("turned down: gone 30 days after the check, with its record; replaced photos 30 days after the new one", async () => {
    const t = await uploadsFirm();
    const pat = await t.f.worker({ first: "Pat", roles: ["door_supervisor"], credentials: [] });
    const rejectedOld = await t.send(pat, { kind: "certificate", type: "SIA_DS" });
    await rejectUpload(t.office(), rejectedOld, "blurry");
    const oldPhoto = await t.send(pat, { kind: "photo" });
    await approveUpload(t.office(), oldPhoto, { expiresOn: "", noExpiry: false, number: "" });
    const newPhoto = await t.send(pat, { kind: "photo" });
    await approveUpload(t.office(), newPhoto, { expiresOn: "", noExpiry: false, number: "" });
    await su.query("update uploads set created_at = created_at - interval '1 hour' where id = $1", [
      oldPhoto,
    ]);
    const waiting = await t.send(pat, { kind: "photo" });
    const purge = (days: number) =>
      withFirm(t.f.firmId, (tx) => purgeExpired(tx, new Date(NOW.getTime() + days * DAY)));

    // 29 days on: nothing yet.
    expect((await purge(29)).uploads).toBe(0);
    // 31 days on: the turned-down one and its "Not accepted" record, and the replaced photo.
    expect((await purge(31)).uploads).toBe(2);
    expect(await t.row("uploads", rejectedOld)).toBeUndefined();
    expect(await t.row("uploads", oldPhoto)).toBeUndefined();
    expect(await t.row("uploads", newPhoto)).toMatchObject({ status: "approved" });
    expect(await t.row("uploads", waiting)).toMatchObject({ status: "waiting" });
    expect((await su.query("select 1 from credentials where worker_id = $1", [pat])).rowCount).toBe(
      0,
    );
    expect((await purge(400)).uploads).toBe(0); // the current photo and a waiting one stay
  });

  it("a hold keeps them all", async () => {
    const t = await uploadsFirm();
    const quin = await t.f.worker({ first: "Quin" });
    const id = await t.send(quin, { kind: "photo" });
    await rejectUpload(t.office(), id, "other");
    await su.query(
      `update firms set settings = settings || '{"retention": {"hold_until": "2027-12-31"}}' where id = $1`,
      [t.f.firmId],
    );
    expect(
      (await withFirm(t.f.firmId, (tx) => purgeExpired(tx, new Date(NOW.getTime() + 40 * DAY))))
        .uploads,
    ).toBe(0);
    expect(await t.row("uploads", id)).toMatchObject({ status: "rejected" });
  });
});

describe("erasure and the exports", () => {
  it("the casual's export and the firm's carry each upload's details only, never the image; erasure deletes them", async () => {
    const t = await uploadsFirm();
    const admin = await t.f.office("admin");
    const ray = await t.f.worker({ first: "Ray", roles: ["door_supervisor"], credentials: [] });
    const photo = await t.send(ray, { kind: "photo" });
    const card = await t.send(ray, { kind: "certificate", type: "SIA_DS" });
    const { rows: hashes } = await su.query<{ id: string; sha256: string }>(
      "select id::text as id, sha256 from uploads where worker_id = $1",
      [ray],
    );

    const exported = await exportWorkerData(t.office(admin), ray, "json");
    if (exported.status !== "ok") throw new Error(exported.status);
    const data = JSON.parse(exported.body) as {
      sections: Record<string, Record<string, unknown>[]>;
    };
    const images = data.sections.images ?? [];
    expect(images.map((i) => i.id).sort()).toEqual([photo, card].sort());
    for (const image of images) {
      expect(Object.keys(image).sort()).toEqual(
        [
          "checkedAt",
          "checkedBy",
          "contentType",
          "createdAt",
          "credentialType",
          "id",
          "kind",
          "rejectReason",
          "sha256",
          "size",
          "status",
          "uploadedBy",
        ].sort(),
      );
      expect(image.sha256).toBe(hashes.find((h) => h.id === image.id)?.sha256);
    }
    // No bytes anywhere in the file (a Buffer turns into {"type": "Buffer", "data": [...]}).
    expect(exported.body).not.toContain('"Buffer"');

    const firm = await withFirm(t.f.firmId, (tx) => collectFirmData(tx, NOW));
    const firmImages = firm.tables.uploads ?? [];
    expect(firmImages.length).toBeGreaterThanOrEqual(2);
    for (const image of firmImages) expect(image).not.toHaveProperty("data");
    const anyBytes = Object.values(firm.tables).some((rows) =>
      rows.some((r) => Object.values(r).some((v) => Buffer.isBuffer(v))),
    );
    expect(anyBytes).toBe(false);
    expect(JSON.stringify(firm)).not.toContain('"Buffer"');

    expect(await eraseWorker(t.office(admin), ray)).toMatchObject({
      status: "erased",
      counts: { licences: 1, images: 2 },
    });
    expect((await su.query("select 1 from uploads where worker_id = $1", [ray])).rowCount).toBe(0);
  });
});
