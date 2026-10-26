// Doing several sends at once (P4.4; PLAN.md "Ready for a big firm"). A provider takes a few hundred
// milliseconds a message, so one at a time a wave of 50 takes 15 seconds or more while the place
// stays empty. No timers: each lane takes the next item as soon as its last one is done.

// Runs `work` on each item, at most `limit` at once, started in the items' order. `work` returning
// "stop" starts no more; the ones already started finish. An error does the same, and once every
// started one has finished the first error is thrown, so nothing is still sending when the caller
// hears of it.
export async function eachAtMost<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<"stop" | void>,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be 1 or more");
  const state: { next: number; stopped: boolean; failure?: { error: unknown } } = {
    next: 0,
    stopped: false,
  };
  const lane = async () => {
    while (!state.stopped && state.next < items.length) {
      const item = items[state.next] as T;
      state.next += 1;
      try {
        if ((await work(item)) === "stop") state.stopped = true;
      } catch (error) {
        state.failure ??= { error };
        state.stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (state.failure) throw state.failure.error;
}

// Runs the functions given to it one at a time, in the order given: each waits for the one before
// to finish, whether it succeeded or failed (a wave's claims, which a lane makes in turn).
export function oneAtATime(): <R>(fn: () => Promise<R>) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return <R>(fn: () => Promise<R>) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
}
