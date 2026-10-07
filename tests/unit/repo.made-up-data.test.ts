import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Golden rule 7: development, tests, demos and docs use made-up data only. Every email address in
// src/, drizzle/, tests/, docs/ and the seed uses a reserved example domain (RFC 2606 and 6761),
// and every postcode in the approved mock-up is in the made-up ZZ area. An employer's name can't
// be tested for without writing it into the repo, so a person checked the mock-up for that once,
// when it was committed (10617f4).

const ROOT = process.cwd();
const MOCKUP = "docs/mockups/office-v2.html";

// local@label.….tld with a letters-only last label, so a version tag ("pg-boss@12.35.0") or an
// IP address after a password isn't an email address.
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g;
const RESERVED_LAST_LABELS = ["example", "test", "invalid", "localhost"];
const RESERVED_DOMAINS = ["example.com", "example.org"];

// A UK postcode as it's written, in capitals: the outward code, an optional space, the inward code.
const POSTCODE = /\b[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}\b/g;

// Reviewed: strings that only look like a person's email address. Each is split at the "@" so this
// file doesn't hold it whole. An entry that's no longer found fails, so the list stays short.
const ALLOWED = [
  {
    file: "tests/unit/sheets.google.test.ts",
    local: "shiftdesk-sync",
    domain: "example-project.iam.gserviceaccount.com",
    why: "a made-up Google service account, in the form Google's key files use",
  },
  {
    file: "tests/unit/sheets.transport.test.ts",
    local: "shiftdesk-sync",
    domain: "example-project.iam.gserviceaccount.com",
    why: "a made-up Google service account, in the form Google's key files use",
  },
].map((entry) => ({ ...entry, text: `${entry.local}@${entry.domain}` }));

function isReserved(domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    RESERVED_LAST_LABELS.includes(d.split(".").at(-1) ?? "") ||
    RESERVED_DOMAINS.some((r) => d === r || d.endsWith(`.${r}`))
  );
}

function emailsOutsideReserved(text: string): string[] {
  return [...text.matchAll(EMAIL)].filter((m) => !isReserved(m[1]!)).map((m) => m[0]);
}

function postcodesOutsideZz(text: string): string[] {
  return [...text.matchAll(POSTCODE)].map((m) => m[0]).filter((p) => !p.startsWith("ZZ"));
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(ROOT, path);

// The four folders, and the seed's entry points (its own modules are under src/).
const SCANNED = [
  ...["src", "drizzle", "tests", "docs"].flatMap((dir) => files(join(ROOT, dir))),
  ...readdirSync(join(ROOT, "scripts"))
    .filter((name) => /^seed.*\.ts$/.test(name))
    .map((name) => join(ROOT, "scripts", name)),
].filter((path) => !read(path).includes("\u0000"));

describe("made-up data only (golden rule 7)", () => {
  it("every email address in src/, drizzle/, tests/, docs/ and the seed uses a reserved domain", () => {
    expect(SCANNED.length).toBeGreaterThan(500);
    expect(SCANNED.map(rel)).toContain("scripts/seed.ts");
    expect(SCANNED.map(rel)).toContain(MOCKUP);
    const unexplained = SCANNED.flatMap((path) =>
      emailsOutsideReserved(read(path)).map((text) => `${rel(path)}: ${text}`),
    ).filter((found) => !ALLOWED.some((a) => found === `${a.file}: ${a.text}`));
    expect(unexplained).toEqual([]);
  });

  it("each allow-list entry is still needed", () => {
    for (const a of ALLOWED) {
      expect(emailsOutsideReserved(read(join(ROOT, a.file))), `${a.file} (${a.why})`).toContain(
        a.text,
      );
    }
  });

  it("every postcode in the mock-up is in the made-up ZZ area", () => {
    expect(postcodesOutsideZz(read(join(ROOT, MOCKUP)))).toEqual([]);
  });

  it("the mock-up's role switch says it's mock-up only", () => {
    const mockup = read(join(ROOT, MOCKUP));
    const button = /<button\b[^>]*\bdata-role-cycle\b[^>]*>/.exec(mockup)?.[0] ?? "";
    expect(button).toMatch(/aria-label="[^"]*mock-up only[^"]*"/);
    expect(button).toMatch(/title="[^"]*mock-up only[^"]*"/);
    expect(mockup).toMatch(/<span data-role-label>[^<]*mock-up only[^<]*<\/span>/);
    expect(mockup).toMatch(/textContent =\s*role \+ " \(mock-up only: tap to switch\)"/);
    expect(mockup).not.toMatch(/\(tap to switch\)/);
  });

  it("the checks themselves catch what they're meant to", () => {
    const real = ["jo.bloggs", "acme-events.co.uk"].join("@");
    expect(emailsOutsideReserved(`Write to ${real} or Ops@Example.COM.`)).toEqual([real]);
    expect(
      emailsOutsideReserved(
        "strikes@acme-events.example a@b.test x@y.invalid z@acme.localhost q@mail.example.org",
      ),
    ).toEqual([]);
    expect(emailsOutsideReserved("pg-boss@12.35.0 postgres://u:p@127.0.0.1:5432/db")).toEqual([]);
    expect(postcodesOutsideZz("SW1A 1AA, M1 1AE, ZZ99 3VZ and ZZ1 1ZZ")).toEqual([
      "SW1A 1AA",
      "M1 1AE",
    ]);
  });
});
