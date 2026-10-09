import { describe, expect, it } from "vitest";
import { PAY_DIGEST_MAX_GROUPS, payDigestEmail } from "@/lib/messaging/templates";
import { digestLines, sendNowText } from "@/lib/office/pay-digest-copy";
import { sortText } from "@/lib/office/pay-sort-copy";
import type { PayQueryGroup } from "@/lib/office/pay-query-groups";
import { MAX_ATTACHMENT_BYTES } from "@/lib/messaging/transport";
import { PAY_DIGEST_ROWS } from "@/lib/pay/digest";
import { DIGEST_CSV_HEADER, payDigestCsv, payDigestFilename } from "@/lib/pay/digest-list";
import { MAX_PAY_QUERY_DETAILS } from "@/lib/portal/pay-query-kinds";
import { digestSchedule } from "@/lib/pay/digest-schedule";

// The payroll digest's words: the email (src/lib/messaging/templates.ts `payDigestEmail`), its
// attached list (src/lib/pay/digest-list.ts) and payroll's page (src/lib/office/pay-digest-copy.ts).

const voice = { name: "Acme Events", signOff: "Acme Events Shift Team" };
const base = {
  total: 42,
  biggest: { count: 37, facts: "wrong rate, the week of Mon 7 Sep, paid at £12.50" },
  groups: [
    { heading: "37 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50.", aiLine: null },
    {
      heading: "5 queries: hours missing, the week of Mon 7 Sep, at Riverside Arena.",
      aiLine: null,
    },
  ],
  earlier: 0,
  later: 0,
  filename: "pay-queries-2026-09-14.csv",
  link: "https://acme.shiftdesk.example/office/pay-queries",
};

describe("the digest email", () => {
  it("the task's example: 42 queries, 37 about one thing, the groups, the list and the link", () => {
    const email = payDigestEmail(voice, base);
    expect(email.subject).toBe("Acme Events: 42 new pay queries");
    expect(email.body).toBe(
      [
        "42 new pay queries since the last digest. 37 are about the same thing: wrong rate, the week of Mon 7 Sep, paid at £12.50.",
        "",
        "Grouped by likely cause, biggest first:",
        "- 37 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50.",
        "- 5 queries: hours missing, the week of Mon 7 Sep, at Riverside Arena.",
        "",
        "The list is attached (pay-queries-2026-09-14.csv): each query with the worker, the day, the shift, the issue and what they wrote.",
        "",
        "Answer them on the pay queries page: https://acme.shiftdesk.example/office/pay-queries",
        "",
        "— Acme Events Shift Team",
      ].join("\n"),
    );
  });

  it("the headline when all are alike, none are, and for one query", () => {
    const first = (d: Partial<typeof base>) =>
      payDigestEmail(voice, { ...base, ...d }).body.split("\n")[0];
    expect(
      first({
        total: 3,
        biggest: { count: 3, facts: "paid late or not paid, the week of Mon 7 Sep" },
      }),
    ).toBe(
      "3 new pay queries since the last digest, all about the same thing: paid late or not paid, the week of Mon 7 Sep.",
    );
    expect(
      first({ total: 3, biggest: { count: 1, facts: "something else, the week of Mon 7 Sep" } }),
    ).toBe("3 new pay queries since the last digest, each about something different.");
    const one = payDigestEmail(voice, {
      ...base,
      total: 1,
      biggest: { count: 1, facts: "something else, the week of Mon 7 Sep" },
    });
    expect(one.subject).toBe("Acme Events: 1 new pay query");
    expect(one.body.split("\n")[0]).toBe(
      "1 new pay query since the last digest: something else, the week of Mon 7 Sep.",
    );
  });

  it("an AI line sits beneath its group's own line, labelled", () => {
    const email = payDigestEmail(voice, {
      ...base,
      groups: [
        { heading: base.groups[0]?.heading ?? "", aiLine: "Last week still paid at £12.50." },
      ],
    });
    expect(email.body).toContain(
      "- 37 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50.\n  AI summary: Last week still paid at £12.50. (written by AI)",
    );
  });

  it("older queries still waiting, new ones that didn't fit, and at most 30 group lines", () => {
    const groups = Array.from({ length: PAY_DIGEST_MAX_GROUPS + 2 }, (_, i) => ({
      heading: `1 query: something else, group ${i}.`,
      aiLine: null,
    }));
    const email = payDigestEmail(voice, { ...base, groups, earlier: 5, later: 12 });
    expect(email.body).toContain("group 29.");
    expect(email.body).not.toContain("group 30.");
    expect(email.body).toContain("- and 2 more groups");
    expect(email.body).toContain("5 queries from earlier digests are still waiting.");
    expect(email.body).toContain(
      "12 more new queries didn't fit in this digest. They're on the pay queries page and will be in the next one.",
    );
    const single = payDigestEmail(voice, {
      ...base,
      groups: groups.slice(0, PAY_DIGEST_MAX_GROUPS + 1),
      earlier: 1,
      later: 1,
    });
    expect(single.body).toContain("- and 1 more group\n");
    expect(single.body).toContain("1 query from an earlier digest is still waiting.");
    expect(single.body).toContain("1 more new query didn't fit");
    // Within the email's size limit at its biggest: 30 groups, each with a long AI line.
    const long = groups.map(() => ({ heading: `${"x".repeat(200)}.`, aiLine: "y".repeat(160) }));
    expect(payDigestEmail(voice, { ...base, groups: long }).body.length).toBeLessThan(20_000);
  });
});

