import { seedId } from "../../demo/seed-id";
import { mayMessageNow, type QuietHours } from "../../rules/quiet-hours";
import { localDateOf, mondayOf, startOfDay, zonedToUtc } from "../../time/zoned";

// The two demo firms from docs/testing.md. Fake data only (golden rule 7): invented firms,
// sites and people; phone numbers from Ofcom's drama range (+447700900000-999); emails at
// example.com; credential numbers that start with TEST-. Deterministic, so every run (and every
// machine) produces the same ids and rows. Later phases add shifts, requests and pay data.

// A stable UUID derived from a name (src/lib/demo/seed-id.ts, shared with demo mode), so re-running
// the seed updates rows instead of duplicating them.
export { seedId };

// A small seeded random generator (mulberry32), for varied but repeatable data.
export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Amira",
  "Ben",
  "Chloe",
  "Daniel",
  "Ella",
  "Femi",
  "Grace",
  "Harry",
  "Isla",
  "Jamal",
  "Kasia",
  "Liam",
  "Maya",
  "Nathan",
  "Olu",
  "Priya",
  "Quinn",
  "Ruth",
  "Sam",
  "Tomasz",
  "Uma",
  "Vikram",
  "Wes",
  "Yasmin",
  "Zoe",
  "Aled",
  "Bea",
  "Callum",
  "Dev",
  "Erin",
];
const LAST = [
  "Adeyemi",
  "Barker",
  "Chowdhury",
  "Doyle",
  "Evans",
  "Fraser",
  "Gill",
  "Hughes",
  "Iqbal",
  "Jones",
  "Khan",
  "Lewis",
  "Morgan",
  "Nowak",
  "Okafor",
  "Patel",
  "Quigley",
  "Reid",
  "Singh",
  "Taylor",
  "Usman",
  "Vaughan",
  "Walsh",
  "Young",
  "Zielinski",
];

// The firm's strikes team, confirmed (docs/office-v2.md 3.10; the demo story, 12I.1): confirmed at
// midnight (London) 60 days before the seed day, before any of the story's strike evidence went to
// it, and the same on a re-run the same day.
export const STRIKES_TEAM = "strikes@acme-events.example";
export function storyStrikesSettings(today: Date): Record<string, unknown> {
  const [year = 2000, month = 1, day = 1] = localDateOf(
    new Date(today.getTime() - 60 * 86_400_000),
    "Europe/London",
  )
    .split("-")
    .map(Number);
  const midnight = zonedToUtc({ year, month, day, hour: 0, minute: 0 }, "Europe/London");
  return { email: STRIKES_TEAM, email_verified_at: midnight.toISOString() };
}

export interface SeedFirm {
  id: string;
  name: string;
  slug: string;
  sector: "security" | "rail"; // its credential pack (src/lib/rules/packs.ts) is applied too
  settings: Record<string, unknown>;
  // A fake shifts line (Ofcom's drama range) for the demo's dashboard; Northline has none yet.
  shiftsLine: string | null;
  // Its brand colour on the portal (no logo: a logo is an https:// address on the firm's site).
  brandColour: string;
  sites: { id: string; name: string; town: string; postcode: string }[];
  officeUsers: {
    id: string;
    email: string;
    name: string;
    role: "admin" | "resourcer" | "payroll";
  }[];
  workers: {
    id: string;
    firstName: string;
    lastName: string;
    mobileE164: string;
    email: string | null;
    roles: string[];
  }[];
  credentials: {
    id: string;
    workerId: string;
    type: string;
    number: string | null;
    expiresOn: string | null; // yyyy-mm-dd
    status: "valid" | "expired" | "applied";
  }[];
}

const day = (today: Date, offsetDays: number) =>
  new Date(today.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);

// The demo story's own casuals (seed-story.ts, 12I.1): no generated worker may share one of these
// names.
export const STORY_NAMES: readonly (readonly [string, string])[] = [
  ["Zoe", "Adeyemi"],
  ["Kieran", "Doyle"],
  ["Ben", "Fraser"],
  ["Priya", "Shah"],
  ["Leah", "Ward"],
  ["Jamal", "Morgan"],
  ["Mo", "Rahman"],
  ["Tom", "Hale"],
];

