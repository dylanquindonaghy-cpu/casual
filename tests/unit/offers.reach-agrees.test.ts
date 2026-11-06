import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reachOf } from "@/lib/offers/reach";
import { REACH_PATH, REACH_ROWS } from "@/lib/portal/home-copy";
import { reachPrompts, type ReachFacts } from "@/lib/portal/reach-me";

// Home's "We can't reach you about shifts" (Phase 28.7; docs/screens.md "The casual app, Phase 28",
// 28.7) uses the office's own pure rule, reachOf() (src/lib/offers/reach.ts), the one that puts a
// casual under "Not offered, and why" as "unreachable". Here, over every combination of phones,
// channel, STOP, text sender and email, it says "none" exactly when the offer waves' own rule
// (src/lib/offers/candidates.ts `reached`) leaves the worker out. The waves' rule is restated below
// and held to the file's own words, so a change to either breaks this test. The waves' `texts` is
// the worker's transport (false only with MESSAGING_TRANSPORT=none: src/lib/messaging/index.ts
// noTextSender), the web app's hasTextSender() the same setting (src/lib/portal/login-way.ts).

// candidates.ts, word for word but its spacing: the closure the waves filter with.
const WAVES_SAY =
  "constreached=(r:(typeofcapped)[number])=>!opts.reachable||Number(r.phones)>0||r.email!==null||(r.sms_allowed&&opts.reachable.texts);";
const waveReaches = (
  r: { phones: number; email: string | null; sms_allowed: boolean },
  texts: boolean,
) => Number(r.phones) > 0 || r.email !== null || (r.sms_allowed && texts);

interface Case {
  phones: number;
  channel: "sms" | "email";
  smsAllowed: boolean;
  textSender: boolean;
  hasEmail: boolean;
}

function everyCase(): Case[] {
  const out: Case[] = [];
  for (const phones of [0, 1, 2])
    for (const channel of ["sms", "email"] as const)
      for (const smsAllowed of [true, false])
        for (const textSender of [true, false])
          for (const hasEmail of [true, false])
            out.push({ phones, channel, smsAllowed, textSender, hasEmail });
  return out;
}

describe("Home's 'can't reach you' agrees with the offer waves", () => {
  it("the waves' rule is still the one restated here (src/lib/offers/candidates.ts)", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/offers/candidates.ts"), "utf8");
    expect(source.replace(/\s+/g, "")).toContain(WAVES_SAY);
  });

  it("reachOf(...).how is 'none' exactly when the waves leave the worker out, in all 48 cases", () => {
    const cases = everyCase();
    expect(cases).toHaveLength(48);
    let none = 0;
    for (const c of cases) {
      const office = reachOf(c, c.textSender).how === "none";
      const waves = !waveReaches(
        {
          phones: c.phones,
          email: c.hasEmail ? "zoe@example.test" : null,
          sms_allowed: c.smsAllowed,
        },
        c.textSender,
      );
      expect(office, JSON.stringify(c)).toBe(waves);
      if (office) none++;
    }
    // Both answers happen: no phone, no email, and no text (STOP, or no text sender) for either
    // channel: 2 channels × (STOP with a sender, STOP without, no STOP without) = 6.
    expect(none).toBe(6);
  });

  it("Home's rows: 'unreachable' exactly when reachOf says none; 'alerts_off' exactly when her alerts are off", () => {
    for (const c of everyCase()) {
      for (const offerAlerts of [true, false]) {
        const facts: ReachFacts = { ...c, offerAlerts };
        const rows = reachPrompts(facts, c.textSender);
        const unreachable = reachOf(facts, c.textSender).how === "none";
        expect(rows, JSON.stringify(facts)).toEqual([
          ...(unreachable ? (["unreachable"] as const) : []),
          ...(offerAlerts ? [] : (["alerts_off"] as const)),
        ]);
      }
    }
  });

  it("the rows' words (docs/screens.md 28.7), both to Profile's How we reach you", () => {
    expect(REACH_ROWS.unreachable).toEqual({
      title: "We can't reach you about shifts",
      sub: "You'll miss offers and changes to your shifts. Choose how we reach you.",
    });
    expect(REACH_ROWS.alerts_off).toEqual({
      title: "Open-shift alerts are off",
      sub: "We won't tell you about open shifts. Turn them on.",
    });
    expect(REACH_PATH).toBe("/profile#notify-heading");
    // Profile's section keeps that id (folded or not), so the link lands on it: since 28.11 the
    // section is a fold, which puts its headingId on the heading (portal.profile.test.ts renders
    // it and finds <h2 id="notify-heading">).
    expect(readFileSync(join(process.cwd(), "src/app/profile/profile-view.tsx"), "utf8")).toMatch(
      /headingId="notify-heading"/,
    );
    expect(readFileSync(join(process.cwd(), "src/app/profile/fold.tsx"), "utf8")).toMatch(
      /<h2 id=\{headingId\}/,
    );
  });
});
