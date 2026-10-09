import { describe, expect, it } from "vitest";
import { uuidArray } from "@/lib/db/arrays";

// src/lib/db/arrays.ts: a list of uuids as one Postgres array parameter. Anything that isn't a
// uuid is refused, so no other text can get into the array literal.

describe("uuidArray", () => {
  it("takes uuids (any case)", () => {
    expect(() =>
      uuidArray(["5b0f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e", "5B0F4C1E-2D3A-4B5C-8D9E-0F1A2B3C4D5F"]),
    ).not.toThrow();
    expect(() => uuidArray([])).not.toThrow();
  });

  it("refuses anything else", () => {
    for (const bad of ["", "abc", "5b0f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e,x", "a}::text[]--"]) {
      expect(() => uuidArray(["5b0f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e", bad])).toThrow(
        "uuidArray: not a uuid",
      );
    }
  });
});
