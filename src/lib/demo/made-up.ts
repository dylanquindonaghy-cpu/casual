// What counts as a made-up phone number or email address (16.1; ADR-025; golden rule 7). A demo
// server holds made-up people only: its casuals' numbers in Ofcom's range kept for drama
// (07700 900000 to 07700 900999), never given to a real phone, and every email address on a
// domain reserved for examples (example.com, example.org: RFC 2606) or a reserved top-level name
// (.example, .test, .invalid, .localhost), which never reach a real inbox: the same domains the
// repository's own check allows (tests/unit/repo.made-up-data.test.ts). The seed's people all are
// (tests/unit/demo.made-up.test.ts). Anyone else in a demo firm, e.g. a visitor's import of
// real staff, stops demo mode's worker (src/lib/demo/guard.ts).

export const isMadeUpMobile = (e164: string): boolean => /^\+447700900\d{3}$/.test(e164);

const EXAMPLE_DOMAINS = ["example.com", "example.org"];
const RESERVED_TOP_LEVEL = ["example", "test", "invalid", "localhost"];

export function isMadeUpEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  const under = (name: string) => domain === name || domain.endsWith(`.${name}`);
  return EXAMPLE_DOMAINS.some(under) || RESERVED_TOP_LEVEL.some(under);
}
