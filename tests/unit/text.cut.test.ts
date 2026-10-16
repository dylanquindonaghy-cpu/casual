import { describe, expect, it } from "vitest";
import { cutChars, cutUnits } from "@/lib/text/cut";

// The shared cut (13.5; PLAN.md Parking lot "Text cuts that count UTF-16 units"): never half a
// character, whether the limit counts characters (Postgres's char_length) or UTF-16 units (zod,
// the message transports).

const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("cutChars and cutUnits", () => {
  it("leave text within the limit as it is", () => {
    expect(cutChars("hello", 5)).toBe("hello");
    expect(cutUnits("hello", 5)).toBe("hello");
    expect(cutChars("", 3)).toBe("");
    expect(cutChars("abc", 0)).toBe("");
  });

  it("an emoji across the cut: kept whole if it fits, else left out; never half (the old slice's '�')", () => {
    const text = `${"x".repeat(1599)}😀END`;
    // The old cut: half an emoji at unit 1,600.
    expect(lone.test(text.slice(0, 1600))).toBe(true);
    // By characters: the emoji is the 1,600th character, so it's kept.
    expect(cutChars(text, 1600)).toBe(`${"x".repeat(1599)}😀`);
    // By units: it would be units 1,600 and 1,601, so it's left out whole.
    expect(cutUnits(text, 1600)).toBe("x".repeat(1599));
    for (const out of [cutChars(text, 1600), cutUnits(text, 1600)]) {
      expect(lone.test(out)).toBe(false);
    }
  });

  it("a flag, a skin tone or an accent stays whole (what a person sees as one character)", () => {
    const flag = "🇬🇧"; // two characters, four units
    expect(cutChars(`ab${flag}`, 3)).toBe("ab");
    expect(cutChars(`ab${flag}`, 4)).toBe(`ab${flag}`);
    const wave = "👋🏽"; // a hand and its skin tone
    expect(cutUnits(`a${wave}`, 3)).toBe("a");
    expect(cutUnits(`a${wave}`, 5)).toBe(`a${wave}`);
    const accented = "é"; // e and a combining accent
    expect(cutChars(`caf${accented}s`, 4)).toBe("caf");
    expect(cutChars(`caf${accented}s`, 5)).toBe(`caf${accented}`);
  });

  it("counts what each limit counts", () => {
    const emoji = "😀".repeat(10); // 10 characters, 20 units
    expect(cutChars(emoji, 10)).toBe(emoji);
    expect(cutUnits(emoji, 10)).toBe("😀".repeat(5));
    expect(cutUnits(emoji, 11)).toBe("😀".repeat(5));
    expect(Array.from(cutChars(`${emoji}${emoji}`, 15))).toHaveLength(15);
  });

  it("one character longer than the whole limit is cut by code point, so the text never vanishes", () => {
    const zalgo = `a${"́".repeat(50)}`; // one cluster of 51 characters
    expect(cutChars(zalgo, 10)).toBe(`a${"́".repeat(9)}`);
    expect(cutUnits(zalgo, 10)).toHaveLength(10);
  });
});

describe("where the shared cut is used (13.5)", () => {
  it("the AI's input: at most 1,600 characters, never half an emoji", async () => {
    const { sortMessage } = await import("@/lib/ai/classify-message");
    const prompts: string[] = [];
    const ai = {
      name: "capture",
      complete: async (r: { prompt: string }) => {
        prompts.push(r.prompt);
        return "shifts";
      },
    };
    expect(await sortMessage(`${"x".repeat(1599)}🇬🇧 more`, ai)).toEqual({ label: "shifts" });
    expect(prompts).toEqual(["x".repeat(1599)]);
  });

  it("the Enquiries list's preview: 140 characters, or 139 and an ellipsis, never half an emoji", async () => {
    const { preview } = await import("@/app/office/enquiries/enquiry-row");
    expect(preview(null)).toBeNull();
    expect(preview(`${"x".repeat(140)}`)).toBe("x".repeat(140));
    expect(preview(`${"x".repeat(138)}😀😀😀`)).toBe(`${"x".repeat(138)}😀…`);
    expect(preview(`${"x".repeat(139)}😀`)).toBe(`${"x".repeat(139)}😀`);
    const out = preview(`  ${"y".repeat(138)}\n\n🇬🇧🇬🇧 more`) ?? "";
    expect(out).toBe(`${"y".repeat(138)} …`);
    expect(lone.test(out)).toBe(false);
  });
});
