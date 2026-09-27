// What workers type into the login form, turned into E.164. UK formats are the norm
// (07700 900123, +44 7700 900123, 0044 7700 900123, 447700900123); any other number must be
// typed in full international form (+353 ...). Returns null for anything that isn't a number.
export function normaliseMobile(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().-]/g, "");
  let e164: string;
  if (/^07\d{9}$/.test(compact)) e164 = `+44${compact.slice(1)}`;
  else if (/^(\+44|0044|44)7\d{9}$/.test(compact))
    e164 = `+44${compact.replace(/^(\+44|0044|44)/, "")}`;
  else if (/^(\+44|0044)\(?0\)?7\d{9}$/.test(compact)) e164 = `+44${compact.slice(-10)}`;
  else if (/^(\+|00)[1-9]\d{6,14}$/.test(compact)) e164 = `+${compact.replace(/^(\+|00)/, "")}`;
  else return null;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}
