import { createHash } from "node:crypto";
import { localDateOf, zonedToUtc } from "../../time/zoned";

// The two demo firms from docs/testing.md. Fake data only (golden rule 7): invented firms,
// sites and people; phone numbers from Ofcom's drama range (+447700900000-999); emails at
// example.com; credential numbers that start with TEST-. Deterministic, so every run (and every
// machine) produces the same ids and rows. Later phases add shifts, requests and pay data.

// A stable UUID (version 4 layout) derived from a name, so re-running the seed updates rows
// instead of duplicating them.
export function seedId(name: string): string {
  const h = createHash("sha256").update(`shiftdesk-seed:${name}`).digest("hex");
  const variant = ((parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

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
