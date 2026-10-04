// What workers type into the login form, turned into E.164. UK formats are the norm
// (07700 900123, +44 7700 900123, 0044 7700 900123, 447700900123); any other number must be
// typed in full international form (+353 ...). Returns null for anything that isn't a mobile we
// can text: a UK number must be a mobile (07…), so a landline or premium number written as
// +44 20… is refused as 020… is (audit L68), and an international number needs 9 to 15 digits.
export function normaliseMobile(raw: string): string | null {
  // "+353 (0)85 …": the (0) after a country code is what you'd dial at home, not part of it.
  const compact = raw
    .trim()
    .replace(/^((?:\+|00)[1-9]\d{0,2})\s*\(0\)/, "$1")
    .replace(/[\s().-]/g, "");
  let e164: string;
  if (/^07\d{9}$/.test(compact)) e164 = `+44${compact.slice(1)}`;
  else if (/^(\+44|0044|44)7\d{9}$/.test(compact))
    e164 = `+44${compact.replace(/^(\+44|0044|44)/, "")}`;
  else if (/^(\+44|0044)\(?0\)?7\d{9}$/.test(compact)) e164 = `+44${compact.slice(-10)}`;
  else if (/^(\+44|0044)/.test(compact)) return null;
  else if (/^(\+|00)[1-9]\d{8,14}$/.test(compact)) e164 = `+${compact.replace(/^(\+|00)/, "")}`;
  else return null;
  return /^\+[1-9]\d{8,14}$/.test(e164) ? e164 : null;
}

// A mobile as a spreadsheet holds it (an import file, a firm's Google Sheet): as typed, or a UK
// mobile whose leading 0 the spreadsheet dropped because the cell was a number (7700900123).
// The one reader for every import path.
export function spreadsheetMobile(raw: string): string | null {
  const s = raw.trim();
  return normaliseMobile(/^7\d{9}$/.test(s) ? `0${s}` : s);
}
