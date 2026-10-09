import type { AiClient, AiRequest } from "./client";

// Asking the AI with a time limit (docs/architecture.md "Where AI is used"): the model's answer,
// unchecked (the caller checks it before any use), or null when there's no AI, it fails, or it
// doesn't answer in time. A client that never answers must never stall a job, whichever client is
// plugged in. Through Promise.resolve, so a client that throws at once or answers a plain value
// (breaking its type) still counts: a failure, or an answer to check. A late answer is ignored
// (and its failure swallowed) once the time is up; the timer is always cleared.

export const AI_TIMEOUT_MS = 5000;

class AiTimeout extends Error {}

export async function askAi(
  ai: AiClient,
  request: AiRequest,
  timeoutMs: number = AI_TIMEOUT_MS,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = Promise.resolve().then(() => ai.complete(request));
    answer.catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiTimeout()), timeoutMs);
    });
    return await Promise.race([answer, timeout]);
  } catch {
    return null; // not connected, timed out, refused or broken
  } finally {
    clearTimeout(timer);
  }
}
