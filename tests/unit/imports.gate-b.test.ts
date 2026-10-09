import { describe, expect, it } from "vitest";
import { gateBCheck } from "../../scripts/import-gate-b";

// Gate B at the import command: real data goes into a live database only once the operator says
// the firm's agreement and DPA are signed, by repeating its slug.

const live = "postgres://shiftdesk_app:p@db.shiftdesk.example:5432/shiftdesk";
const local = "postgres://shiftdesk_app:p@localhost:5432/shiftdesk";

describe("Gate B at the import command", () => {
  it("a dry run, or a database on this machine, is never asked", () => {
    expect(
      gateBCheck({ apply: false, databaseUrl: live, firm: "acme", agreementSigned: undefined }),
    ).toEqual({ ok: true });
    expect(
      gateBCheck({ apply: true, databaseUrl: local, firm: "acme", agreementSigned: undefined }),
    ).toEqual({ ok: true });
  });

  it("saving to a live database needs the firm's slug repeated", () => {
    expect(
      gateBCheck({ apply: true, databaseUrl: live, firm: "acme", agreementSigned: undefined }),
    ).toEqual({ ok: false, reason: "not_confirmed" });
    expect(
      gateBCheck({ apply: true, databaseUrl: live, firm: "acme", agreementSigned: "northline" }),
    ).toEqual({ ok: false, reason: "wrong_firm" });
    expect(
      gateBCheck({ apply: true, databaseUrl: live, firm: "acme", agreementSigned: "" }),
    ).toEqual({ ok: false, reason: "wrong_firm" });
    expect(
      gateBCheck({ apply: true, databaseUrl: live, firm: "acme", agreementSigned: " ACME " }),
    ).toEqual({ ok: true });
  });
});
