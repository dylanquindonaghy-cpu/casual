import { describe, expect, it } from "vitest";
import type { NeedsItem, Qualification } from "@/lib/credentials/status";
import {
  DECLINE_STEP,
  declineOutcomeText,
  FIRST_TO_TAKE,
  needsRowText,
  offerRowText,
} from "@/lib/portal/home-copy";
import type { StaffPhoto } from "@/lib/uploads/photo";

// Home's "Offered to you" words (Phase 28.15; docs/screens.md "### 28.15"), and the 28.11 hand-off:
// a need the office has in hand leaves "Do this", and a suspended one goes to Messages.

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T21:30:00Z"); // Mon 2 Nov, 21:30 London

describe("offerRowText", () => {
  const offer = {
    role: "steward",
    eventName: "Raceday",
    siteName: "Riverside Arena",
    startsAt: new Date("2026-11-07T14:00:00Z"),
    endsAt: new Date("2026-11-07T22:00:00Z"),
    sentAt: new Date("2026-11-02T21:20:00Z"),
  };

  it("names the shift, its day, times and site, and when it was offered today", () => {
    expect(offerRowText(offer, NOW, TZ)).toEqual({
      title: "Steward · Raceday",
      sub: "Sat 7 Nov, 14:00 to 22:00 · Riverside Arena",
      offered: "Offered 21:20. First to take it gets it.",
    });
  });

  it("names the day it was offered on an earlier day, and leaves out a missing site and event", () => {
    const t = offerRowText(
      { ...offer, eventName: null, siteName: null, sentAt: new Date("2026-11-01T09:05:00Z") },
      NOW,
      TZ,
    );
    expect(t.title).toBe("Steward");
    expect(t.sub).toBe("Sat 7 Nov, 14:00 to 22:00");
    expect(t.offered).toBe("Offered 09:05 on Sun 1 Nov. First to take it gets it.");
  });

  it("says what the shift's page would let her do: take it, ask for it, or take it later", () => {
    expect(offerRowText({ ...offer, take: { kind: "now" } }, NOW, TZ).offered).toBe(
      "Offered 21:20. First to take it gets it.",
    );
    expect(offerRowText({ ...offer, take: { kind: "ask" } }, NOW, TZ).offered).toBe(
      "Offered 21:20. The office chooses who works this one. You can ask for it.",
    );
    const held = { kind: "held" as const, opensAt: new Date("2026-11-02T21:45:00Z") };
    expect(offerRowText({ ...offer, take: held }, NOW, TZ).offered).toBe(
      "Offered 21:20. You can take it from 21:45.",
    );
  });

  it("names the shift's page, never Open shifts (it may not list the shift), and the ask where the office chooses", () => {
    expect([DECLINE_STEP.line, DECLINE_STEP.lineAsk].join(" ")).not.toMatch(/Open shifts/);
    expect(declineOutcomeText("declined", "x").line).not.toMatch(/Open shifts/);
    expect(DECLINE_STEP.lineAsk).toBe(
      "We won't offer it to you again. The office chooses who works this one: you can still ask for it on the shift's page.",
    );
  });

  it("never names a deadline", () => {
    const words = [FIRST_TO_TAKE, ...Object.values(DECLINE_STEP)].join(" ");
    expect(words).not.toMatch(/answer by|expires|deadline|until \d/i);
  });
});

describe("declineOutcomeText", () => {
  it("says what happened, every time", () => {
    expect(declineOutcomeText("declined", "x")).toEqual({
      tone: "done",
      title: "Done. You won't be offered this shift again.",
      line: "You can still take it from the shift's page while it's open.",
    });
    // Where the office chooses for the event, saying no leaves her only the ask.
    expect(declineOutcomeText("declined", "x", "ask").line).toBe(
      "The office chooses who works this one. You can still ask for it on the shift's page.",
    );
    expect(declineOutcomeText("already", "x").title).toBe("You've already said no to this shift.");
    expect(declineOutcomeText("taken", "x").title).toBe("You've already taken this shift.");
    expect(declineOutcomeText("closed", "x").title).toBe("This offer has closed.");
    expect(declineOutcomeText("error", "Something went wrong. Try again.")).toEqual({
      tone: "urgent",
      title: "Something went wrong. Try again.",
    });
  });
});

describe("needsRowText and the office's mark", () => {
  const ok: StaffPhoto = { status: "ok", current: null, waiting: null } as unknown as StaffPhoto;
  const q = (over: Partial<Qualification>): Qualification =>
    ({
      type: "SIA_DS",
      name: "SIA door supervisor licence",
      status: "suspended",
      expiresOn: null,
      renewing: false,
      rejected: null,
      uploadable: true,
      neededFor: ["door_supervisor"],
      appliedCounts: false,
      ...over,
    }) as Qualification;
  const item = (qual: Qualification): NeedsItem => ({
    level: 2,
    qualification: qual,
    blocks: null,
  });

  it("sends a suspended qualification to Messages", () => {
    expect(needsRowText([item(q({}))], ok, 2026)?.href).toBe("/messages");
  });

  it("leaves out one the office has in hand, as Profile does", () => {
    const suspended = item(q({}));
    const mark = { type: "SIA_DS", status: "suspended", day: "2026-11-01", changedAfter: false };
    expect(needsRowText([suspended], ok, 2026, mark)).toBeNull();
    // A mark about something else, or one overtaken by a change, leaves it in.
    expect(needsRowText([suspended], ok, 2026, { ...mark, type: "STEWARD_L2" })).not.toBeNull();
    expect(needsRowText([suspended], ok, 2026, { ...mark, changedAfter: true })).not.toBeNull();
  });
});
