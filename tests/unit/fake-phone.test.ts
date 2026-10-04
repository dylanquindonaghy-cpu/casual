import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidTwilioSignature } from "@/lib/inbound/twilio-signature";
import { handleTwilioSms, handleTwilioWhatsApp } from "@/lib/inbound/webhook";
import { platformUrl } from "@/lib/tenancy/portal-url";
import {
  fakeCall,
  fakeSms,
  fakeWhatsApp,
  isLocalBaseDomain,
  spokenWords,
} from "../../scripts/fake-phone";

// The fake phone for the walkthrough (scripts/fake-phone.ts, Phase 10 task 20): what it posts is
// accepted by the real webhook handlers, signed as Twilio signs, to the address the server checks;
// and it never talks to anything but a local server. The whole round trip (the reply in the
// outbox) is in tests/e2e/walkthrough.spec.ts.

const TOKEN = "local-fake-twilio-token-0000000000";
const target = { baseDomain: "localhost:3000", authToken: TOKEN };
const firm = {
  id: "f1",
  slug: "acme",
  name: "Acme Events",
  timezone: "Europe/London",
  signOff: "x",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// fetch, answered by `handle` (the real webhook handler under test), with every request kept.
function serve(handle: (request: Request) => Promise<Response>) {
  const seen: Request[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const request = new Request(url, init);
    seen.push(request.clone());
    return handle(request);
  });
  return seen;
}

describe("the fake phone", () => {
  it("a WhatsApp: the real handler accepts it (signed, to the address it checks) and stores it once", async () => {
    const received: unknown[] = [];
    const seen = serve((request) =>
      handleTwilioWhatsApp(request, {
        authToken: TOKEN,
        webhookUrl: platformUrl("localhost:3000", "/api/webhooks/twilio/whatsapp"),
        resolveFirmByLine: async (n) => (n === "+447700900000" ? firm : null),
        receive: async (_firmId, message) => {
          received.push(message);
          return { stored: true };
        },
      }),
    );
    const answer = await fakeWhatsApp(target, {
      from: "+447700900121",
      to: "+447700900000",
      text: "Any shifts this weekend?",
    });
    expect(answer.status).toBe(200);
    expect(seen[0]?.url).toBe("http://localhost:3000/api/webhooks/twilio/whatsapp");
    expect(received).toEqual([
      expect.objectContaining({ from: "+447700900121", body: "Any shifts this weekend?" }),
    ]);
  });

  it("a text: the real handler accepts it too", async () => {
    const received: unknown[] = [];
    serve((request) =>
      handleTwilioSms(request, {
        authToken: TOKEN,
        webhookUrl: platformUrl("localhost:3000", "/api/webhooks/twilio/sms"),
        resolveFirmByLine: async () => firm,
        receive: async (_firmId, message) => {
          received.push(message);
          return { stored: true };
        },
      }),
    );
    const answer = await fakeSms(target, {
      from: "+447700900121",
      to: "+447700900000",
      text: "Hi",
    });
    expect(answer.status).toBe(200);
    expect(received).toEqual([expect.objectContaining({ from: "+447700900121", body: "Hi" })]);
  });

  it("signed with the wrong key, the handler refuses it", async () => {
    serve((request) =>
      handleTwilioSms(request, {
        authToken: "another-token-entirely-0000000000",
        webhookUrl: platformUrl("localhost:3000", "/api/webhooks/twilio/sms"),
        resolveFirmByLine: async () => firm,
        receive: async () => ({ stored: true }),
      }),
    );
    expect(
      (await fakeSms(target, { from: "+447700900121", to: "+447700900000", text: "Hi" })).status,
    ).toBe(403);
  });

  it("a call with a voicemail: the call, the transcription and the end, each signed for its own address", async () => {
    const seen = serve(async (request) => {
      const fields = Object.fromEntries(new URLSearchParams(await request.text())) as Record<
        string,
        string
      >;
      const ok = isValidTwilioSignature(
        TOKEN,
        request.url,
        fields,
        request.headers.get("x-twilio-signature"),
      );
      if (!ok) return new Response("Forbidden", { status: 403 });
      return new Response(
        request.url.endsWith("/voice")
          ? '<Response><Say language="en-GB">Thanks for calling Acme Events. We&apos;ve just sent a link.</Say></Response>'
          : "<Response/>",
        { status: 200 },
      );
    });
    const call = await fakeCall(target, {
      from: "+447700900121",
      to: "+447700900000",
      voicemail: "Please call me back",
    });
    expect(call.heard).toEqual(["Thanks for calling Acme Events. We've just sent a link."]);
    expect([call.answer.status, call.voicemail?.status, call.goodbye?.status]).toEqual([
      200, 200, 200,
    ]);
    expect(seen.map((r) => r.url)).toEqual([
      "http://localhost:3000/api/webhooks/twilio/voice",
      "http://localhost:3000/api/webhooks/twilio/voice/transcription",
      "http://localhost:3000/api/webhooks/twilio/voice/done",
    ]);
    const voicemail = Object.fromEntries(new URLSearchParams(await seen[1]!.text()));
    expect(voicemail).toMatchObject({
      TranscriptionStatus: "completed",
      TranscriptionText: "Please call me back",
      From: "+447700900121",
    });
    // The same call throughout.
    const first = Object.fromEntries(new URLSearchParams(await seen[0]!.text()));
    expect(voicemail.CallSid).toBe(first.CallSid);
  });

  it("a withheld number: the call says so (From: anonymous) and the voicemail has no From", async () => {
    const seen = serve(async () => new Response("<Response/>", { status: 200 }));
    await fakeCall(target, { from: null, to: "+447700900000", voicemail: "Hello" });
    const first = Object.fromEntries(new URLSearchParams(await seen[0]!.text()));
    const voicemail = Object.fromEntries(new URLSearchParams(await seen[1]!.text()));
    expect(first.From).toBe("anonymous");
    expect(voicemail.From).toBeUndefined();
  });

  it("never anything but a local server", async () => {
    const seen = serve(async () => new Response("", { status: 200 }));
    for (const baseDomain of ["shiftdesk.example", "acme.example.com", "localhost.evil.com"]) {
      expect(isLocalBaseDomain(baseDomain)).toBe(false);
      await expect(
        fakeSms({ baseDomain, authToken: TOKEN }, { from: "+1", to: "+2", text: "x" }),
      ).rejects.toThrow(/only talks to a local server/);
    }
    expect(seen).toEqual([]);
    for (const baseDomain of ["localhost:3000", "localhost", "acme.localhost:3000"]) {
      expect(isLocalBaseDomain(baseDomain)).toBe(true);
    }
  });

  it("reads what the caller hears out of the TwiML", () => {
    expect(
      spokenWords(
        '<Response><Say language="en-GB">A &amp; B&apos;s</Say><Record/><Say>Bye</Say></Response>',
      ),
    ).toEqual(["A & B's", "Bye"]);
  });
});

describe("npm run sim:*, given the wrong options", () => {
  const sim = (...args: string[]) =>
    spawnSync("node", ["--import", "tsx", "scripts/sim.ts", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  it.each([
    [["whatsapp"]],
    [["whatsapp", "--from", "07700 900121"]],
    [["sms", "--text", "hi"]],
    [["call"]],
    [["call", "--withheld", "--from", "07700 900121"]],
    [["call", "--from", "07700 900121", "--text", "hi"]],
    [["fax", "--from", "07700 900121"]],
    [["whatsapp", "--from", "07700 900121", "--txet", "typo"]],
  ])("%j: the usage, exit 2", (args) => {
    const r = sim(...args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Usage:/);
  });
});
