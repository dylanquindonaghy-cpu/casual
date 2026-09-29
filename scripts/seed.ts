import { adminEnv } from "../src/lib/env";
import { seed } from "../src/lib/db/admin/seed";

// The two demo firms from docs/testing.md: Acme Events and Northline Rail Labour. Fake data
// only (golden rule 7). Refuses production and any database not on this machine.
const env = adminEnv();
const summary = await seed({
  adminUrl: env.DATABASE_ADMIN_URL,
  appUrl: env.DATABASE_URL,
  nodeEnv: env.NODE_ENV,
});
for (const f of summary.firms) {
  console.log(
    `${f.slug}: ${f.workers} workers, ${f.credentials} credentials, ${f.sites} sites, ${f.officeUsers} office users` +
      (f.eventDay ? `, ${f.shifts} shifts on Saturday ${f.eventDay}` : ""),
  );
}
const urgent = summary.firms.find((f) => f.urgentShiftId);
if (urgent) {
  console.log(
    `Urgent dropout (a door supervisor shift): http://${urgent.slug}.localhost:3000/shifts/${urgent.urgentShiftId}`,
  );
}
console.log("Seed loaded. Try http://acme.localhost:3000 and http://northline.localhost:3000");
