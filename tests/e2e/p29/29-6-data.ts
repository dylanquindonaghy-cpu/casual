import { addBookedShift, addWorker } from "../db";

// Task 29.6's rows (tests/e2e/casual.p29-offline.spec.ts): a casual of the spec's own with one
// booking 3 days ahead, so Home has her next shift and a copy is kept for no signal. A retry gets
// another casual (another number), so a half-finished first try never changes what it sees.
//
// Made-up people only: drama-range numbers no other spec uses.

export const P29_6_SITE_PREFIX = "No Signal Test Hall";

export function p29_6Casual(retry: number) {
  const last = 10 + retry;
  return {
    firstName: "Zoe",
    lastName: `Nosignal${retry || ""}`,
    mobileE164: `+4477009296${last}`,
    typed: `07700 9296${last}`,
  };
}

export async function addP29_6Casual(
  retry: number,
  run: string,
): Promise<{ workerId: string; site: string; mobileE164: string; typed: string }> {
  const casual = p29_6Casual(retry);
  const workerId = await addWorker("acme", {
    firstName: casual.firstName,
    lastName: casual.lastName,
    mobileE164: casual.mobileE164,
  });
  const site = `${P29_6_SITE_PREFIX} ${run}`;
  await addBookedShift("acme", { workerId, daysAhead: 3, site });
  return { workerId, site, mobileE164: casual.mobileE164, typed: casual.typed };
}
