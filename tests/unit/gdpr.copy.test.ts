import { describe, expect, it } from "vitest";
import { workerExportCsv, workerExportFileName } from "@/lib/gdpr/worker-export";
import { ERASED_REASON, erasedCancelReason } from "@/lib/gdpr/free-text";
import {
  eraseExplainer,
  eraseResultText,
  keepTimeLines,
  type EraseActionResult,
} from "@/lib/office/data-copy";

// A worker's CSV export (src/lib/gdpr/worker-export.ts): one value per line, and the office's
// words after a deletion (docs/screens.md `/office/data/workers/[id]`).

describe("the worker CSV", () => {
  const file = workerExportCsv({
    exportedAt: new Date("2026-11-02T09:00:00Z"),
    firm: "Acme Events",
    worker: { id: "w1", firstName: "Ann", email: null, roles: ["steward", "door_supervisor"] },
    sections: {
      requests: [
        { id: "r1", payload: { note: "Line one\nline two", times: { start: "10:00" } } },
        { id: "r2", payload: {} },
      ],
      messages: [{ id: "m1", body: "@SUM(A1)", createdAt: new Date("2026-11-01T08:00:00Z") }],
      shifts: [],
    },
  });
  const csv = file.slice(1).split("\r\n");

  it("starts with the byte order mark (Excel reads it as UTF-8), then the header", () => {
    expect(file.startsWith("\uFEFFSection,Record,Field,Value\r\n")).toBe(true);
  });

  it("has the header, the export's own lines, then every value", () => {
    expect(csv.slice(0, 7)).toEqual([
      "Section,Record,Field,Value",
      "export,1,exportedAt,2026-11-02T09:00:00.000Z",
      "export,1,firm,Acme Events",
      "worker,1,id,w1",
      "worker,1,firstName,Ann",
      "worker,1,email,",
      'worker,1,roles,"[""steward"",""door_supervisor""]"',
    ]);
  });

  it("dots nested fields, keeps line breaks inside one quoted cell, and shows an empty object", () => {
    expect(csv).toContain('requests,1,payload.note,"Line one\nline two"');
    expect(csv).toContain("requests,1,payload.times.start,10:00");
    expect(csv).toContain("requests,2,payload,{}");
  });

  it("makes a formula inert and writes dates as UTC", () => {
    expect(csv).toContain("messages,1,body,'@SUM(A1)");
    expect(csv).toContain("messages,1,createdAt,2026-11-01T08:00:00.000Z");
    expect(csv.at(-1)).toBe("");
  });

  it("names the file by id and date, never by name", () => {
    expect(
      workerExportFileName("0f8fad5b-d9cb-469f-a165-70867728950e", "csv", new Date("2026-11-02")),
    ).toBe("worker-0f8fad5b-data-2026-11-02.csv");
  });
});

describe("what a deletion says", () => {
  const results: EraseActionResult[] = [
    {
      status: "erased",
      name: "Ann Booker",
      counts: {
        licences: 1,
        images: 0,
        loginLinks: 0,
        sessions: 0,
        devices: 0,
        daysUnavailable: 0,
        siteBlocks: 0,
        travelArea: 0,
        messages: 0,
        requests: 0,
        payQueries: 0,
        cancelReasons: 0,
        overrideReasons: 0,
        sheetMentions: 0,
        withdrawalReasons: 0,
      },
    },
    { status: "booked", name: "Ann Booker", upcoming: 1 },
    { status: "booked", name: "Ann Booker", upcoming: 2 },
    { status: "already" },
    { status: "unconfirmed" },
    { status: "not_found" },
    { status: "not_allowed" },
    { status: "logged_out" },
    { status: "error" },
  ];

  it.each(results)("$status: plain words, ending with a full stop", (result) => {
    const text = eraseResultText(result);
    expect(text).toMatch(/\.$/);
    expect(text).not.toMatch(/undefined|null|\[object/);
  });

  it("the words", () => {
    expect(eraseResultText(results[0] as EraseActionResult)).toBe(
      "Deleted. Ann Booker's personal details are gone. Their shift history stays, without a name. Words other people wrote that name them, like a colleague's swap request or pay query, aren't changed.",
    );
    expect(eraseResultText(results[1] as EraseActionResult)).toBe(
      "Ann Booker is booked on 1 shift that hasn't ended. Cancel those first, then delete.",
    );
    expect(eraseResultText(results[2] as EraseActionResult)).toBe(
      "Ann Booker is booked on 2 shifts that haven't ended. Cancel those first, then delete.",
    );
    expect(eraseResultText({ status: "error" })).toBe(
      "Something went wrong. Reload the page to see if it was deleted.",
    );
  });

  // Audit L86, L87: what an admin relies on when answering a worker's deletion request.
  it("before deleting: exactly what goes and what stays, including other people's words", () => {
    expect(eraseExplainer("Ann Booker", "Acme Events")).toEqual([
      "This deletes Ann Booker's name, mobile number, email, staff ID, licences and cards, days off, sites they're kept off, messages, logins and phone notifications, the notes on their own requests, pay questions and cancellations, and the office's typed reasons on their bookings.",
      "Their shifts, offers, cancellations and pay lines stay, without a name, as Acme Events's records (the notice report needs them).",
      "Words other people wrote that name them, like a colleague's swap request or pay query, aren't changed.",
    ]);
  });

  // Audit M24: the page used to say 90 days whatever the firm's settings were.
  it("how long we keep things: the firm's own settings, and a hold when there is one", () => {
    const lines = keepTimeLines(
      { messageDays: 120, requestNoteDays: 365, holdUntil: "2027-03-31" },
      "Wed 31 Mar 2027",
    );
    expect(lines.slice(0, 4)).toEqual([
      "Messages to and from your shifts line: 120 days.",
      "What a worker typed into a request (a note, a colleague's name): 365 days after the request is closed. An open request keeps it.",
      "The office's typed reason for placing someone despite a rule: 365 days after they were booked.",
      "A hold is on until Wed 31 Mar 2027: nothing above is deleted until then.",
    ]);
    expect(
      keepTimeLines({ messageDays: 90, requestNoteDays: 365, holdUntil: null }, null),
    ).not.toEqual(expect.arrayContaining([expect.stringContaining("A hold is on")]));
  });
});

describe("an erased worker's cancellation reasons", () => {
  it("keeps the app's fixed wording and drops anything typed", () => {
    for (const fixed of [
      "I'm unwell",
      "Something else",
      "The client needs fewer staff",
      "Removed on the rota sheet",
      "Shift cancelled on the rota sheet",
    ]) {
      expect(erasedCancelReason(fixed)).toBe(fixed);
    }
    expect(erasedCancelReason("Something else: chemo moved to Friday")).toBe("Something else");
    expect(erasedCancelReason("Ann rang, her mum is in hospital")).toBe(ERASED_REASON);
    expect(erasedCancelReason("I'm unwell today")).toBe(ERASED_REASON);
    expect(erasedCancelReason(null)).toBeNull();
  });
});
