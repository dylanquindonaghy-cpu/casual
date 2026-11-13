import { strikeEvidenceKey } from "../../strikes/evidence-queue";
import { refText, type SeedLog, type SeedRef } from "./seed-log";

// A seeded strike's evidence email, as the job logs its first attempt (src/lib/strikes/evidence.ts):
// the claim (strike.evidence_sending), then the outcome (strike.evidence_sent), each with the
// attempt's request key, which names its series, the strike.issued entry (evidence-queue.ts). Every
// seeded strike goes through here: the history and the Saturday's (seed.ts), the match day's
// (seed-match-load.ts) and the story's (seed-story-load.ts).
export function logEvidenceSent(
  log: SeedLog,
  strikeId: string,
  issued: SeedRef,
  issuedAt: Date,
  sentAt: Date,
): void {
  const request = refText(issued, (series) => strikeEvidenceKey({ strikeId, series, attempt: 1 }));
  const sendingAt = new Date(Math.min(issuedAt.getTime() + 60_000, sentAt.getTime()));
  for (const [action, at] of [
    ["strike.evidence_sending", sendingAt],
    ["strike.evidence_sent", sentAt],
  ] as const) {
    log.add(
      {
        actorType: "system",
        action,
        entityType: "strike",
        entityId: strikeId,
        data: { request, attempt: 1 },
      },
      at,
    );
  }
}
