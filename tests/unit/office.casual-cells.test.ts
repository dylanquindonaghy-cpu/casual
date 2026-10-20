import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhotoCell, Tags } from "@/app/office/casuals/casual-cells";
import { chip } from "@/app/ui/classes";
import type { QualificationStatus } from "@/lib/credentials/status";
import type { CasualRow } from "@/lib/office/casuals";
import type { PhotoStatus } from "@/lib/uploads/photo";

// The Casuals list's two status cells (docs/screens.md `/office/casuals`; Phase 17 "easier to
// scan"): colour only for a problem. A valid licence and an up-to-date photo are quiet words with
// no tag; a missing photo (most rows of a new firm) is a small dot and "Missing"; everything that
// needs someone (expiring, expired, due soon, overdue, waiting for a check) keeps its coloured tag.

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
    createElement(Tags, { row: row({ qualifications: [qualification(status)] }) }),
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
  it("a valid licence is quiet words, no tag", () => {
    const html = tags("valid");
    expect(html).toContain("SIA licence: Valid");
    expect(html).not.toContain(CHIP);
    expect(html).toContain('class="text-sm text-ink-muted"');
  });

  it.each([
    ["expiring_soon", "Expiring soon", chip.attention],
    ["expired", "Expired", chip.urgent],
    ["missing", "Missing", chip.attention],
    ["being_checked", "Being checked", chip.quiet],
  ] as const)("%s keeps its coloured tag", (status, words, tone) => {
    const html = tags(status);
    expect(html).toContain(`${CHIP} ${tone}`);
    expect(html).toContain(`SIA licence: ${words}`);
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
      }),
    );
    expect(html.split(CHIP)).toHaveLength(2);
    expect(html).toContain("First aid certificate: Valid");
  });
});

describe("Casuals list: staff photo", () => {
  it("up to date: the date and quiet words, no tag", () => {
    const html = photo("up_to_date");
    expect(html).toContain("3 Feb");
    expect(html).toContain('<span class="text-sm text-ink-muted">Up to date</span>');
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
  });
});
