import { writeFileSync } from "node:fs";

// The worker's sign of life for its container's health check (deploy/docker-compose.yml): once it
// has started and taken its jobs, it writes the time to a file every 15 seconds, and the check says
// healthy only while that file is fresh. A worker that keeps crashing, or hangs, never gets there,
// so `docker compose up --wait` (deploy.sh) fails loudly instead of reporting it started (Phase 10
// task 17, adversarial review). Returns a stop function.
export const HEARTBEAT_EVERY_MS = 15_000;

export function startHeartbeat(
  file: string,
  write: (file: string, text: string) => void = writeFileSync,
  now: () => number = Date.now,
): () => void {
  const beat = () => write(file, String(now()));
  beat();
  const timer = setInterval(beat, HEARTBEAT_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