// Every first/last name pair, shuffled with the seeded generator, so names never repeat
// within a firm (two identical names on a demo dashboard confuse people). A pair the story uses is
// swapped for the next unused one after the list, so only that worker's name changes.
function uniqueNames(count: number, seed: number): [string, string][] {
  const pairs = FIRST.flatMap((f) => LAST.map((l): [string, string] => [f, l]));
  const r = rng(seed);
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const a = pairs[i];
    const b = pairs[j];
    if (a && b) [pairs[i], pairs[j]] = [b, a];
  }
  const story = new Set(STORY_NAMES.map(([f, l]) => `${f} ${l}`));
  const taken = (p: [string, string]) => story.has(`${p[0]} ${p[1]}`);
  const spare = pairs.slice(count).filter((p) => !taken(p));
  return pairs.slice(0, count).map((p) => (taken(p) ? (spare.shift() ?? p) : p));
}

function people(
  slug: string,
  count: number,
  firstNumber: number,
  seed: number,
  roles: (i: number) => string[],
): SeedFirm["workers"] {
  const names = uniqueNames(count, seed);
  return Array.from({ length: count }, (_, i) => {
    const [firstName, lastName] = names[i] ?? ["Sam", "Taylor"];
    return {
      id: seedId(`${slug}/worker/${i}`),
      firstName,
      lastName,
      mobileE164: `+447700900${String(firstNumber + i).padStart(3, "0")}`,
      email: i % 3 === 0 ? `${slug}.worker${i}@example.com` : null,
      roles: roles(i),
    };
  });
}

function office(slug: string): SeedFirm["officeUsers"] {
  return (["admin", "resourcer", "payroll"] as const).map((role) => ({
    id: seedId(`${slug}/office/${role}`),
    email: `${slug}.${role}@example.com`,
    name: `${role[0]?.toUpperCase()}${role.slice(1)} (demo)`,
    role,
  }));
}

// Acme Events: security and events, native rota. 60 workers: 5 with an expired SIA licence and
// 3 whose licence application is in progress ("applied"). 3 sites.
function acme(today: Date): SeedFirm {
  const slug = "acme";
  const roleFor = (i: number) =>
    i < 25 ? ["steward"] : i < 45 ? ["door_supervisor", "steward"] : ["security_officer"];
  const workers = people(slug, 60, 100, 1, roleFor);
  const credentials: SeedFirm["credentials"] = [];
  workers.forEach((w, i) => {
    const cred = (
      type: string,
      status: SeedFirm["credentials"][number]["status"],
      expiresOn: string | null,
      n = true,
    ) =>
      credentials.push({
        id: seedId(`${slug}/credential/${i}/${type}`),
        workerId: w.id,
        type,
        number: n ? `TEST-${type}-${String(i).padStart(4, "0")}` : null,
        expiresOn,
        status,
      });
    if (w.roles.includes("steward")) cred("STEWARD_L2", "valid", null);
    if (w.roles.includes("door_supervisor") || w.roles.includes("security_officer")) {
      const type = w.roles.includes("door_supervisor") ? "SIA_DS" : "SIA_SG";
      if (i >= 25 && i < 30)
        cred(type, "expired", day(today, -(10 + i))); // 5 expired
      else if (i >= 45 && i < 48)
        cred(type, "applied", null, false); // 3 applied
      else cred(type, "valid", day(today, 200 + i * 7));
    }
    if (i % 4 === 0) cred("FIRST_AID", "valid", day(today, 400 + i));
  });
  return {
    id: seedId("firm/acme"),
    name: "Acme Events",
    slug,
    sector: "security",
    shiftsLine: "+447700900000",
    brandColour: "#1d4ed8",
    settings: {
      allocation_mode: "fair_rotation",
      urgent_window_hours: 24,
      short_notice_threshold_hours: 48,
      wave_size: 4,
      wave_minutes: 15,
      escalate_hours_before_start: 3,
      quiet_hours: { start: "22:00", end: "07:00", urgent_override: true },
      credential_applied_allowance_pct: 15,
      approve_mode: true,
      sign_off: "Acme Events Shift Team",
      // The strikes team, already confirmed (the demo story, 12I.1).
      strikes: storyStrikesSettings(today),
      // The demo firm has travel areas on (13.4); a new firm starts with them off, and Northline
      // keeps them off.
      travel: { enabled: true },
    },
    // Invented places, marked "Demo" so nobody mistakes them for real clients or venues.
    sites: [
      {
        id: seedId("acme/site/stadium"),
        name: "Acme Demo Arena",
        town: "Exampleton",
        postcode: "ZZ1 1AA",
      },
      {
        id: seedId("acme/site/racecourse"),
        name: "Acme Demo Racecourse",
        town: "Exampleton",
        postcode: "ZZ2 2BB",
      },
      {
        id: seedId("acme/site/centre"),
        name: "Acme Demo Shopping Centre",
        town: "Exampleton",
        postcode: "ZZ3 3CC",
      },
    ],
    officeUsers: office(slug),
    workers,
    credentials,
  };
}

