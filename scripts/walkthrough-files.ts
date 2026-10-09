import { mkdir, writeFile } from "node:fs/promises";
import { seedFirms } from "../src/lib/db/admin/seed-data";
import { addDays, localDateOf } from "../src/lib/time/zoned";

// `npm run walkthrough:files`: the two files docs/walkthrough.md imports (Phase 10 task 20), dated
// from today, so they're never out of date: a rota of shifts two weeks ahead, and a pay file for a
// demo worker. Fake data only (golden rule 7): the names and numbers are the demo seed's. Written
// to .dev/walkthrough/ (gitignored). The walkthrough's browser test uses the same files.

const TZ = "Europe/London";
const uk = (isoDate: string) => isoDate.split("-").reverse().join("/");

export const PAY_FILE_WORKER = { mobile: "07700 900122", index: 22 }; // Acme's free steward

export function walkthroughFiles(now: Date): { shifts: string; pay: string } {
  const today = localDateOf(now, TZ);
  const acme = seedFirms(now).find((f) => f.slug === "acme");
  const worker = acme?.workers[PAY_FILE_WORKER.index];
  if (!worker) throw new Error("the demo seed has no Acme worker 22");
  const shifts = [
    "Date,Start,End,Role,Needed",
    `${uk(addDays(today, 14))},09:00,17:00,Steward,3`,
    `${uk(addDays(today, 14))},08:00,18:00,Security officer,2`,
  ].join("\n");
  // A week ending 3 days ago at the new steward rate, paid yesterday.
  const pay = [
    "Mobile,Name,Period start,Period end,Hours,Rate,Gross pay,Pay date",
    `${PAY_FILE_WORKER.mobile},${worker.firstName} ${worker.lastName},${uk(addDays(today, -9))},${uk(addDays(today, -3))},12.5,13.50,168.75,${uk(addDays(today, -1))}`,
  ].join("\n");
  return { shifts: `${shifts}\n`, pay: `${pay}\n` };
}

// Run as a script: write them.
if (process.argv[1]?.endsWith("walkthrough-files.ts")) {
  const files = walkthroughFiles(new Date());
  await mkdir(".dev/walkthrough", { recursive: true });
  await writeFile(".dev/walkthrough/shifts.csv", files.shifts);
  await writeFile(".dev/walkthrough/pay.csv", files.pay);
  console.log("Written: .dev/walkthrough/shifts.csv and .dev/walkthrough/pay.csv");
  console.log("To see them in Windows: cd .dev/walkthrough && explorer.exe . ; cd ../..");
}
