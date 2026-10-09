import { maskText, redact } from "./mask";

// Next.js and Node print uncaught errors themselves, with console.error/console.warn and the raw
// error (a drizzle error's message holds the SQL and every parameter). Route those two through
// the masker so nothing printed outside our logger leaks personal data either.

type ConsoleLike = Pick<Console, "error" | "warn">;
const wrapped = new WeakSet<object>();

const safe = (arg: unknown): unknown => (typeof arg === "string" ? maskText(arg) : redact(arg));

export function routeConsoleThroughMasking(target: ConsoleLike = console): void {
  for (const method of ["error", "warn"] as const) {
    const original = target[method];
    if (wrapped.has(original)) continue;
    const masked = (...args: unknown[]) => original.apply(target, args.map(safe));
    wrapped.add(masked);
    target[method] = masked;
  }
}
