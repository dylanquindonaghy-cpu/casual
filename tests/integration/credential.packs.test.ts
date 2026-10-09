import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyCredentialPack } from "@/lib/credentials/apply-pack";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";

// Applying a credential pack to a firm, on the real database as the app role.

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

async function newFirm(sector = "security"): Promise<string> {
  const slug = uniqueSlug("c");
  const { rows } = await su.query<{ id: string }>(
    "insert into firms (name, slug, sector) values ($1, $2, $3) returning id::text as id",
    [`Pack Test ${slug}`, slug, sector],
  );
  return rows[0]?.id ?? "";
}

const apply = (firmId: string, sector: "security" | "rail") =>
  withFirm(firmId, (tx) => applyCredentialPack(tx, sector, { type: "system" }));

const typesOf = async (firmId: string) =>
  (
    await su.query(
      "select code, name, sector, applied_allowed from credential_types where firm_id = $1 order by code",
      [firmId],
    )
  ).rows;
const rulesOf = async (firmId: string) =>
  (
    await su.query(
      "select sector, role, required_types from credential_rules where firm_id = $1 order by role",
      [firmId],
    )
  ).rows;
const packEvents = async (firmId: string) =>
  (
    await su.query(
      "select data from events where firm_id = $1 and action = 'credential_pack.applied' order by id",
      [firmId],
    )
  ).rows.map((r) => r.data);

describe("applyCredentialPack", () => {
  it("gives a security firm the security types (plus right to work) and role rules, and logs it", async () => {
    const firmId = await newFirm();
    expect(await apply(firmId, "security")).toEqual({ typesAdded: 8, rulesAdded: 5 });
    expect(await typesOf(firmId)).toEqual([
      { code: "CSAS", name: "CSAS accreditation", sector: "security", applied_allowed: false },
      {
        code: "FIRST_AID",
        name: "first aid at work certificate",
        sector: "security",
        applied_allowed: false,
      },
      {
        code: "MANUAL_HANDLING",
        name: "manual handling certificate",
        sector: "security",
        applied_allowed: false,
      },
      { code: "RTW", name: "right to work check", sector: "any", applied_allowed: false },
      {
        code: "SIA_CP",
        name: "SIA close protection licence",
        sector: "security",
        applied_allowed: true,
      },
      {
        code: "SIA_DS",
        name: "SIA door supervisor licence",
        sector: "security",
        applied_allowed: true,
      },
      {
        code: "SIA_SG",
        name: "SIA security guard licence",
        sector: "security",
        applied_allowed: true,
      },
      {
        code: "STEWARD_L2",
        name: "Level 2 spectator safety qualification",
        sector: "security",
        applied_allowed: false,
      },
    ]);
    expect(await rulesOf(firmId)).toEqual([
      { sector: "security", role: "close_protection_officer", required_types: ["SIA_CP"] },
      { sector: "security", role: "csas_officer", required_types: ["CSAS"] },
      { sector: "security", role: "door_supervisor", required_types: ["SIA_DS"] },
      { sector: "security", role: "security_officer", required_types: ["SIA_SG"] },
      { sector: "security", role: "steward", required_types: ["STEWARD_L2"] },
    ]);
    const [event] = await packEvents(firmId);
    expect(event).toMatchObject({ sector: "security", typesAdded: 8, rulesAdded: 5 });
    expect(event.types).toEqual(
      expect.arrayContaining([
        { code: "SIA_DS", appliedAllowed: true },
        { code: "STEWARD_L2", appliedAllowed: false },
        { code: "RTW", appliedAllowed: false },
      ]),
    );
    expect(event.types).toHaveLength(8);
    expect(event.rules).toEqual(
      expect.arrayContaining([{ role: "door_supervisor", requiredTypes: ["SIA_DS"] }]),
    );
    expect(event.rules).toHaveLength(5);
  });

  it("applying it again adds nothing, logs nothing, and never overwrites the firm's own edits", async () => {
    const firmId = await newFirm();
    await apply(firmId, "security");
    await su.query(
      "update credential_types set name = 'SIA DS badge' where firm_id = $1 and code = 'SIA_DS'",
      [firmId],
    );
    await su.query(
      "update credential_rules set required_types = '{SIA_DS,FIRST_AID}' where firm_id = $1 and role = 'door_supervisor'",
      [firmId],
    );
    expect(await apply(firmId, "security")).toEqual({ typesAdded: 0, rulesAdded: 0 });
    expect(await packEvents(firmId)).toHaveLength(1);
    const types = await typesOf(firmId);
    expect(types.find((t) => t.code === "SIA_DS")?.name).toBe("SIA DS badge");
    const rules = await rulesOf(firmId);
    expect(rules.find((r) => r.role === "door_supervisor")?.required_types).toEqual([
      "SIA_DS",
      "FIRST_AID",
    ]);
  });

  it("a firm working in two sectors can take both packs; right to work isn't added twice", async () => {
    const firmId = await newFirm();
    await apply(firmId, "security");
    expect(await apply(firmId, "rail")).toEqual({ typesAdded: 4, rulesAdded: 2 });
    const types = await typesOf(firmId);
    expect(types.filter((t) => t.code === "RTW")).toHaveLength(1);
    expect(types.filter((t) => t.sector === "rail").map((t) => t.code)).toEqual([
      "PTS",
      "RAIL_DA",
      "RAIL_MEDICAL",
      "SENTINEL",
    ]);
    expect((await rulesOf(firmId)).filter((r) => r.sector === "rail").map((r) => r.role)).toEqual([
      "lookout",
      "track_operative",
    ]);
  });

  it("stays inside the firm: another firm gets nothing", async () => {
    const a = await newFirm();
    const b = await newFirm();
    await apply(a, "security");
    expect(await typesOf(b)).toEqual([]);
    expect(await rulesOf(b)).toEqual([]);
  });
});
