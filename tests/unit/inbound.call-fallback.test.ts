import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { callFallbackTwiml } from "@/lib/inbound/voice";

// Twilio's fallback when our app doesn't answer a call (Phase 8): the TwiML Bin's contents
// (callFallbackTwiml) and the command that prints them (`npm run firm:call-fallback`).

const firm = { name: "Acme Events" };

describe("the call fallback TwiML", () => {
  it("why, then the manager's phone for 30 seconds, then a closing line true however that call went; British English", () => {
    expect(callFallbackTwiml(firm, "+447700900123")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Say language="en-GB">Sorry, our system isn&apos;t answering right now. Putting you through to Acme Events.</Say>' +
        '<Dial timeout="30">+447700900123</Dial>' +
        '<Say language="en-GB">If nobody answered, please call again in a few minutes. Goodbye.</Say>' +
        "<Hangup/></Response>",
    );
  });

  it("a firm's name can't break it; only an E.164 number is dialled", () => {
    expect(callFallbackTwiml({ name: "Smith & Sons <Security>" }, "+447700900123")).toContain(
      "Putting you through to Smith &amp; Sons &lt;Security&gt;.",
    );
    for (const bad of ["07700 900123", "+44", "<Dial>", "+447700900123</Dial><Dial>+1"]) {
      expect(() => callFallbackTwiml(firm, bad), bad).toThrow();
    }
  });
});

describe("npm run firm:call-fallback", () => {
  const run = (...args: string[]) =>
    execFileSync("node", ["--import", "tsx", "scripts/firm-call-fallback.ts", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  it("prints the TwiML for the firm and the manager's phone, read as a UK number", () => {
    expect(run("--name", "Acme Events", "--phone", "07700 900123").trim()).toBe(
      callFallbackTwiml(firm, "+447700900123"),
    );
  });

  it("refuses a number it can't read, a missing value, or an unknown option", () => {
    for (const args of [
      ["--name", "Acme Events", "--phone", "not a number"],
      ["--name", "Acme Events"],
      ["--phone", "07700 900123"],
      ["--nme", "Acme", "--phone", "07700 900123"],
      // A TwiML Bin would fill {{From}} in with the caller's number.
      ["--name", "Acme {{From}}", "--phone", "07700 900123"],
    ]) {
      expect(() => run(...args), args.join(" ")).toThrow();
    }
  });
});