const item = (over: Partial<PayQueryGroup["queries"][number]>) => ({
  id: "0f3c2a1b-0000-4000-8000-000000000001",
  ref: "0F3C2A1B",
  worker: "Ann Booker",
  day: "2026-09-12",
  shift: "Sat 12 Sep, 08:00 to 16:00",
  details: "Paid £12.50, should be £13",
  status: "in_digest",
  createdAt: new Date("2026-09-14T08:14:00Z"),
  ...over,
});

describe("the attached list", () => {
  it("a row per query, group by group, safe for spreadsheets, with a byte-order mark", () => {
    const groups: PayQueryGroup[] = [
      {
        key: "pay1:wrong_rate:2026-09-07:rate:1250",
        facts: {
          count: 2,
          issue: "wrong_rate",
          week: "2026-09-07",
          site: null,
          ratesPence: [1250],
        },
        heading: "2 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50.",
        aiLine: "Paid at £12.50.",
        queries: [
          item({}),
          item({
            ref: "0F3C2A1C",
            worker: "Zoë Łukasz",
            details: '=HYPERLINK("x"), "quoted"\nsecond line',
            createdAt: new Date("2026-09-14T09:30:00Z"),
          }),
        ],
      },
      {
        key: "pay1:late_pay:2026-09-07",
        facts: { count: 1, issue: "late_pay", week: "2026-09-07", site: null, ratesPence: null },
        heading: "1 query: paid late or not paid, the week of Mon 7 Sep.",
        aiLine: null,
        queries: [item({ ref: "0F3C2A1D", worker: "Ben Booker", shift: null, details: null })],
      },
    ];
    const csv = payDigestCsv(groups, "Europe/London");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      DIGEST_CSV_HEADER.join(","),
      '0F3C2A1B,Ann Booker,2026-09-12,"Sat 12 Sep, 08:00 to 16:00",Wrong rate,"Paid £12.50, should be £13",2026-09-14 09:14,"2 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50."',
      // A formula is made plain text; quotes and line breaks stay inside the cell.
      '0F3C2A1C,Zoë Łukasz,2026-09-12,"Sat 12 Sep, 08:00 to 16:00",Wrong rate,"\'=HYPERLINK(""x""), ""quoted""\nsecond line",2026-09-14 10:30,"2 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50."',
      '0F3C2A1D,Ben Booker,2026-09-12,,Paid late or not paid,,2026-09-14 09:14,"1 query: paid late or not paid, the week of Mon 7 Sep."',
      "",
    ]);
    // At its biggest (1,000 queries, each with 1,000 four-byte characters and long names), the list
    // is within the attachment's size limit.
    const huge: PayQueryGroup = {
      ...(groups[0] as PayQueryGroup),
      heading: `${"h".repeat(200)}.`,
      queries: Array.from({ length: PAY_DIGEST_ROWS }, (_, i) =>
        item({
          ref: String(i).padStart(8, "0"),
          worker: `${"Ł".repeat(100)} ${"Ż".repeat(100)}`,
          details: "😀".repeat(MAX_PAY_QUERY_DETAILS),
        }),
      ),
    };
    expect(new TextEncoder().encode(payDigestCsv([huge], "Europe/London")).length).toBeLessThan(
      MAX_ATTACHMENT_BYTES,
    );
    // The AI's line isn't in the list: the group column is the code's line.
    expect(csv).not.toContain("Paid at £12.50.");
    expect(payDigestFilename("2026-09-14")).toBe("pay-queries-2026-09-14.csv");
  });
});

