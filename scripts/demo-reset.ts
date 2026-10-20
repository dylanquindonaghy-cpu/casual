import { demoReset } from "../src/lib/db/admin/demo-reset";
import { parseDemoResetEnv } from "../src/lib/env";

// The demo server's reset (16.2; docs/runbooks.md "A demo server"): `docker compose run --rm
// demo-reset`, run by deploy/demo-reset.sh. Loads the made-up demo afresh; refuses unless this is a
// demo server (src/lib/db/admin/demo-reset.ts). Prints counts only.
const env = parseDemoResetEnv(process.env);
const summary = await demoReset({
  demoMode: env.DEMO_MODE,
  nodeEnv: env.NODE_ENV,
  adminUrl: env.DATABASE_ADMIN_URL,
  appUrl: env.DATABASE_URL,
  jobsUrl: env.DATABASE_JOBS_URL,
  ...(env.CONSOLE_OUTBOX_FILE ? { outboxFile: env.CONSOLE_OUTBOX_FILE } : {}),
});
for (const f of summary.firms) {
  console.log(
    `${f.slug}: ${f.workers} casuals, ${f.officeUsers} office users, ${f.sites} sites` +
      (f.eventDay ? `, ${f.shifts} shifts on Saturday ${f.eventDay}` : ""),
  );
}
console.log("Loaded the made-up demo afresh; the Demo phone is empty.");
