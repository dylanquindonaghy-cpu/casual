import { readFile } from "node:fs/promises";

// The outbox's messages so far, oldest first: whole lines only. The console transport appends each
// message as one JSON line ending in "\n" (src/lib/messaging/console.ts), and a long one (an email
// with its attachments) can be read while it's still being written: that part is left for the
// next read. A whole line that isn't JSON still throws.
export async function readOutbox<T>(outbox = ".dev/e2e-outbox.jsonl"): Promise<T[]> {
  const text = await readFile(outbox, "utf8").catch(() => "");
  return text
    .slice(0, text.lastIndexOf("\n") + 1)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

// Reads the console transport's outbox (see playwright.config.ts): the newest message to a number
// after a given moment whose body matches `pattern`. Waits up to 20 seconds: the worker sends
// messages in the background.
export async function sentTo(
  mobile: string,
  after: Date,
  pattern: RegExp,
  outbox = ".dev/e2e-outbox.jsonl",
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const lines = await readOutbox<{ at: string; to: string; body: string }>(outbox);
    const match = lines
      .filter((l) => l.to === mobile && new Date(l.at) >= after)
      .map((l) => pattern.exec(l.body)?.[1])
      .filter(Boolean)
      .at(-1);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing matching ${pattern} sent to ${mobile}`);
}

export const loginLinkSentTo = (mobile: string, after: Date) =>
  sentTo(mobile, after, /(https?:\/\/\S+\/l#[A-Za-z0-9_-]{43})/);

export const codeSentTo = (mobile: string, after: Date) =>
  sentTo(mobile, after, /code is (\d{6})\./);

export interface SentEmail {
  at: string;
  to: string;
  subject: string;
  body: string;
  attachments?: { filename: string; contentType: string; content: string }[];
}

// The newest email to an address after a given moment whose subject matches `pattern`, whole
// (attachments included). Waits up to 20 seconds, like sentTo.
export async function emailSentTo(
  address: string,
  after: Date,
  pattern: RegExp,
  outbox = ".dev/e2e-outbox.jsonl",
): Promise<SentEmail> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const match = (await readOutbox<SentEmail & { channel: string }>(outbox))
      .filter(
        (l) =>
          l.channel === "email" &&
          l.to === address &&
          new Date(l.at) >= after &&
          pattern.test(l.subject),
      )
      .at(-1);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email matching ${pattern} sent to ${address}`);
}