// Northline Rail Labour: rail, night possessions. 30 workers, each with PTS, Sentinel and a
// drugs and alcohol test; a few expire within the month (for Phase 2's expiry scan).
function northline(today: Date): SeedFirm {
  const slug = "northline";
  const roleFor = (i: number) => (i < 20 ? ["track_operative"] : ["lookout", "track_operative"]);
  const workers = people(slug, 30, 300, 2, roleFor);
  const credentials: SeedFirm["credentials"] = [];
  workers.forEach((w, i) => {
    const cred = (type: string, expiresOn: string | null) =>
      credentials.push({
        id: seedId(`${slug}/credential/${i}/${type}`),
        workerId: w.id,
        type,
        number: `TEST-${type}-${String(i).padStart(4, "0")}`,
        expiresOn,
        status: "valid",
      });
    cred("PTS", day(today, i < 3 ? 10 + i * 7 : 300 + i * 11)); // 3 expire within the month
    cred("SENTINEL", null); // sponsorship is ongoing
    cred("RAIL_DA", day(today, 30 + i * 2));
  });
  return {
    id: seedId("firm/northline"),
    name: "Northline Rail Labour",
    slug,
    sector: "rail",
    shiftsLine: null,
    brandColour: "#0f766e",
    settings: {
      allocation_mode: "first_come_first_served",
      urgent_window_hours: 12,
      short_notice_threshold_hours: 48,
      quiet_hours: { start: "23:00", end: "06:00", urgent_override: true },
      credential_applied_allowance_pct: 0,
      approve_mode: true,
      sign_off: "Northline Rail Labour Shift Team",
    },
    sites: [
      {
        id: seedId("northline/site/depot"),
        name: "Northline Demo Depot",
        town: "Sampleford",
        postcode: "ZZ4 4DD",
      },
      {
        id: seedId("northline/site/junction"),
        name: "Northline Demo Junction",
        town: "Sampleford",
        postcode: "ZZ5 5EE",
      },
    ],
    officeUsers: office(slug),
    workers,
    credentials,
  };
}

export function seedFirms(today: Date = new Date()): SeedFirm[] {
  return [acme(today), northline(today)];
}

// This week's offers for the dashboard's offers chart (Phase 23, 23.4): made up, each sent by
// Acme's resourcer between Monday midnight (London) and when the seed runs, so they always fall in
// the pay week the dashboard shows. The seed only writes what the app itself could have written,
// so none is sent in the firm's quiet hours: the app holds an offer that isn't urgent until they
// end (mayMessageNow, src/lib/rules/quiet-hours.ts), and none of these is on an urgent place.
// Waiting for a reply on Saturday's open places (the urgent dropout is left alone: the
// walkthrough's casuals take it), and said yes for Saturday's own bookings made this week. A
// said-yes offer went 20 minutes before its booking, or in the last minute before quiet hours
// began when that falls inside them; a booking whose offer would then fall before Monday is left
// out. Every booking is made 72 hours or more before the seed runs, and one made before 07:20 on
// Monday would have had its offer in the night's quiet hours, so a run before about 07:20 on
// Thursday has none yet. None said no: the app can't record a "no" yet (a casual declining an offer is in
// PLAN.md's Parking lot). Never to the workers kept free for demo logins, nor to the ones the
// walkthrough logs in as, so the offers and lists they see stay as they were; none failed. Pure:
// seed.ts loads them, added once (fixed ids).

// Saturday's open places, by role, in the order the day plans them (seed-saturday.ts: the arena's
// three steward places and the racecourse's one; the arena's door supervisor place; the
// racecourse's and the centre's security officer places): who has an offer waiting (by worker
// index; each worker free that Saturday and holding the role's qualification).
const SATURDAY_OFFERS: Record<string, { waiting: number[] }[]> = {
  steward: [{ waiting: [23, 24] }, { waiting: [25] }, { waiting: [27, 28] }, { waiting: [41] }],
  door_supervisor: [{ waiting: [38, 40] }],
  security_officer: [{ waiting: [57] }, { waiting: [58] }],
};
// Logged in as in the walkthrough (docs/walkthrough.md): Sam Walsh, Zoe Usman, Maya Morgan and Wes
// Doyle (the five kept free, 0 to 4, are never booked or offered either).
const WALKTHROUGH_WORKERS = [10, 22, 29, 39];
const OFFER_LEAD_MS = 20 * 60_000;
const MINUTE = 60_000;
const TZ = "Europe/London";

