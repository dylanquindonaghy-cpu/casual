import { afterEach, describe, expect, it, vi } from "vitest";
import { printSeedSummary } from "../../scripts/seed-summary";

// What `npm run db:seed` and `npm run db:reset` print (docs/walkthrough.md steps 7 and 18 use the
// urgent dropout's link).

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the seed's summary", () => {
  it("each firm, and the urgent dropout's link on Acme's portal", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
    printSeedSummary({
      firms: [
        {
          slug: "acme",
          sites: 3,
          officeUsers: 3,
          workers: 60,
          credentials: 95,
          shifts: 40,
          eventDay: "2026-10-10",
          urgentShiftId: "ddaba082-06ff-4fca-a50f-3656c12b93c5",
        },
        {
          slug: "northline",
          sites: 2,
          officeUsers: 3,
          workers: 30,
          credentials: 90,
          shifts: 0,
          eventDay: null,
          urgentShiftId: null,
        },
      ],
    });
    expect(lines).toEqual([
      "acme: 60 workers, 95 credentials, 3 sites, 3 office users, 40 shifts on Saturday 2026-10-10",
      "northline: 30 workers, 90 credentials, 2 sites, 3 office users",
      "Urgent dropout (a door supervisor shift): http://acme.localhost:3000/shifts/ddaba082-06ff-4fca-a50f-3656c12b93c5",
      "The mock-up's story: Zoe Adeyemi 07700 900400, Kieran Doyle 900401, Ben Fraser 900402, Priya Shah 900403, Leah Ward 900404, Jamal Morgan 900405, Mo Rahman 900406, Tom Hale 900407",
      "Seed loaded. Try http://acme.localhost:3000 and http://northline.localhost:3000",
    ]);
  });
});
