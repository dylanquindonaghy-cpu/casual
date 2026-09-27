import { readFile } from "node:fs/promises";

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
    const text = await readFile(outbox, "utf8").catch(() => "");
    const lines = text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { at: string; to: string; body: string });
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
