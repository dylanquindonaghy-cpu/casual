import { addBookedShift, messagesScene } from "../db";

// Task 28.6's rows (Phase 28; tests/e2e/casual.p28-message-office.spec.ts): a casual of this
// spec's own with Messages as new (tests/e2e/db.ts `messagesScene`: none of her messages in the
// app, Messages never opened, her messages' limit cleared) and a steward's shift she's booked on in
// two days, at a site of this run's own (`addBookedShift`, imported, never edited), for Messages
// opened about it. A rerun starts the same way, with a new shift. Made-up details only: a
// drama-range number no other spec uses.
export const P28_6_CASUAL = {
  firstName: "Nell",
  lastName: "Asker",
  mobileE164: "+447700900286",
} as const;
// As she types it on the login page.
export const P28_6_TYPED = "07700 900286";

export async function messageOfficeScene(
  tag: string,
): Promise<{ workerId: string; shiftId: string; site: string }> {
  const workerId = await messagesScene("acme", P28_6_CASUAL);
  const site = `Message Office Arena ${tag}`;
  const { shiftId } = await addBookedShift("acme", { workerId, daysAhead: 2, site });
  return { workerId, shiftId, site };
}
