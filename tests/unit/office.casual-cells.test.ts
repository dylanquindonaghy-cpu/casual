import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhotoCell, Tags } from "@/app/office/casuals/casual-cells";
import { chip } from "@/app/ui/classes";
import type { QualificationStatus } from "@/lib/credentials/status";
import type { CasualRow } from "@/lib/office/casuals";
import type { PhotoStatus } from "@/lib/uploads/photo";

// The Casuals list's two status cells (docs/screens.md `/office/casuals`; Phase 17 "easier to
// scan"; Phase 24, 24.4: round 7's words, each with its date): colour only for a problem. A valid
// licence and an up-to-date photo are plain words with no tag; a missing photo (most rows of a new
// firm) is a small dot and "Missing"; everything that needs someone (expiring, expired, due soon,
// overdue, waiting for a check) keeps its coloured tag.

const CHIP = chip.base;

const row = (over: Partial<CasualRow>): CasualRow => ({
  id: "w1",
  name: "Sam Taylor",
  roles: ["steward"],
  status: "active",
  qualifications: [],
  travel: null,
  liveStrikes: 0,
  needs: [],
  rolesWithoutRule: [],
  photo: { status: "missing", current: null, waiting: null },
  ...over,
});

const qualification = (status: QualificationStatus) => ({
  type: "SIA",
  name: "SIA licence",
  neededFor: ["steward"],
  appliedCounts: false,
  renewing: false,
  uploadable: true,
  status,
  expiresOn: "2027-03-01",
  evidenceUploadId: null,
  waiting: null,
  rejected: null,
});

const tags = (status: QualificationStatus) =>
  renderToStaticMarkup(
    createElement(Tags, { row: row({ qualifications: [qualification(status)] }), year: 2026 }),
  );

const photo = (status: PhotoStatus) =>
  renderToStaticMarkup(
    createElement(PhotoCell, {
      row: row({
        photo: {
          status,
          current:
            status === "missing" || status === "waiting"
              ? null
              : { id: "p1", uploadedOn: "2026-02-03", renewBy: "2029-02-03" },
          waiting: status === "waiting" ? { id: "p2", uploadedOn: "2026-10-01" } : null,
        },
      }),
      year: 2026,
    }),
  );

describe("Casuals list: qualifications", () => {
  it("a valid licence is plain words with its date, no tag", () => {
    const html = tags("valid");
    expect(html).toContain(
      '<span class="text-sm text-ink tabular-nums">SIA licence: valid until 1 Mar 2027</span>',
    );
    expect(html).not.toContain(CHIP);
  });

  it.each([
    ["expiring_soon", "expires 1 Mar 2027", chip.attention],
    ["expired", "expired 1 Mar 2027", chip.urgent],
    ["missing", "missing", chip.attention],
    ["being_checked", "being checked", chip.quiet],
  ] as const)("%s keeps its coloured tag", (status, words, tone) => {
    const html = tags(status);
    expect(html).toContain(`${CHIP} ${tone}`);
    expect(html).toContain(`SIA licence: ${words}`);
  });

  it("one that stops a booked shift says so; a known type has its short name", () => {
    const html = renderToStaticMarkup(
      createElement(Tags, {
        row: row({
          qualifications: [
            { ...qualification("expiring_soon"), type: "FIRST_AID", expiresOn: "2026-10-30" },
          ],
          needs: [
            {
              level: 1,
              qualification: {
                ...qualification("expiring_soon"),
                type: "FIRST_AID",
                expiresOn: "2026-10-30",
              },
              blocks: { role: "steward", day: "2026-10-31" },
            },
          ],
        }),
        year: 2026,
      }),
    );
    expect(html).toContain("First aid: expires 30 Oct (booked shift)");
  });

  it("with a valid one and an expired one, only the expired one is a tag", () => {
    const html = renderToStaticMarkup(
      createElement(Tags, {
        row: row({
          qualifications: [
            qualification("expired"),
            { ...qualification("valid"), type: "FA", name: "first aid certificate" },
          ],
        }),
        year: 2026,
      }),
    );
    expect(html.split(CHIP)).toHaveLength(2);
    expect(html).toContain("First aid certificate: valid until 1 Mar 2027");
  });
});

describe("Casuals list: staff photo", () => {
  it("up to date: plain words, the date it was taken under them, no tag", () => {
    const html = photo("up_to_date");
    expect(html).toContain(
      '<span class="text-sm text-ink">Up to date</span><span class="text-sm text-ink-muted tabular-nums">3 Feb</span>',
    );
    expect(html).not.toContain(CHIP);
  });

  it("missing: a small amber dot and the word, no tag", () => {
    const html = photo("missing");
    expect(html).toContain(
      '<span aria-hidden="true" class="h-1.5 w-1.5 rounded-full bg-attention"></span>Missing',
    );
    expect(html).not.toContain(CHIP);
  });

  it.each([
    ["due_soon", "Due soon", chip.attention],
    ["overdue", "Overdue", chip.urgent],
    ["waiting", "Waiting for check", chip.quiet],
  ] as const)("%s keeps its coloured tag", (status, words, tone) => {
    const html = photo(status);
    expect(html).toContain(`${CHIP} ${tone}`);
    expect(html).toContain(words);
    // Under it, the date that goes with it: taken on, or sent on while it waits.
    expect(html).toContain(status === "waiting" ? ">Sent 1 Oct</span>" : ">3 Feb</span>");
  });
});
