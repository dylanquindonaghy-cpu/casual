import { NO_TEXTS_LOGS, NO_TEXTS_OUTBOX } from "../../playwright.no-texts.config";
import { checkRun } from "./teardown";

// After the run with no text sender: the same checks as every e2e run (tests/e2e/teardown.ts) on
// its own outbox and its servers' output.
export default function teardown(): void {
  checkRun(NO_TEXTS_OUTBOX, NO_TEXTS_LOGS);
}
