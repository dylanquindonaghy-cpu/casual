// Cutting text to a length without breaking a character (13.5; PLAN.md Parking lot "Text cuts that
// count UTF-16 units"). A JavaScript string counts UTF-16 units, and an emoji is two of them, so
// `.slice(0, n)` can cut one in half: the half left over is stored as "�", and jsonb refuses it
// outright. These cut only between characters as a person sees them (an emoji with its skin tone,
// a flag, a letter with its accent: grapheme clusters), so nothing is ever half there. Pure.
//
// - cutChars(text, max): at most `max` characters (Unicode code points), the count Postgres's
//   char_length uses (the messages_body_length check).
// - cutUnits(text, max): at most `max` UTF-16 units, the count `.length`, zod's .max() and the
//   message transports use.
//
// One cluster longer than the whole budget (a letter under thousands of accents) is cut by code
// point instead, so text never vanishes altogether.

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

const codePoints = (s: string) => Array.from(s).length;

function cutBy(text: string, max: number, size: (s: string) => number): string {
  if (max <= 0) return "";
  let out = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const n = size(segment);
    if (used + n <= max) {
      out += segment;
      used += n;
      continue;
    }
    if (out === "") {
      // The first cluster alone is over the budget: whole code points of it.
      for (const point of segment) {
        if (used + size(point) > max) break;
        out += point;
        used += size(point);
      }
    }
    break;
  }
  return out;
}

export function cutChars(text: string, max: number): string {
  // Within the units, within the characters: nothing to cut.
  if (text.length <= max) return text;
  return cutBy(text, max, codePoints);
}

export function cutUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  return cutBy(text, max, (s) => s.length);
}