describe("payroll's page", () => {
  it("the result of Send the digest now", () => {
    expect(sendNowText({ status: "queued", queries: 42, recipients: 2 })).toBe(
      "Sending the digest now: 42 new queries to 2 people. It should arrive in a minute or two.",
    );
    expect(sendNowText({ status: "queued", queries: 1, recipients: 1 })).toBe(
      "Sending the digest now: 1 new query to 1 person. It should arrive in a minute or two.",
    );
    expect(sendNowText({ status: "nothing_new" })).toBe(
      "No new pay queries to send. Queries already in a digest aren't sent again.",
    );
    expect(sendNowText({ status: "no_recipients" })).toBe(
      "There's no one in payroll with an email address to send it to.",
    );
    expect(sendNowText({ status: "just_asked" })).toBe(
      "A digest was asked for less than a minute ago. Wait a minute, then try again.",
    );
    expect(sendNowText({ status: "logged_out" })).toBe("Your session has ended. Log in again.");
    expect(sendNowText({ status: "not_allowed" })).toBe("You can't send the pay digest.");
    expect(sendNowText({ status: "error" })).toBe("Something went wrong. Try again.");
  });

  it("the schedule, the last digest, one that didn't go, one being sent", () => {
    const at = new Date("2026-11-02T09:02:00Z");
    expect(
      digestLines(
        digestSchedule({}),
        { lastSent: null, problem: null, sendingSince: null },
        "Europe/London",
      ),
    ).toEqual([
      "The digest goes to payroll by email at 09:00, Monday to Friday: the new queries, grouped, with the list attached.",
      "No digest sent yet.",
    ]);
    expect(
      digestLines(
        { time: "09:00", days: [] },
        {
          lastSent: { at, queries: 42, recipients: 2, failed: 0 },
          problem: { at: new Date("2026-11-03T09:01:00Z"), reason: "failed" },
          sendingSince: new Date("2026-11-03T10:15:00Z"),
        },
        "Europe/London",
      ),
    ).toEqual([
      "No digest is scheduled. You can send one now.",
      "Last digest: 09:02 on Mon 2 Nov, 42 queries to 2 people.",
      "The digest at 09:01 on Tue 3 Nov didn't go: the email couldn't be sent. Its queries will be in the next one.",
      "A digest is being sent now (started 10:15 on Tue 3 Nov).",
    ]);
    expect(
      digestLines(
        digestSchedule({}),
        {
          lastSent: { at, queries: 1, recipients: 1, failed: 0 },
          problem: { at, reason: "no_recipients" },
          sendingSince: null,
        },
        "Europe/London",
      ).slice(1),
    ).toEqual([
      "Last digest: 09:02 on Mon 2 Nov, 1 query to 1 person.",
      "The digest at 09:02 on Mon 2 Nov didn't go: there's no one in payroll with an email address to send it to.",
    ]);
    // Some addresses failing; a digest that stopped part way.
    expect(
      digestLines(
        digestSchedule({}),
        {
          lastSent: { at, queries: 3, recipients: 1, failed: 2 },
          problem: { at: new Date("2026-11-03T09:00:00Z"), reason: "unfinished" },
          sendingSince: null,
        },
        "Europe/London",
      ).slice(1),
    ).toEqual([
      "Last digest: 09:02 on Mon 2 Nov, 3 queries to 1 person (2 addresses failed).",
      "The digest at 09:00 on Tue 3 Nov may not have gone: it stopped part way. Its queries show as in a digest below.",
    ]);
    expect(
      digestLines(
        digestSchedule({}),
        {
          lastSent: { at, queries: 3, recipients: 1, failed: 1 },
          problem: null,
          sendingSince: null,
        },
        "Europe/London",
      )[1],
    ).toBe("Last digest: 09:02 on Mon 2 Nov, 3 queries to 1 person (1 address failed).");
  });

  it("the result of Mark as sorted and tell them", () => {
    expect(sortText({ status: "sorted", count: 2, skipped: 0 })).toBe(
      "Marked as sorted: 2 queries. Each person will get your note by message.",
    );
    expect(sortText({ status: "sorted", count: 1, skipped: 0 })).toBe(
      "Marked as sorted: 1 query. Each person will get your note by message.",
    );
    expect(sortText({ status: "sorted", count: 3, skipped: 1 })).toBe(
      "Marked as sorted: 3 queries. 1 was already sorted by someone else. Each person will get your note by message.",
    );
    expect(sortText({ status: "sorted", count: 1, skipped: 2 })).toBe(
      "Marked as sorted: 1 query. 2 were already sorted by someone else. Each person will get your note by message.",
    );
    expect(sortText({ status: "already" })).toBe("These were already sorted by someone else.");
    expect(sortText({ status: "note_needed" })).toBe("Tell them what payroll did first.");
    expect(sortText({ status: "note_too_long" })).toBe("That's too long (500 characters at most).");
    expect(sortText({ status: "not_allowed" })).toBe("You can't sort pay queries.");
    expect(sortText({ status: "logged_out" })).toBe("Your session has ended. Log in again.");
    expect(sortText({ status: "error" })).toBe("Something went wrong. Try again.");
  });
});
