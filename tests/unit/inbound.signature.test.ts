import { describe, expect, it } from "vitest";
import { isValidTwilioSignature, twilioSignature } from "@/lib/inbound/twilio-signature";

// Twilio's webhook signature (src/lib/inbound/twilio-signature.ts). The first case is Twilio's own
// documented example ("Validating signatures from Twilio"): auth token 12345, that URL and those
// fields give exactly that signature.

const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const FIELDS = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};

describe("Twilio webhook signatures", () => {
  it("reproduces Twilio's documented example", () => {
    expect(twilioSignature("12345", URL, FIELDS)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(isValidTwilioSignature("12345", URL, FIELDS, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
  });

  it("the order fields arrive in doesn't matter (they're sorted by name)", () => {
    const reversed = Object.fromEntries(Object.entries(FIELDS).reverse());
    expect(twilioSignature("12345", URL, reversed)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });

  it("refuses a missing signature, another key, another address, or any field changed, added or dropped", () => {
    const good = twilioSignature("12345", URL, FIELDS);
    expect(isValidTwilioSignature("12345", URL, FIELDS, null)).toBe(false);
    expect(isValidTwilioSignature("12345", URL, FIELDS, "")).toBe(false);
    expect(isValidTwilioSignature("54321", URL, FIELDS, good)).toBe(false);
    expect(isValidTwilioSignature("12345", `${URL}&x=1`, FIELDS, good)).toBe(false);
    expect(isValidTwilioSignature("12345", URL, { ...FIELDS, Digits: "1235" }, good)).toBe(false);
    expect(isValidTwilioSignature("12345", URL, { ...FIELDS, Extra: "" }, good)).toBe(false);
    const { Digits: _dropped, ...fewer } = FIELDS;
    expect(isValidTwilioSignature("12345", URL, fewer, good)).toBe(false);
    expect(isValidTwilioSignature("12345", URL, FIELDS, `${good}x`)).toBe(false);
  });
});