export interface OfferSeed {
  id: string;
  shiftId: string;
  workerId: string;
  sentAt: Date;
  // Waiting for a reply (null) or said yes. Never "declined": the app can't record a "no" yet.
  response: "accepted" | null;
  respondedAt: Date | null;
}

export function weekOffers(o: {
  now: Date;
  workers: SeedFirm["workers"];
  // The firm's quiet hours, as the app reads them (quietHours(settings)).
  quiet: QuietHours;
  // Saturday's open places just added (not the urgent dropout), in the day's order.
  openPlaces: { id: string; role: string }[];
  // Saturday's confirmed bookings on the shifts just added, as stored (their confirmed time).
  bookings: { id: string; shiftId: string; workerId: string; confirmedAt: Date }[];
}): OfferSeed[] {
  const weekStart = startOfDay(mondayOf(localDateOf(o.now, TZ)), TZ).getTime();
  // Every minute this week, Monday midnight to now, in which the app would send an offer that
  // isn't urgent: quiet hours are skipped to their end, as the app holds an offer until then.
  const open: number[] = [];
  for (let t = weekStart; t < o.now.getTime();) {
    const timing = mayMessageNow({ now: new Date(t), timeZone: TZ, quiet: o.quiet, urgent: false });
    if (!timing.ok) {
      t = timing.until.getTime();
      continue;
    }
    open.push(t);
    t += MINUTE;
  }
  const workerId = (i: number) => {
    const w = o.workers[i];
    if (!w || i < 5 || WALKTHROUGH_WORKERS.includes(i))
      throw new Error(`worker ${i} can't be offered`);
    return w.id;
  };
  const leftOut = new Set([
    ...o.workers.slice(0, 5).map((w) => w.id),
    ...WALKTHROUGH_WORKERS.map((i) => o.workers[i]?.id),
  ]);
  const waiting: { shiftId: string; workerId: string }[] = [];
  for (const [role, places] of Object.entries(SATURDAY_OFFERS)) {
    const shifts = o.openPlaces.filter((p) => p.role === role);
    places.forEach((plan, i) => {
      const shift = shifts[i];
      if (!shift) return;
      for (const w of plan.waiting) waiting.push({ shiftId: shift.id, workerId: workerId(w) });
    });
  }
  // Spread over those minutes: the k-th of n sent at (k + 1) / (n + 1) of the way through them.
  // A run before quiet hours first end this week (Monday before 07:00 for Acme) has no such minute
  // yet, so it plans no waiting offer at all.
  const offers: OfferSeed[] = [];
  waiting.forEach((x, k) => {
    const sentAt = open[Math.floor((open.length * (k + 1)) / (waiting.length + 1))];
    if (sentAt === undefined) return;
    offers.push({
      id: seedId(`acme/offer/${x.shiftId}/${x.workerId}`),
      shiftId: x.shiftId,
      workerId: x.workerId,
      sentAt: new Date(sentAt),
      response: null,
      respondedAt: null,
    });
  });
  // Said yes: sent 20 minutes before the booking, or, when that is in quiet hours, in the last
  // minute before they began. Left out when that is before this week's Monday.
  const sentBefore = (confirmedAt: Date): number | undefined => {
    const at = confirmedAt.getTime() - OFFER_LEAD_MS;
    if (at < weekStart) return undefined;
    if (mayMessageNow({ now: new Date(at), timeZone: TZ, quiet: o.quiet, urgent: false }).ok)
      return at;
    return open.findLast((minute) => minute <= at);
  };
  // Saturday's bookings made this week, the 12 latest.
  const yes = o.bookings
    .filter((b) => !leftOut.has(b.workerId) && b.confirmedAt.getTime() <= o.now.getTime())
    .flatMap((b) => {
      const sentAt = sentBefore(b.confirmedAt);
      return sentAt === undefined ? [] : [{ ...b, sentAt }];
    })
    .sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, 12);
  for (const b of yes) {
    offers.push({
      id: seedId(`acme/offer/accepted/${b.id}`),
      shiftId: b.shiftId,
      workerId: b.workerId,
      sentAt: new Date(b.sentAt),
      response: "accepted",
      respondedAt: b.confirmedAt,
    });
  }
  return offers;
}
