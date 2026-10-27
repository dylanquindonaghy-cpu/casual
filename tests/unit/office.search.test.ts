import { describe, expect, it } from "vitest";
import { SEARCH_MAX, searchQuery } from "@/lib/office/search";
import { SEARCH_EMPTY, SEARCH_LABEL, searchHits } from "@/lib/office/search-copy";

// The office search's words (Phase 24: the top bar's "Find a casual, shift or site";
// src/lib/office/search-copy.ts): what's typed as it's searched, and each thing found as a line to
// read and the page it opens. tests/integration/office.shell.test.ts finds them on the database.

const at = (iso: string) => new Date(iso);

describe("what's typed", () => {
  it("is trimmed, its spaces closed up, cut at 100 characters; under 2 isn't searched", () => {
    expect(searchQuery("  Ann   Booker ")).toBe("Ann Booker");
    expect(searchQuery("a")).toBeNull();
    expect(searchQuery("   ")).toBeNull();
    expect(searchQuery("ab")).toBe("ab");
    expect(searchQuery("x".repeat(150))).toHaveLength(100);
    expect(SEARCH_MAX).toBe(5);
    expect(SEARCH_LABEL).toBe("Find a casual, shift or site");
  });
});

describe("what's found, as lines", () => {
  const found = {
    casuals: {
      rows: [
        {
          id: "c1",
          firstName: "Ann",
          lastName: "Booker",
          roles: ["door_supervisor", "csas_officer"],
          status: "active" as const,
        },
        { id: "c2", firstName: "Ben", lastName: "Booker", roles: [], status: "inactive" as const },
        {
          id: "c3",
          firstName: "Cal",
          lastName: "Booker",
          roles: ["steward"],
          status: "blocked" as const,
        },
      ],
      more: true,
    },
    sessions: {
      rows: [
        {
          id: "s1",
          role: "door_supervisor",
          event: "Raceday",
          place: "Acme Arena",
          post: "Gate A",
          // 08:00 to 16:00 in London (summer time).
          startsAt: at("2026-10-20T07:00:00Z"),
          endsAt: at("2026-10-20T15:00:00Z"),
          placesFree: 1,
          urgentGap: true,
        },
        {
          id: "s2",
          role: "steward",
          event: "Winter Fair",
          place: null,
          post: null,
          // 19:00 to 01:00 in London (winter time), over midnight.
          startsAt: at("2026-11-07T19:00:00Z"),
          endsAt: at("2026-11-08T01:00:00Z"),
          placesFree: 0,
          urgentGap: false,
        },
      ],
      more: false,
    },
    sites: {
      rows: [
        { id: "t1", name: "Acme Arena", town: "Leeds", events: 2 },
        { id: "t2", name: "Acme Depot", town: null, events: 0 },
      ],
      more: false,
    },
  };

  it("casuals: name, roles and a status that isn't active; their page", () => {
    const { groups } = searchHits(found, "Europe/London");
    expect(groups[0]).toEqual({
      kind: "casuals",
      label: "Casuals",
      hits: [
        {
          href: "/office/casuals/c1",
          title: "Ann Booker",
          detail: "Door supervisor, CSAS officer",
          urgent: false,
        },
        { href: "/office/casuals/c2", title: "Ben Booker", detail: "Not active", urgent: false },
        {
          href: "/office/casuals/c3",
          title: "Cal Booker",
          detail: "Steward · Blocked",
          urgent: false,
        },
      ],
      more: "More casuals match. Type more of the name.",
    });
  });

  it("shifts: role and event, then the day and times in the firm's zone, where, places; their page", () => {
    const { groups } = searchHits(found, "Europe/London");
    expect(groups[1]).toEqual({
      kind: "sessions",
      label: "Shifts",
      hits: [
        {
          href: "/office/shifts/s1",
          title: "Door supervisor · Raceday",
          detail: "Tue 20 Oct, 08:00–16:00 · Gate A, Acme Arena · 1 place to fill",
          urgent: true,
        },
        {
          href: "/office/shifts/s2",
          title: "Steward · Winter Fair",
          detail: "Sat 7 Nov, 19:00–01:00 · No places to fill",
          urgent: false,
        },
      ],
      more: null,
    });
  });

  it("sites: name, town and its events to come; Events & sessions at that site", () => {
    const { groups, count } = searchHits(found, "Europe/London");
    expect(groups[2]).toEqual({
      kind: "sites",
      label: "Sites",
      hits: [
        {
          href: "/office/events?site=t1",
          title: "Acme Arena",
          detail: "Leeds · 2 events to come",
          urgent: false,
        },
        {
          href: "/office/events?site=t2",
          title: "Acme Depot",
          detail: "No events to come",
          urgent: false,
        },
      ],
      more: null,
    });
    expect(count).toBe(7);
  });

  it("only the kinds with something found, and none for a kind the role can't open", () => {
    const none = { rows: [], more: false };
    expect(searchHits({ casuals: none, sessions: none, sites: none }, "Europe/London")).toEqual({
      groups: [],
      count: 0,
    });
    expect(
      searchHits({ ...found, sessions: null, sites: null }, "Europe/London").groups.map(
        (g) => g.kind,
      ),
    ).toEqual(["casuals"]);
    expect(SEARCH_EMPTY("zed")).toBe("Nothing found for “zed”.");
  });
});
