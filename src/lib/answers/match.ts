// Matching a casual's message to the firm's answers by their example phrases (Phase 35; docs/
// screens.md "## Phase 35", "The match"), in code, so it works with the AI off. Pure functions.
//
// Both sides are normalised the same way: lower case, apostrophes dropped ("didn't" is "didnt"),
// every other character that isn't a letter or a digit a space, spaces collapsed. An example matches
// when it appears in the message as a whole-word run ("when do we get paid" in "hi when do we get
// paid this week?", never "paid" inside "unpaid"). The longest matching example wins (by words,
// then characters); two answers tied for longest: none (the next step decides, or the office).

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// A message about pay going wrong (golden rule 9): never a library answer, whatever it matches; it
// goes on as today (the built-in pay link, or the office). Over normalised text. Wide on purpose: a
// word too many only means the built-in path answers instead.
export const PAY_TROUBLE =
  /\b(wrong|missing|short|shortpaid|underpaid|under paid|owed|owe|owes|owing|not paid|not been paid|never paid|havent been paid|hasnt been paid|havent got|havent had|didnt get|didnt receive|not received|hasnt come|hasnt arrived|not come|mistake|mistakes|incorrect|dispute|disputed|disputing|error)\b/;
export const aboutPayTrouble = (text: string): boolean => PAY_TROUBLE.test(normalise(text));

export interface MatchableAnswer {
  id: string;
  examples: readonly string[];
}

export function matchByExample<A extends MatchableAnswer>(
  text: string,
  answers: readonly A[],
): A | null {
  const message = ` ${normalise(text)} `;
  if (message.trim() === "") return null;
  let best: { answer: A; words: number; chars: number } | null = null;
  let tied = false;
  for (const answer of answers) {
    for (const raw of answer.examples) {
      const example = normalise(raw);
      if (example === "" || !message.includes(` ${example} `)) continue;
      const words = example.split(" ").length;
      const chars = example.length;
      if (!best || words > best.words || (words === best.words && chars > best.chars)) {
        best = { answer, words, chars };
        tied = false;
      } else if (words === best.words && chars === best.chars && best.answer.id !== answer.id) {
        tied = true;
      }
    }
  }
  return best && !tied ? best.answer : null;
}
