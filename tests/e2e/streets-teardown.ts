import { STREETS_LOGS, STREETS_OUTBOX } from "../../playwright.streets.config";
import { checkRun } from "./teardown";

// After the street-map run: the same checks as every e2e run (tests/e2e/teardown.ts) on its own
// outbox and its servers' output.
export default function teardown(): void {
  checkRun(STREETS_OUTBOX, STREETS_LOGS);
}
