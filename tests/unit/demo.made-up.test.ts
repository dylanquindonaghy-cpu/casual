import { describe, expect, it } from "vitest";
import { seedFirms } from "@/lib/db/admin/seed-data";
import { isMadeUpEmail, isMadeUpMobile } from "@/lib/demo/made-up";
import { LOOK_ALIKE_EMAILS } from "../helpers/look-alike-emails";

// What counts as a made-up number or email (16.1; ADR-025; golden rule 7): demo mode's worker
// stops if anyone in a demo firm has anything else (src/lib/demo/guard.ts).

describe("made-up numbers", () => {
  it("are Ofcom's drama range, 07700 900000 to 07700 900999", () => {
    for (const n of ["+447700900000", "+447700900122", "+447700900999"]) {
      expect(isMadeUpMobile(n), n).toBe(true);
    }
  });

  it("anything else is real, however close", () => {
    for (const n of [
      "+447700901000",
      "+447700800122",
      "+441134960101",
      "+442079460102",
      "+4477009001222",
      "+44770090012",
      "07700900122",
      "+447700900122 ",
    ]) {
      expect(isMadeUpMobile(n), n).toBe(false);
    }
  });
});

describe("made-up emails", () => {
  it("are on the example domains or a reserved top-level name, any case", () => {
    for (const e of [
      "acme.admin@example.com",
      "Payroll@EXAMPLE.ORG",
      "zoe@mail.example.com",
      "office@acme-events.example",
      "x@shifts.test",
      "x@nowhere.invalid",
      "x@localhost",
    ]) {
      expect(isMadeUpEmail(e), e).toBe(true);
    }
  });

  it("anything else is real, including look-alikes", () => {
    for (const e of [...Object.values(LOOK_ALIKE_EMAILS), "example.com", "@example.com", "a@"]) {
      expect(isMadeUpEmail(e), e).toBe(false);
    }
  });
});

describe("the made-up demo", () => {
  it("has made-up people only: every casual's number and email, every office email", () => {
    const real: string[] = [];
    for (const firm of seedFirms(new Date("2026-10-20T09:00:00Z"))) {
      for (const w of firm.workers) {
        if (w.mobileE164 && !isMadeUpMobile(w.mobileE164)) real.push(w.mobileE164);
        if (w.email && !isMadeUpEmail(w.email)) real.push(w.email);
      }
      for (const o of firm.officeUsers) if (!isMadeUpEmail(o.email)) real.push(o.email);
    }
    expect(real).toEqual([]);
  });
});
