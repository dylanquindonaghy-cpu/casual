// The token from a login link's fragment (the part after "#"), as the link page reads it. A phone's
// link detector, or someone copying the link, can take the punctuation after it too
// ("…/l#<token>." at the end of a sentence): that's never part of a token (43 letters, digits, "-"
// and "_"), so it's dropped here rather than turning a good link into "expired" (audit L10). The
// browser gives the fragment percent-encoded (a curly quote as "%E2%80%99", a space as "%20"), so
// it's decoded first (the reviews of Phase 10 task 19); a token itself has nothing to decode.
export function tokenFromFragment(hash: string): string | null {
  let raw = hash.replace(/^#/, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Not valid percent-encoding: read as it is.
  }
  raw = raw.trim();
  // A token is exactly 43 of these: whatever follows it ("…", "«", a word) isn't part of it.
  const whole = /^[A-Za-z0-9_-]{43}/.exec(raw);
  if (whole) return whole[0];
  // Shorter: punctuation off the end, and the page then says the link didn't work.
  const token = raw.replace(/[\s.,;:!?)\]}'"’”>]+$/u, "");
  return token || null;
}
