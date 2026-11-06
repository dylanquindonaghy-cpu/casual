import { addBookedShift, addWorker } from "../db";

// Task 30.2's rows (tests/e2e/casual.p30-rail.spec.ts): a casual of the spec's own with one booking
// 3 days ahead, so Home has her next shift and her booked shift has its own page to open. A retry
// gets another casual (another number), so a half-finished first try never changes what it sees.
//
// Made-up people only: drama-range numbers (07700 930210 and on) no other spec uses, outside
// tests/e2e/spare-mobiles.ts's blocks (07700 900000 to 900999).

export const P30_2_SITE_PREFIX = "Rail Test Hall";

export function p30_2Casual(retry: number) {
  const last = 10 + retry;
  return {
    firstName: "Rhea",
    lastName: `Railside${retry || ""}`,
    mobileE164: `+4477009302${last}`,
    typed: `07700 9302${last}`,
  };
}

export async function addP30_2Casual(
  retry: number,
  run: string,
): Promise<{ workerId: string; shiftId: string; site: string; mobileE164: string; typed: string }> {
  const casual = p30_2Casual(retry);
  const workerId = await addWorker("acme", {
    firstName: casual.firstName,
    lastName: casual.lastName,
    mobileE164: casual.mobileE164,
  });
  const site = `${P30_2_SITE_PREFIX} ${run}`;
  const { shiftId } = await addBookedShift("acme", { workerId, daysAhead: 3, site });
  return { workerId, shiftId, site, mobileE164: casual.mobileE164, typed: casual.typed };
}
