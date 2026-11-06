import { describe, expect, it } from "vitest";
import {
  DETAILS_NOTICE_DELAY_SECONDS,
  DETAILS_NOTICE_SLOT_SECONDS,
  detailsNoticeDecision,
  detailsNoticePayload,
  type UntoldChange,
} from "@/lib/notices/details-changed";
import { eventWords, type Names } from "@/lib/office/event-words";

// Who is told a booked shift's briefing changed (Phase 28.3; src/lib/notices/details-changed.ts):
// code decides, from the facts only (golden rule 1), and the office's log says why in plain words.
// The job itself, on the real database, is tests/integration/notices.details-changed.test.ts.

const change = (o: Partial<UntoldChange> = {}): UntoldChange => ({
  fields: ["meetingPoint"],
  withMoveNotice: false,
  firmSystem: false,
  ...o,
});
const booking = (o: Partial<Parameters<typeof detailsNoticeDecision>[0]> = {}) => ({
  untold: [change()],
  started: false,
  firmSystemSends: false,
  bookedByFirmSystem: false,
  reach: "sms" as const,
  bookingMessageDue: false,
  ...o,
});

describe("detailsNoticeDecision", () => {
  it("tells a booked casual, naming every part that changed once, in the briefing's order", () => {
    expect(
      detailsNoticeDecision(
        booking({
          untold: [
            change({ fields: ["uniform", "payRatePence"] }),
            change({ fields: ["meetingPoint"] }),
            change({ fields: ["uniform"] }),
          ],
        }),
      ),
    ).toEqual({ action: "send", fields: ["meetingPoint", "uniform", "payRatePence"] });
  });

  it("nothing untold: nothing to do, and nothing logged", () => {
    expect(detailsNoticeDecision(booking({ untold: [] }))).toEqual({ action: "none" });
  });

  it("each exception, with its reason", () => {
    expect(detailsNoticeDecision(booking({ started: true }))).toEqual({
      action: "skip",
      reason: "started",
    });
    expect(
      detailsNoticeDecision(
        booking({
          firmSystemSends: true,
          bookedByFirmSystem: true,
          untold: [change({ firmSystem: true })],
        }),
      ),
    ).toEqual({ action: "skip", reason: "firm_sends" });
    expect(detailsNoticeDecision(booking({ untold: [change({ withMoveNotice: true })] }))).toEqual({
      action: "skip",
      reason: "move_notice",
    });
    expect(detailsNoticeDecision(booking({ reach: "none" }))).toEqual({
      action: "skip",
      reason: "no_way",
    });
  });

  it("the firm's own system only tells its own bookings about its own changes", () => {
    const own = { firmSystemSends: true, untold: [change({ firmSystem: true })] };
    // Booked in ShiftDesk (by the office or by them): ShiftDesk tells them.
    expect(detailsNoticeDecision(booking({ ...own, bookedByFirmSystem: false })).action).toBe(
      "send",
    );
    // The office's change to the sheet's booking: the sheet doesn't know of it, so ShiftDesk tells.
    expect(
      detailsNoticeDecision(
        booking({
          firmSystemSends: true,
          bookedByFirmSystem: true,
          untold: [change({ firmSystem: true }), change({ firmSystem: false, fields: ["post"] })],
        }),
      ),
    ).toEqual({ action: "send", fields: ["meetingPoint", "post"] });
    // The setting off: ShiftDesk tells everyone (as before P2.3).
    expect(
      detailsNoticeDecision(booking({ ...own, firmSystemSends: false, bookedByFirmSystem: true }))
        .action,
    ).toBe("send");
  });

  it("a change that came with a move is the move notice's; one that came alone is still told", () => {
    expect(
      detailsNoticeDecision(
        booking({
          untold: [
            change({ withMoveNotice: true, fields: ["meetingPoint"] }),
            change({ fields: ["uniform"] }),
          ],
        }),
      ),
    ).toEqual({ action: "send", fields: ["uniform"] });
  });

  it("started is checked before who sends and how they're reached", () => {
    expect(
      detailsNoticeDecision(
        booking({
          started: true,
          reach: "none",
          firmSystemSends: true,
          bookedByFirmSystem: true,
          untold: [change({ firmSystem: true })],
        }),
      ),
    ).toEqual({ action: "skip", reason: "started" });
  });
});

