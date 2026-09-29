import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayQueries, PayView } from "@/app/pay/pay-view";
import { importHours, importPence } from "@/lib/imports/import";
import { hoursText, pounds } from "@/lib/portal/pay-format";

// Pay: reading payroll's numbers exactly (no float rounding), and showing them as payroll sent them.

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("reading payroll's numbers", () => {
  it("reads money in pence, whatever the formatting", () => {
    expect(importPence("£12.50")).toBe(1250);
    expect(importPence("12.5")).toBe(1250);
    expect(importPence("12")).toBe(1200);
    expect(importPence(" £ 1,234.56 ")).toBe(123456);
    expect(importPence("0.07")).toBe(7);
    expect(importPence("12.345")).toBeNull();
    expect(importPence("twelve")).toBeNull();
    expect(importPence("-5")).toBeNull();
    expect(importPence("")).toBeNull();
    expect(importPence("12345678")).toBeNull(); // over £9,999,999.99
    // A decimal comma is refused, never read as a thousands separator (£1,250.00).
    expect(importPence("12,50")).toBeNull();
    expect(importPence("468,75")).toBeNull();
    expect(importPence("1,2,3,4")).toBeNull();
    expect(importPence("12,345.67")).toBe(1234567);
    expect(importPence("1,234,567")).toBe(123456700);
    // A spreadsheet's float noise is taken as the 2-decimal number it stands for; real extra
    // decimals aren't.
    expect(importPence("12.499999999999998")).toBe(1250);
  });

  it("reads hours to two decimals, from 0 to 1000", () => {
    expect(importHours("37.5")).toBe("37.50");
    expect(importHours("7.25")).toBe("7.25");
    expect(importHours("0")).toBe("0.00");
    expect(importHours("1000")).toBe("1000.00");
    expect(importHours("1001")).toBeNull();
    expect(importHours("7.255")).toBeNull();
    expect(importHours("-1")).toBeNull();
    expect(importHours("8h")).toBeNull();
    expect(importHours("36.299999999999997")).toBe("36.30");
    expect(importHours("36.305")).toBeNull();
  });
});

describe("showing pay", () => {
  it("formats money and hours plainly", () => {
    expect(pounds(1250)).toBe("£12.50");
    expect(pounds(123456)).toBe("£1,234.56");
    expect(pounds(7)).toBe("£0.07");
    expect(hoursText(37.5)).toBe("37.5 hours");
    expect(hoursText(1)).toBe("1 hour");
    expect(hoursText(7.25)).toBe("7.25 hours");
  });

  it("lists each line with its period, hours, rate, and gross and pay date when payroll gave them", () => {
    const words = text(
      renderToStaticMarkup(
        createElement(PayView, {
          firmName: "Acme Events",
          lines: [
            {
              periodStart: "2026-10-26",
              periodEnd: "2026-11-01",
              hours: 37.5,
              ratePence: 1250,
              grossPence: 46875,
              payDate: "2026-11-06",
            },
            {
              periodStart: "2026-10-26",
              periodEnd: "2026-11-01",
              hours: 4,
              ratePence: 1500,
              grossPence: null,
              payDate: null,
            },
          ],
        }),
      ),
    );
    expect(words).toContain("The last 8 weeks, from Acme Events's payroll.");
    expect(words).toContain("Mon 26 Oct to Sun 1 Nov");
    expect(words).toContain("37.5 hours at £12.50 an hour");
    expect(words).toContain("Gross pay: £468.75");
    expect(words).toContain("Pay date: Fri 6 Nov");
    expect(words).toContain("4 hours at £15.00 an hour");
    // Never worked out: no gross for the line payroll didn't give one.
    expect(words).not.toContain("£60.00");
    expect(words).toContain("If something looks wrong, raise a pay query.");
  });

  it("the worker's pay queries: a way to raise one, and each one's status", () => {
    const html = renderToStaticMarkup(
      createElement(PayQueries, {
        queries: [
          { ref: "3F2A9C1B", issue: "wrong_rate", day: "2026-10-31", status: "open" },
          { ref: "AB12CD34", issue: "late_pay", day: "2026-10-01", status: "in_digest" },
          { ref: "0F0F0F0F", issue: "missing_hours", day: "2026-09-26", status: "resolved" },
        ],
      }),
    );
    const words = text(html);
    expect(html).toContain('href="/pay/query"');
    expect(words).toContain("Raise a pay query");
    expect(words).toContain("Wrong rate: Sat 31 Oct");
    expect(words).toContain("Paid late or not paid: Thu 1 Oct");
    expect(words.match(/With payroll/g)).toHaveLength(2);
    expect(words).toContain("Hours missing: Sat 26 Sep");
    expect(words).toContain("Sorted");
    expect(words).toContain("Reference 3F2A9C1B");
    expect(text(renderToStaticMarkup(createElement(PayQueries, { queries: [] })))).toContain(
      "None in the last 90 days.",
    );
  });

  it("a sorted query shows the day payroll sorted it and payroll's note", () => {
    const words = text(
      renderToStaticMarkup(
        createElement(PayQueries, {
          queries: [
            {
              ref: "0F0F0F0F",
              issue: "wrong_rate",
              day: "2026-10-29",
              status: "resolved",
              sortedOn: "2026-11-03",
              note: "The new rate is now applied. The difference is paid on Fri 13 Nov.",
            },
            { ref: "3F2A9C1B", issue: "late_pay", day: "2026-10-31", status: "in_digest" },
          ],
        }),
      ),
    );
    expect(words).toContain("Wrong rate: Thu 29 Oct");
    expect(words).toContain("Sorted on Tue 3 Nov");
    expect(words).toContain(
      "Payroll says: “The new rate is now applied. The difference is paid on Fri 13 Nov.”",
    );
    // Still with payroll: no note.
    expect(words).toContain("With payroll");
    expect(words.match(/Payroll says/g)).toHaveLength(1);
  });

  it("says so plainly when there's nothing yet", () => {
    expect(
      text(renderToStaticMarkup(createElement(PayView, { firmName: "Acme Events", lines: [] }))),
    ).toContain("No pay data yet for this period.");
  });
});
