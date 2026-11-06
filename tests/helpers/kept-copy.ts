// What a page's markup shows in the copy kept for no signal (public/sw.js unhides
// [data-offline-notice]; globals.css then hides every [data-online-only] and shows every
// [data-offline-only]), and what it shows online: the markup with the other copy's elements taken
// out, whole. For renderToStaticMarkup's output (well formed: every element closed, void ones
// self-closed or HTML's void list).

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

function without(html: string, attr: string): string {
  let out = "";
  let skip = 0;
  for (const m of html.matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*>|[^<]+/g)) {
    const token = m[0];
    const name = (m[1] ?? "").toLowerCase();
    const isTag = token.startsWith("<");
    const closing = token.startsWith("</");
    const selfClosed = isTag && !closing && (token.endsWith("/>") || VOID.has(name));
    if (skip > 0) {
      if (isTag && !closing && !selfClosed) skip++;
      if (closing) skip--;
      continue;
    }
    if (isTag && !closing && new RegExp(`\\s${attr}(=|\\s|>|/)`).test(token)) {
      if (!selfClosed) skip = 1;
      continue;
    }
    out += token;
  }
  return out;
}

export const keptCopy = (html: string) => without(html, "data-online-only");
export const onlineCopy = (html: string) => without(html, "data-offline-only");

// Its words, as read: tags out, entities for ' and & back, spaces squeezed.
export const wordsOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Every whole element (its tags and all inside it) whose opening tag matches `open`.
export function elementsWhere(html: string, open: RegExp): string[] {
  const found: string[] = [];
  const tokens = [...html.matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*>|[^<]+/g)];
  tokens.forEach((m, i) => {
    const token = m[0];
    if (!token.startsWith("<") || token.startsWith("</") || !open.test(token)) return;
    const name = (m[1] ?? "").toLowerCase();
    if (token.endsWith("/>") || VOID.has(name)) {
      found.push(token);
      return;
    }
    let depth = 0;
    let out = "";
    for (const t of tokens.slice(i)) {
      const tag = t[0];
      const tagName = (t[1] ?? "").toLowerCase();
      out += tag;
      if (!tag.startsWith("<")) continue;
      if (tag.startsWith("</")) depth--;
      else if (!(tag.endsWith("/>") || VOID.has(tagName))) depth++;
      if (depth === 0) break;
    }
    found.push(out);
  });
  return found;
}
