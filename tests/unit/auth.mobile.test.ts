import { describe, expect, it } from "vitest";
import { normaliseMobile, spreadsheetMobile } from "@/lib/auth/mobile";
import { loginLinkMessage } from "@/lib/messaging/templates";
import { ownDomainUrl, portalUrl } from "@/lib/tenancy/portal-url";
import { signOffFor } from "@/lib/tenancy/sign-off";

describe("what workers type as their mobile number", () => {
  it.each([
    ["07700 900123", "+447700900123"],
    ["07700900123", "+447700900123"],
    ["07700-900-123", "+447700900123"],
    ["+44 7700 900123", "+447700900123"],
    ["+44 (0)7700 900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
    ["0044 (0)7700 900123", "+447700900123"],
    ["447700900123", "+447700900123"],
    [" 07700 900 123 ", "+447700900123"],
    ["+353 85 123 4567", "+353851234567"],
    ["00353851234567", "+353851234567"],
    ["+353 (0)85 123 4567", "+353851234567"],
  ])("%s -> %s", (typed, e164) => {
    expect(normaliseMobile(typed)).toBe(e164);
  });

  it.each([
    "",
    "hello",
    "0770090012",
    "077009001234",
    "01632 960123",
    "+0 7700 900123",
    "7700900123",
    // Audit L68: a UK landline or premium number in international form, as 020… is refused,
    "+44 20 7946 0000",
    "0044 20 7946 0000",
    "+44 9098 790000",
    // and a number too short to be anyone's mobile.
    "+1 555 0100",
  ])("refuses %j", (typed) => {
    expect(normaliseMobile(typed)).toBeNull();
  });
});

describe("a mobile as a spreadsheet holds it (every import path, and the Sheets sync)", () => {
  it.each([
    ["07700 900123", "+447700900123"],
    // A number cell drops the 0: put back for a UK mobile only.
    ["7700900123", "+447700900123"],
    [" 7700900123 ", "+447700900123"],
    ["+353 85 123 4567", "+353851234567"],
  ])("%s -> %s", (cell, e164) => {
    expect(spreadsheetMobile(cell)).toBe(e164);
  });

  it.each(["2079460000", "770090012", "+44 20 7946 0000", ""])("refuses %j", (cell) => {
    expect(spreadsheetMobile(cell)).toBeNull();
  });
});

describe("portal links", () => {
  it("are built from the firm's slug and our base domain only; http only for localhost", () => {
    expect(portalUrl("acme", "localhost:3000")).toBe("http://acme.localhost:3000");
    expect(portalUrl("acme", "shiftdesk.co.uk")).toBe("https://acme.shiftdesk.co.uk");
    expect(portalUrl("acme", "Shiftdesk.co.uk.")).toBe("https://acme.shiftdesk.co.uk");
  });

  it("on a firm's own domain: always https (Caddy's certificate; a browser keeps no session over http)", () => {
    expect(ownDomainUrl("shifts.acme.co.uk")).toBe("https://shifts.acme.co.uk");
  });
});

describe("the login message", () => {
  it("follows the login_link template and ends with the firm's sign-off, never a person's name", () => {
    const voice = { name: "Acme Events", signOff: signOffFor("Acme Events", undefined) };
    expect(loginLinkMessage(voice, "http://acme.localhost:3000/l#abc")).toBe(
      "Here's your Acme Events shifts link: http://acme.localhost:3000/l#abc. It works for 15 minutes and only for you. — Acme Events Shift Team",
    );
    expect(signOffFor("Acme Events", "  ")).toBe("Acme Events Shift Team");
    expect(signOffFor("Acme Events", "Acme Shift Team")).toBe("Acme Shift Team");
  });
});