describe("not before the booking message (Phase 29.4)", () => {
  it("the booking message is due but hasn't gone: skipped, not_told", () => {
    expect(detailsNoticeDecision(booking({ bookingMessageDue: true }))).toEqual({
      action: "skip",
      reason: "not_told",
    });
  });

  it("it has gone, or none was due: told", () => {
    expect(detailsNoticeDecision(booking({ bookingMessageDue: false }))).toEqual({
      action: "send",
      fields: ["meetingPoint"],
    });
  });

  it("nothing untold stays nothing; a move's own notice and a started shift keep their reasons", () => {
    expect(detailsNoticeDecision(booking({ untold: [], bookingMessageDue: true }))).toEqual({
      action: "none",
    });
    expect(
      detailsNoticeDecision(
        booking({ bookingMessageDue: true, untold: [change({ withMoveNotice: true })] }),
      ),
    ).toEqual({ action: "skip", reason: "move_notice" });
    expect(detailsNoticeDecision(booking({ bookingMessageDue: true, started: true }))).toEqual({
      action: "skip",
      reason: "started",
    });
  });

  it("checked before how they're reached", () => {
    expect(detailsNoticeDecision(booking({ bookingMessageDue: true, reach: "none" }))).toEqual({
      action: "skip",
      reason: "not_told",
    });
  });
});

describe("the job's timing", () => {
  it("a burst of saves is one job: queued a while ahead, one per session a slot", () => {
    expect(DETAILS_NOTICE_DELAY_SECONDS).toBe(120);
    // A save that joins a queued job is at least a minute ahead of it running.
    expect(DETAILS_NOTICE_SLOT_SECONDS).toBeLessThanOrEqual(DETAILS_NOTICE_DELAY_SECONDS - 60);
  });

  it("its payload is ids only (firmJobEnvelope)", () => {
    const ok = {
      firmId: "3f2a9c1e-5b7d-4e8a-9f0b-1c2d3e4f5a6b",
      idempotencyKey: "details-notice:42",
      shiftId: "4f2a9c1e-5b7d-4e8a-9f0b-1c2d3e4f5a6b",
      changeEventId: 42,
    };
    expect(detailsNoticePayload.safeParse(ok).success).toBe(true);
    expect(
      detailsNoticePayload.safeParse({ ...ok, idempotencyKey: "details-notice:42:after-quiet" })
        .success,
    ).toBe(true);
    expect(
      detailsNoticePayload.safeParse({ ...ok, idempotencyKey: "details-notice:Gate A" }).success,
    ).toBe(false);
    expect(detailsNoticePayload.safeParse({ ...ok, shiftId: "Gate A" }).success).toBe(false);
  });
});

describe("the office's log words (Phase 28.3)", () => {
  const names: Names = { worker: () => "Ann Booker", office: () => "Sam Rota" };
  const say = (action: string, data: Record<string, unknown> = {}) =>
    eventWords({ action, actorType: "system", actorId: null, data }, names);

  it("the parts that changed in the casual's words, never a value", () => {
    expect(
      say("shift.details_notice", { workerId: "w", fields: ["meetingPoint", "payRatePence"] }),
    ).toBe("Telling Ann Booker their shift's details changed (meeting point and pay).");
    expect(say("shift.details_notice_sent", { workerId: "w", channel: "push" })).toBe(
      "Ann Booker was told their shift's details changed.",
    );
    expect(say("shift.details_notice_failed", { workerId: "w", code: "no_channel" })).toBe(
      "Telling Ann Booker their shift's details changed failed.",
    );
    expect(say("shift.details_notice_held", { workerId: "w", afterStart: true })).toBe(
      "Telling Ann Booker their shift's details changed waits for quiet hours to end, after the start: phone them.",
    );
  });

  it.each([
    ["started", "the shift had started"],
    ["firm_sends", "your own system tells them (its booking, and its change)"],
    ["move_notice", "the same change moved their shift, and they're told about that"],
    ["no_way", "nothing can reach them (no phone notifications, text or email)"],
    [
      "not_told",
      "they haven't been told about the booking yet (that message shows the shift as it is)",
    ],
  ])("skipped: %s", (reason, why) => {
    expect(say("shift.details_notice_skipped", { workerId: "w", reason })).toBe(
      `Ann Booker wasn't told their shift's details changed: ${why}.`,
    );
  });
});
