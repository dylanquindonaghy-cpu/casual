import { appEnv } from "../env";
import { log, type Logger } from "../log";
import { alertTransport, signatureAlert, type AlertTransport, type OpsAlert } from "./alerts";

// Bad Twilio webhook signatures, counted in the web process's memory (docs/api-and-jobs.md
// "Errors and observability": "webhook signature failures spike"). The web can only queue firm
// jobs (by design: admin/jobs.ts) and a request with a bad signature proves nothing about its
// firm, and writing a row per bad request would let anyone fill the database. So: per-minute
// counts for the last hour (at most 60 numbers, however many requests arrive), and one alert when
// they reach the threshold, then at most one an hour. Per web process: a restart starts again.

const MINUTE_MS = 60_000;
const WINDOW_MINUTES = 60;

export interface SignatureCounter {
  // Counts one bad signature; returns the alert when this one sets it off (else null).
  note(): Promise<OpsAlert | null>;
}

export function createSignatureCounter(opts: {
  transport: () => AlertTransport;
  now?: () => number;
  logger?: Logger;
}): SignatureCounter {
  const now = opts.now ?? Date.now;
  const logger = opts.logger ?? log;
  const perMinute = new Map<number, number>();
  let lastAlertAt = Number.NEGATIVE_INFINITY;
  return {
    async note() {
      const t = now();
      const minute = Math.floor(t / MINUTE_MS);
      for (const m of perMinute.keys()) if (m <= minute - WINDOW_MINUTES) perMinute.delete(m);
      perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
      const count = [...perMinute.values()].reduce((sum, n) => sum + n, 0);
      if (t - lastAlertAt < WINDOW_MINUTES * MINUTE_MS) return null;
      const alert = signatureAlert(count);
      if (!alert) return null;
      lastAlertAt = t;
      try {
        await opts.transport().send(alert);
      } catch (error) {
        logger.error("ops alert failed to send", { alert: alert.kind, error });
      }
      return alert;
    },
  };
}

// The web process's own counter (src/lib/inbound/twilio-request.ts notes each bad signature).
export const badSignatures = createSignatureCounter({
  transport: () => alertTransport(appEnv().ALERTS_TRANSPORT),
});
