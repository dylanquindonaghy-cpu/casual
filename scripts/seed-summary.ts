import type { SeedSummary } from "../src/lib/db/admin/seed";

// What `npm run db:seed` and `npm run db:reset` print when the demo is loaded (docs/walkthrough.md
// steps 7 and 18 use the urgent dropout's link).
export function printSeedSummary(summary: SeedSummary): void {
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
}
