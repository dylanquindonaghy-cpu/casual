import { homeScene } from "../db";

// Task 28.1's rows (Phase 28; tests/e2e/casual.p28-look.spec.ts): Home's scene (tests/e2e/db.ts
// `homeScene`, imported, never edited) for a casual of this spec's own, so every page it looks at
// has something on it: her next shift as the pass and on Booked, an urgent open shift in her role
// (Open shifts, and a shift's own page with Take shift), a "Do this" row for her overdue staff photo
// and the count it puts on Profile's tab. A rerun starts the same way (homeScene cancels its last
// run's sessions first). Made-up details only: a drama-range number no other spec uses.
export const P28_1_CASUAL = {
  firstName: "Tess",
  lastName: "Marlowe",
  mobileE164: "+447700900281",
} as const;
// As she types it on the login page.
export const P28_1_TYPED = "07700 900281";

export function lookScene(): ReturnType<typeof homeScene> {
  return homeScene("acme", P28_1_CASUAL);
}
