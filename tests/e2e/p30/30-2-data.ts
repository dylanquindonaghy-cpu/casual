import { addBookedShift, addWorker } from "../db";

// Task 30.2's rows (tests/e2e/casual.p30-rail.spec.ts): a casual of the spec's own with one booking
// 3 days ahead, so Home has her next shift and her booked shift has its own page to open. A retry
// gets another casual (another number), so a half-finished first try never changes what it sees.
//
// Made-up people only: Ofcom's drama range (07700 900000 to 900999), 07700 900340 and on (one a
// retry), which no other spec, seeded casual or shifts line uses (the seed's casuals are 900100 to
// 900159 and 900300 to 900329, its story's 900400 on) and which sit outside
// tests/e2e/spare-mobiles.ts's blocks (the numbers handed out at run time).

export const P30_2_SITE_PREFIX = "Rail Test Hall";

export function p30_2Casual(retry: number) {
  const n = 340 + retry; // 900340 to 900349
  return {
    firstName: "Rhea",
    lastName: `Railside${retry || ""}`,
    mobileE164: `+447700900${n}`,
    typed: `07700 900${n}`,
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
