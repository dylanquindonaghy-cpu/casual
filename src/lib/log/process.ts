import type { Logger } from "./index";

type ProcessLike = Pick<NodeJS.EventEmitter, "on">;

// The web app's promises that fail with nobody waiting (an unhandled rejection) and errors nobody
// caught: Next.js prints them as plain text and keeps running, so they reached no JSON log line and
// no e2e run failed on them (audit L64, guardrails review). Logged through the masker as errors
// too; Next's own handling is left as it is (no exit). The worker has its own, which exits
// (src/worker/index.ts).
export function logProcessErrors(logger: Logger, target: ProcessLike = process): void {
  target.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandled rejection in the web app", { error: reason });
  });
  target.on("uncaughtException", (err: unknown) => {
    logger.error("uncaught exception in the web app", { error: err });
  });
}
