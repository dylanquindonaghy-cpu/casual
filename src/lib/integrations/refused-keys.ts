// Refused API keys, counted per client address in the web process's memory (docs/office-v2.md
// 5.3.2 "Before the look-up"), as bad Twilio signatures are (src/lib/ops/signature-spike.ts). A
// refused key proves nothing about a firm, so throttle() (which counts inside a firm) can't count
// it, and a row per refusal would let anyone fill the database. After REFUSED_KEYS_PER_MINUTE
// refusals in one minute, the address is answered 429 before any look-up until the minute ends.
//
// The address is clientIpFrom()'s key (X-Real-IP, set by Caddy; an IPv6 /64 counts as one). One
// fixed window, the current minute: a new minute starts every count again. At most MAX_ADDRESSES
// are counted in a minute; past that, a new address isn't counted (its refused keys still never
// reach the database unless they have the right shape, and a right-shaped key can't be guessed).
// Per web process: a restart starts again.

export const REFUSED_KEYS_PER_MINUTE = 30;
const MAX_ADDRESSES = 10_000;
const MINUTE_MS = 60_000;

export interface RefusedKeyCounter {
  // The seconds this address must wait, or null when it may try.
  blocked(address: string, nowMs: number): { retryAfterSeconds: number } | null;
  // Counts one refused key from this address.
  note(address: string, nowMs: number): void;
  reset(): void;
}

export function createRefusedKeyCounter(
  opts: { max?: number; maxAddresses?: number } = {},
): RefusedKeyCounter {
  const max = opts.max ?? REFUSED_KEYS_PER_MINUTE;
  const maxAddresses = opts.maxAddresses ?? MAX_ADDRESSES;
  let minute = Number.NaN;
  const counts = new Map<string, number>();
  const turn = (nowMs: number) => {
    const m = Math.floor(nowMs / MINUTE_MS);
    if (m !== minute) {
      minute = m;
      counts.clear();
    }
  };
  return {
    blocked(address, nowMs) {
      turn(nowMs);
      if ((counts.get(address) ?? 0) < max) return null;
      return {
        retryAfterSeconds: Math.max(1, Math.ceil(((minute + 1) * MINUTE_MS - nowMs) / 1000)),
      };
    },
    note(address, nowMs) {
      turn(nowMs);
      const n = counts.get(address);
      if (n === undefined && counts.size >= maxAddresses) return;
      counts.set(address, (n ?? 0) + 1);
    },
    reset() {
      minute = Number.NaN;
      counts.clear();
    },
  };
}

// The web process's own counter (src/lib/integrations/api.ts).
export const refusedKeys = createRefusedKeyCounter();
