// The drama-range numbers (07700 900000 to 900999) the browser specs hand out at run time
// (unusedMobile in tests/e2e/db.ts), one block per use. No spec, no seeded casual and no shifts line
// has a fixed number inside any of them (tests/unit/e2e.spare-mobiles.test.ts checks), so a number
// picked here can never be one a later spec adds as its own casual.
//
// Why: comingUpScene used to pick from 900800-900869, the same block several Phase 28 specs had
// fixed casuals in (28.9's Idris on 900829). When it ran first and picked 900829, 28.9's spec
// found that casual (onConflictDoNothing kept the first) and saw another name on its request:
// main's CI failed on #42.
// No imports: the unit test reads it too.
export const SPARE_MOBILES = {
  // comingUpScene's stewards, and office.dashboard's cancelled one.
  stewards: [1, 69],
  // office.dashboard's photo sender.
  photo: [70, 99],
  // whatsapp.inbound's stranger.
  stranger: [201, 240],
  // 28.3's two briefing casuals.
  briefing: [241, 260],
} as const satisfies Record<string, readonly [number, number]>;

export type SpareBlock = keyof typeof SPARE_MOBILES;

// A block's number `n` (0 to 999) as E.164.
export const dramaMobile = (n: number) => `+447700900${String(n).padStart(3, "0")}`;
