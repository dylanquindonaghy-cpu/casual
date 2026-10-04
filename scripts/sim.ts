import { parseArgs } from "node:util";
import { appEnv } from "../src/lib/env";
import { fakeCall, fakeSms, fakeWhatsApp, isLocalBaseDomain } from "./fake-phone";
import { toE164 } from "./shifts-line-owner";

// `npm run sim:whatsapp`, `sim:sms` and `sim:call`: the fake phone (scripts/fake-phone.ts) from the
// terminal, for trying the shifts line on your own computer (docs/walkthrough.md). Needs
// `npm run dev` running and a made-up TWILIO_AUTH_TOKEN in .env. Replies show in the `npm run dev`
// terminal.
//
//   npm run -s sim:whatsapp -- --from "07700 900121" --text "Any shifts this weekend?"
//   npm run -s sim:sms -- --from "07700 900121" --text "STOP"
//   npm run -s sim:call -- --from "07700 900121" --voicemail "Please call me about Saturday"
//   npm run -s sim:call -- --withheld
//
// --to is the firm's shifts line: Acme's demo line (07700 900000) unless you give another.

const ACME_LINE = "+447700900000";
const kind = process.argv[2];
const USAGE = [
  "Usage:",
  '  npm run -s sim:whatsapp -- --from "07700 900121" --text "Any shifts this weekend?"',
  '  npm run -s sim:sms -- --from "07700 900121" --text "Any shifts?"',
  '  npm run -s sim:call -- --from "07700 900121" [--voicemail "what you say after the tone"]',
  "  npm run -s sim:call -- --withheld [--voicemail ...]",
  "  (add --to \"07700 900000\" for another firm's shifts line; Acme's is the default)",
].join("\n");

function readArgs() {
  try {
    return parseArgs({
      args: process.argv.slice(3),
      options: {
        from: { type: "string" },
        to: { type: "string" },
        text: { type: "string" },
        voicemail: { type: "string" },
        withheld: { type: "boolean", default: false },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const message = kind === "whatsapp" || kind === "sms";
if (
  !(message || kind === "call") ||
  (message && (!values.text || !values.from || values.withheld)) ||
  (!message && (values.text !== undefined || Boolean(values.from) === values.withheld))
) {
  console.error(USAGE);
  process.exit(2);
}
const from = values.from ? toE164(values.from) : null;
const to = values.to ? toE164(values.to) : ACME_LINE;
if ((values.from && !from) || !to) {
  console.error("That isn't a phone number we can read. Use 07700 900121 or +44 7700 900121.");
  process.exit(1);
}

const env = appEnv();
if (!isLocalBaseDomain(env.APP_BASE_DOMAIN)) {
  console.error(
    `The fake phone only talks to a server on this computer, and APP_BASE_DOMAIN is ${env.APP_BASE_DOMAIN}.`,
  );
  process.exit(1);
}
if (!env.TWILIO_AUTH_TOKEN) {
  console.error(
    "The shifts line needs a made-up TWILIO_AUTH_TOKEN in .env (docs/walkthrough.md, step 4). Add it, restart npm run dev, then try again.",
  );
  process.exit(1);
}
const target = { baseDomain: env.APP_BASE_DOMAIN, authToken: env.TWILIO_AUTH_TOKEN };

try {
  if (kind === "call") {
    const call = await fakeCall(target, {
      from,
      to,
      ...(values.voicemail !== undefined ? { voicemail: values.voicemail } : {}),
    });
    if (call.answer.status !== 200) {
      console.error(`The server answered ${call.answer.status}: ${call.answer.body.slice(0, 200)}`);
      process.exit(1);
    }
    console.log("The caller hears:");
    for (const words of call.heard) console.log(`  "${words}"`);
    if (call.voicemail) {
      console.log(
        call.voicemail.status === 200
          ? "Voicemail left. Any reply shows in the npm run dev terminal."
          : `The voicemail wasn't taken (${call.voicemail.status}).`,
      );
    }
  } else {
    const text = values.text ?? "";
    const send = kind === "whatsapp" ? fakeWhatsApp : fakeSms;
    const answer = await send(target, { from: from ?? "", to, text });
    if (answer.status !== 200) {
      console.error(`The server answered ${answer.status}: ${answer.body.slice(0, 200)}`);
      process.exit(1);
    }
    console.log(
      `${kind === "whatsapp" ? "WhatsApp" : "Text"} sent to ${to}. Any reply shows in the npm run dev terminal within a few seconds.`,
    );
  }
} catch (err) {
  const reason = (err as { cause?: { code?: string } }).cause?.code;
  console.error(
    reason === "ECONNREFUSED"
      ? `Nothing is answering at ${env.APP_BASE_DOMAIN}: start it with npm run dev first.`
      : `The fake phone couldn't reach the server (${reason ?? "error"}).`,
  );
  process.exit(1);
}
