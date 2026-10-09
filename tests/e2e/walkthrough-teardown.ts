import { WALKTHROUGH_LOGS, WALKTHROUGH_OUTBOX } from "../../playwright.walkthrough.config";
import { checkRun } from "./teardown";

// After the walkthrough's run: the same checks as every e2e run (tests/e2e/teardown.ts) on its own
// outbox and its servers' output.
export default function teardown(): void {
  checkRun(WALKTHROUGH_OUTBOX, WALKTHROUGH_LOGS);
}
