import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLE_PATTERN } from "@/lib/db/schema/roster";
import { ANY_SECTOR_TYPES, CREDENTIAL_PACKS, type Sector } from "@/lib/rules/packs";

// The credential packs are data copied from docs/rules-and-credentials.md ("Credential packs"):
// this test reads both of the doc's tables and fails if the code and the doc ever differ (every
// column but Notes and the formal Name), so the doc stays the one place a person reads them.

const SECTOR_OF_LABEL: Record<string, Sector | "any"> = {
  "Security/events": "security",
  Rail: "rail",
  "Construction/civils": "construction",
  "Cleaning/various": "cleaning",
  Any: "any",
};

const doc = readFileSync("docs/rules-and-credentials.md", "utf8");
const section = doc.slice(
  doc.indexOf("## Credential packs"),
  doc.indexOf("**Applied/in progress allowance:**"),
);

// The rows of the table whose header starts with `firstHeader`, as objects keyed by header.
function table(firstHeader: string): Record<string, string>[] {
  const lines = section.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`| ${firstHeader} |`));
  if (at < 0) throw new Error(`no table starting "${firstHeader}" in the doc`);
  const cells = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
  const headers = cells(lines[at] ?? "");
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith("|")) break;
    const values = cells(line);
    rows.push(Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
  }
  return rows;
}
const code = (cell: string) => cell.replace(/`/g, "").trim();

describe("credential packs match the doc", () => {
  it("types: sector, code, name shown to workers, 'applied may count' and typical validity", () => {
    const fromDoc = table("Sector").map((r) => {
      const sector = SECTOR_OF_LABEL[r.Sector ?? ""];
      if (!sector) throw new Error(`unknown sector label in the doc: ${r.Sector}`);
      return [
        sector,
        code(r["Type code"] ?? ""),
        r["Shown to workers as"],
        r["Applied may count"] === "yes",
        r["Typical validity (confirm per firm)"],
      ];
    });
    const fromCode = [
      ...Object.values(CREDENTIAL_PACKS).flatMap((p) =>
        p.types.map((t) => [
          p.sector,
          t.code,
          t.name,
          t.appliedAllowed ?? false,
          t.typicalValidity,
        ]),
      ),
      ...ANY_SECTOR_TYPES.map((t) => [
        "any",
        t.code,
        t.name,
        t.appliedAllowed ?? false,
        t.typicalValidity,
      ]),
    ];
    expect(fromDoc.length).toBe(16);
    const sort = (rows: unknown[][]) => rows.map((r) => JSON.stringify(r)).sort();
    expect(sort(fromCode)).toEqual(sort(fromDoc));
  });

  it("default role rules: pack, role and the types it needs", () => {
    const fromDoc = table("Pack").map((r) => [
      r.Pack,
      code(r.Role ?? ""),
      r.Needs === "none" ? [] : (r.Needs ?? "").split(",").map(code),
    ]);
    const fromCode = Object.values(CREDENTIAL_PACKS).flatMap((p) =>
      p.rules.map((rule) => [p.sector, rule.role, rule.requiredTypes]),
    );
    expect(fromDoc.length).toBe(11);
    const sort = (rows: unknown[][]) => rows.map((r) => JSON.stringify(r)).sort();
    expect(sort(fromCode)).toEqual(sort(fromDoc));
  });
});

describe("credential packs are well formed", () => {
  it("have every sector the firms table allows (security live; the others ready for when a firm needs them)", () => {
    expect(Object.keys(CREDENTIAL_PACKS).sort()).toEqual([
      "cleaning",
      "construction",
      "rail",
      "security",
    ]);
    for (const [sector, pack] of Object.entries(CREDENTIAL_PACKS)) expect(pack.sector).toBe(sector);
  });

  it("each role rule names only its own pack's types; roles are snake_case; each role appears once", () => {
    const roles = new Set<string>();
    for (const pack of Object.values(CREDENTIAL_PACKS)) {
      const codes = new Set(pack.types.map((t) => t.code));
      for (const rule of pack.rules) {
        expect(rule.role).toMatch(new RegExp(ROLE_PATTERN));
        expect(roles.has(rule.role)).toBe(false);
        roles.add(rule.role);
        for (const type of rule.requiredTypes) expect(codes.has(type)).toBe(true);
      }
    }
  });

  it("codes are unique and well formed; names fit the database", () => {
    const types = [...Object.values(CREDENTIAL_PACKS).flatMap((p) => p.types), ...ANY_SECTOR_TYPES];
    expect(new Set(types.map((t) => t.code)).size).toBe(types.length);
    for (const t of types) {
      expect(t.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(t.name.trim()).toBe(t.name);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.name.length).toBeLessThanOrEqual(100);
    }
  });

  it("security has CSAS and manual handling, and a CSAS officer needs CSAS (12B.3)", () => {
    const codes = CREDENTIAL_PACKS.security.types.map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(["CSAS", "MANUAL_HANDLING"]));
    // CSAS is the firm's own scheme's: never "applied" (an application in progress isn't one).
    const csas = CREDENTIAL_PACKS.security.types.find((t) => t.code === "CSAS");
    expect(csas?.appliedAllowed ?? false).toBe(false);
    expect(CREDENTIAL_PACKS.security.rules).toContainEqual({
      role: "csas_officer",
      requiredTypes: ["CSAS"],
    });
  });

  it("covers the demo firms' roles: Acme (security) and Northline (rail)", () => {
    const security = CREDENTIAL_PACKS.security.rules.map((r) => r.role);
    expect(security).toEqual(
      expect.arrayContaining(["steward", "door_supervisor", "security_officer"]),
    );
    const rail = CREDENTIAL_PACKS.rail.rules.map((r) => r.role);
    expect(rail).toEqual(expect.arrayContaining(["track_operative", "lookout"]));
  });
});

describe("types only the office records (12F.2)", () => {
  it("right to work, CSAS, and health or criminal record documents; migration 0043 marks the same", async () => {
    const { OFFICE_RECORDED_TYPES, casualMayUpload } = await import("@/lib/rules/packs");
    expect([...OFFICE_RECORDED_TYPES].sort()).toEqual(
      ["CSAS", "DBS", "RAIL_DA", "RAIL_MEDICAL", "RTW"].sort(),
    );
    const sql = readFileSync("drizzle/0043_office_recorded.sql", "utf8");
    const listed = /code IN \(([^)]+)\)/
      .exec(sql)?.[1]
      ?.match(/'([A-Z_]+)'/g)
      ?.map((c) => c.slice(1, -1));
    expect(listed?.sort()).toEqual([...OFFICE_RECORDED_TYPES].sort());
    expect(casualMayUpload("SIA_DS")).toBe(true);
    expect(casualMayUpload("A_FIRMS_OWN_TYPE")).toBe(true);
    expect(casualMayUpload("DBS")).toBe(false);
  });
});
