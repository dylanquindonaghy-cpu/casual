import { errorCode } from "../jobs/firm-job";

// A transaction Postgres aborted to break a deadlock (40P01), or a serialization failure (40001:
// only under a stricter isolation level than our READ COMMITTED, listed for safety), kept nothing,
// so it can simply run again. Only for work whose transaction holds everything it does: no network
// call, message or job outside it that a second run would repeat.
export const RETRYABLE_TRANSACTION_CODES = new Set(["40P01", "40001"]);

export async function retryAborted<T>(transaction: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await transaction();
    } catch (err) {
      if (attempt >= attempts || !RETRYABLE_TRANSACTION_CODES.has(errorCode(err))) throw err;
    }
  }
}
