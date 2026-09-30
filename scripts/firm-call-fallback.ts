import { parseArgs } from "node:util";
import { callFallbackTwiml } from "../src/lib/inbound/voice";
import { toE164 } from "./shifts-line-owner";

// Prints the TwiML for a firm's call fallback (Phase 8; docs/runbooks.md, PLAN.md "Connect Twilio"
// step 10): what Twilio plays, by itself, when our app doesn't answer a call to that firm's number:
// why, then the manager's phone, then what to do if nobody answers. Paste it into a Twilio TwiML
// Bin and choose that bin as the number's "Primary handler fails". Nothing is saved or sent.
//
//   npm run -s firm:call-fallback -- --name "Acme Events" --phone "07700 900123"
//
// The name is typed here (not read from the database: this runs on your computer, and the
// production database is only reachable from the server). It's spoken on every fallback call.

const USAGE =
  'Usage: npm run firm:call-fallback -- --name "Acme Events" --phone "07700 900123" (the manager\'s mobile)';

function readArgs() {
  try {
    return parseArgs({ options: { name: { type: "string" }, phone: { type: "string" } } }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const name = values.name?.trim();
if (!name || !values.phone) {
  console.error(USAGE);
  process.exit(2);
}
// Braces are refused: a TwiML Bin fills in {{…}} from the call (a caller's number, say).
if (name.length > 80 || /[\p{Cc}{}]/u.test(name)) {
  console.error("The firm's name must be 1 to 80 characters on one line, without { or }.");
  process.exit(1);
}
const phone = toE164(values.phone);
if (!phone) {
  console.error("That isn't a phone number we can read. Use 07700 900123 or +44 7700 900123.");
  process.exit(1);
}
// A UK number is +44 then 10 digits: one short or long dials nobody (a warning, not a refusal).
if (phone.startsWith("+44") && phone.length !== 13) {
  console.error(`Check the number: ${phone} isn't the usual length for a UK number.`);
}
console.log(callFallbackTwiml({ name }, phone));
