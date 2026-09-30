import { z } from "zod";
import { alertTransport, testAlert } from "../src/lib/ops/alerts";

// Sends one test alert through ALERTS_TRANSPORT (docs/runbooks.md "Alerts from the app"), to check
// alerts reach you: "console" (the default) prints it as the log line the app writes. Needs no
// database. On the server: docker compose exec worker npm run -s ops:test-alert
//
//   npm run -s ops:test-alert

const parsed = z
  .enum(["console", "none"])
  .optional()
  .safeParse(process.env.ALERTS_TRANSPORT || undefined);
if (!parsed.success) {
  console.error("ALERTS_TRANSPORT must be console or none.");
  process.exit(2);
}
const transport = alertTransport(parsed.data);
await transport.send(testAlert());
console.log(
  transport.name === "none"
    ? "ALERTS_TRANSPORT is none: nothing was sent."
    : `Sent a test alert through ${transport.name}.`,
);
