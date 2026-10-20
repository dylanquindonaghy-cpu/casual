import { officeUsers, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { isMadeUpEmail, isMadeUpMobile } from "./made-up";

// How many of this firm's people (casuals and office team) have a number or email that isn't made
// up (src/lib/demo/made-up.ts): the demo-mode worker's check (src/lib/demo/guard.ts). Inside the
// firm's withFirm transaction. Each person counts once.
export async function realPeopleIn(tx: FirmTx): Promise<number> {
  const casuals = await tx
    .select({ mobile: workers.mobileE164, email: workers.email })
    .from(workers);
  const office = await tx.select({ email: officeUsers.email }).from(officeUsers);
  const real = (mobile: string | null, email: string | null) =>
    (mobile !== null && !isMadeUpMobile(mobile)) || (email !== null && !isMadeUpEmail(email));
  return (
    casuals.filter((c) => real(c.mobile, c.email)).length +
    office.filter((o) => real(null, o.email)).length
  );
}
