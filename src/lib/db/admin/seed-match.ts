import { newEventPayload } from "../../client/payloads";
import { urgentWhy } from "../../client/urgency";
import { FIRM_CHANGE_REASONS } from "../../roster/firm-reasons";
import { noticeHours } from "../../roster/notice";
import { mayMessageNow, quietHours } from "../../rules/quiet-hours";
import { insideUrgentWindow, urgentWindowHours } from "../../rules/urgent";
import { strikeDecision } from "../../strikes/decide";
import { strikeSettings } from "../../strikes/settings";
import { addDays, localDateOf, mondayOf, startOfDay, zonedToUtc } from "../../time/zoned";
import { seedId, type SeedFirm } from "./seed-data";

// A match day to play with (Phase 36.5; docs/testing.md "Fixtures and the demo seed";
// docs/screens.md "36.5"): a made-up football match on Acme, shaped like a match-day deployment
// sheet (posts, roles, shifts timed from kick-off, briefings and redeployment notes). Every name,
// place, client and rate is made up (golden rule 7): nothing is copied from any real sheet. A pure
// builder, loaded by seed-match-load.ts (and its offers by seed.ts, the seed's one offer writer).
//
// - "Demo Rovers v Visitors FC" at Demo Stadium (1 Demo Road, Exampleton, ZZ1 9SR: a made-up
//   postcode with a made-up map point near the Arena's), kick-off 16:30 on the demo's coming
//   Saturday: today, if it's Saturday before kick-off; otherwise the next one.
// - 18 sessions at 14 posts, 83 places, timed from kick-off as such sheets are (most start 4 hours
//   before and last 7; the car parks 4h15 before for 8h15; the control room 3h30 before for 6h30;
//   the deployment manager 6h30 before for 10h30), the tours and the station queues at fixed times.
// - 69 booked (83%): North Gate's SIA stewards 3 short and marked urgent by the office, Car park
//   North 4 short, the Estate patrol (CSAS) 1 short, the Agency area 4 short; South Ramp 1 short
//   after a casual cancelled (the strike decision the rules' own), Demo Park's station queue 1
//   short after the office cancelled a booking (with its reason and notice: golden rule 12). Two
//   offers waiting on North Gate.
// - A squad of 75 made-up casuals (numbers from MATCH_MOBILE_BLOCKS, 07700 900408 to 900449 and
//   900457 to 900498, in order: the 75 take 900408 to 900449 and 900457 to 900489) who hold the
//   match's own requirement, the firm's "Demo Stadium ground induction" (its own credential type,
//   as data: golden rule 6), so the walkthrough's 60 casuals and the story's eight never see these
//   places and their lists stay as they were. The car parks need "Chapter 8 traffic management",
//   another of the firm's own types; supervisors are the firm's own role (SIA and Level 2 steward).
// - The previous home match, two weeks before: worked, with a late cancellation that was a strike
//   and a pay query still open.
// - The contract "Demo Stadium Ltd" (the stadium is its venue), its client login (a made-up
//   contact on a reserved example domain), two requests waiting (4 more SIA stewards at North Gate,
//   urgent when the rules say so, and a new event two weeks on) and, from the previous match, one
//   accepted and one declined.
// Ids are fixed and undated: added once, so a re-run changes nothing (`npm run db:reset`, and a
// demo server's nightly reset, move the match to the new coming Saturday).

const TZ = "Europe/London";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const id = (name: string) => seedId(`acme/match/${name}`);

export const MATCH_NAME = "Demo Rovers v Visitors FC";
export const PREVIOUS_MATCH_NAME = "Demo Rovers v Example Athletic";
export const NEXT_MATCH_NAME = "Demo Rovers v Sample Town FC";
export const MATCH_KICK_OFF = "16:30";
export const MATCH_SITE_ID = id("site/stadium");
export const MATCH_CONTRACT_ID = id("client/demo-stadium");
// The demo's client login: "Client view" on "Choose a view" opens a client session as them.
export const MATCH_CLIENT_CONTACT_ID = id("client-contact/hannah");
export const MATCH_CLIENT_CONTACT = {
  id: MATCH_CLIENT_CONTACT_ID,
  name: "Hannah Price",
  email: "hannah.price@demo-stadium.example",
} as const;
export const INDUCTION = "DEMO_STADIUM_INDUCTION";
export const CHAPTER_8 = "CHAPTER_8";

// The squad's numbers: free of every fixed number in the repo and of the browser specs' spare
// blocks (tests/unit/e2e.spare-mobiles.test.ts checks).
export const MATCH_MOBILE_BLOCKS: readonly (readonly [number, number])[] = [
  [408, 449],
  [457, 498],
];

type Kind = "sup" | "sia" | "stw" | "cp" | "csas";

export interface MatchWorker {
  id: string;
  kind: Kind;
  index: number; // within its kind
  firstName: string;
  lastName: string;
  mobileE164: string;
  email: string | null;
  roles: string[];
}

export interface MatchCredential {
  id: string;
  workerId: string;
  type: string;
  number: string;
  expiresOn: string | null;
}

export interface MatchSession {
  id: string;
  key: string;
  eventId: string;
  match: "this" | "previous";
  role: string;
  post: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  booked: number; // confirmed (or worked) now
  isUrgent: boolean;
  urgentCause: "office" | "dropout" | null;
  payRatePence: number;
  meetingPoint: string;
  uniform: string;
  instructions: string;
  requiredCredentials: string[];
  createdAt: Date;
}

export interface MatchBooking {
  id: string;
  shiftId: string;
  slot: number;
  workerId: string;
  status: "confirmed" | "completed" | "cancelled_worker" | "cancelled_firm";
  confirmedAt: Date;
  bookedNoticeHours: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  noticeHours: number | null;
  cancelVia: "app" | "office" | null;
  strikeCode: string | null; // the rules' decision, for a cancellation
  reopenedId: string | null;
}

export interface MatchStrike {
  id: string;
  bookingId: string;
  workerId: string;
  shiftId: string;
  noticeHours: number;
  issuedAt: Date;
  expiresAt: Date;
}

export interface MatchOffer {
  id: string;
  shiftId: string;
  workerId: string;
  sentAt: Date;
}

export interface MatchRequest {
  id: string;
  kind: "more_places" | "new_event" | "other";
  shiftId: string | null;
  eventId: string | null;
  payload: Record<string, unknown>;
  clientNote: string | null;
  status: "waiting" | "accepted" | "declined";
  urgent: boolean;
  officeAnswer: string | null;
  answeredAt: Date | null;
  createdAt: Date;
  accepted?: { from: number; to: number; offers: number };
}

export interface MatchSeed {
  day: string; // the Saturday, yyyy-mm-dd (London)
  kickOff: Date;
  previousDay: string;
  site: { id: string; name: string; addressLine1: string; town: string; postcode: string };
  contract: { id: string; name: string };
  contact: { id: string; name: string; email: string; createdAt: Date; lastLoginAt: Date };
  credentialTypes: { code: string; name: string; officeRecorded: boolean }[];
  rules: { role: string; requiredTypes: string[] }[];
  workers: MatchWorker[];
  credentials: MatchCredential[];
  events: { id: string; name: string }[];
  sessions: MatchSession[];
  bookings: MatchBooking[];
  strikes: MatchStrike[];
  offers: MatchOffer[];
  payQuery: {
    id: string;
    workerId: string;
    shiftId: string;
    workDate: string;
    details: string;
    createdAt: Date;
  };
  pay: {
    id: string;
    workerId: string;
    periodStart: string;
    periodEnd: string;
    hours: string;
    ratePence: number;
    grossPence: number;
    payDate: string;
  }[];
  requests: MatchRequest[];
}

const at = (date: string, time: string) => {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return zonedToUtc({ year, month, day, hour, minute }, TZ);
};
// Monday = 0 ... Saturday = 5, Sunday = 6, for a yyyy-mm-dd date.
const weekday = (isoDate: string) => (new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7;

// The demo's coming Saturday: today if it's Saturday and kick-off is still ahead, else the next.
export function matchDayFor(now: Date): string {
  const today = localDateOf(now, TZ);
  if (weekday(today) === 5 && now.getTime() < at(today, MATCH_KICK_OFF).getTime()) return today;
  let d = addDays(today, 1);
  while (weekday(d) !== 5) d = addDays(d, 1);
  return d;
}

// Made-up names, none in the generated workers' or the story's lists (seed-data.ts).
const FIRST = [
  "Aaron",
  "Bethany",
  "Carl",
  "Dina",
  "Eddie",
  "Fatima",
  "Gareth",
  "Hollie",
  "Imran",
  "Jodie",
  "Kofi",
  "Lauren",
  "Marcus",
  "Nadia",
  "Owen",
  "Phoebe",
  "Reece",
  "Shannon",
  "Tariq",
  "Vicky",
];
const LAST = [
  "Ashworth",
  "Bennett",
  "Carter",
  "Dawson",
  "Ellis",
  "Fletcher",
  "Gordon",
  "Hanley",
  "Irwin",
  "Jarvis",
  "Kemp",
  "Lowe",
  "Marsh",
  "Nolan",
  "Oakley",
  "Pearce",
  "Rowe",
  "Stanton",
  "Turner",
  "Webb",
];

// How many of each: 8 supervisors, 27 SIA stewards, 26 stewards, 11 car park stewards (Chapter 8)
// and 3 CSAS officers.
export const SQUAD: Record<Kind, number> = { sup: 8, sia: 27, stw: 26, cp: 11, csas: 3 };
const KINDS: Kind[] = ["sup", "sia", "stw", "cp", "csas"];
const ROLES: Record<Kind, string[]> = {
  sup: ["supervisor", "door_supervisor", "steward"],
  sia: ["door_supervisor", "steward"],
  stw: ["steward"],
  cp: ["steward"],
  csas: ["csas_officer", "steward"],
};

function squadMobiles(): string[] {
  return MATCH_MOBILE_BLOCKS.flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, i) => `+447700900${String(from + i)}`),
  );
}

// Pay, a pound or two over the story's: whole pence an hour.
const PAY = { sup: 1650, manager: 1900, sia: 1450, stw: 1250, cp: 1350, csas: 1500 };
const UNIFORM = {
  sup: "Black suit, white shirt, your SIA badge on show. Collect a supervisor's tabard and radio at the briefing.",
  sia: "Black trousers and boots, your SIA badge on show. Hi-vis jacket and radio given at the briefing.",
  stw: "Black trousers, comfortable black shoes. Hi-vis jacket given at the briefing.",
  cp: "Black trousers, safety boots. Long-sleeved hi-vis and a torch given at the car park cabin.",
  csas: "Your CSAS tabard and card, black trousers, boots.",
};
const BRIEFING = "Steward briefing room, under the North Stand (staff entrance on Demo Road)";

interface Plan {
  key: string;
  post: string;
  role: string;
  kind: Kind;
  // From kick-off (minutes before, minutes long), or fixed clock times.
  time: { before: number; length: number } | { start: string; end: string };
  places: number;
  booked: number; // confirmed before the cancellations below
  pay: number;
  meet: string;
  instructions: string;
  extra?: string[]; // needed on top of the role's and the induction
  urgent?: "office";
}

const STANDARD = { before: 240, length: 420 }; // 4 hours before kick-off, 7 hours

const THIS_MATCH: Plan[] = [
  {
    key: "deployment-manager",
    post: "Deployment manager",
    role: "supervisor",
    kind: "sup",
    time: { before: 390, length: 630 },
    places: 1,
    booked: 1,
    pay: PAY.manager,
    meet: "Event control, level 3 of the Main Stand",
    instructions:
      "Walk the ground with the safety officer at 10:30. Run the 11:30 and 12:00 briefings. Report to event control all day; sign the deployment sheet off with the safety officer after the stadium is clear.",
  },
  {
    key: "control-room",
    post: "Control room",
    role: "supervisor",
    kind: "sup",
    time: { before: 210, length: 390 },
    places: 3,
    booked: 3,
    pay: PAY.sup,
    meet: "Event control, level 3 of the Main Stand",
    instructions:
      "Radio log and CCTV desk in event control. Keep the incident log up to date and pass every gate's count to the safety officer each 15 minutes from the gates opening.",
  },
  {
    key: "north-gate-supervisor",
    post: "North Gate",
    role: "supervisor",
    kind: "sup",
    time: STANDARD,
    places: 1,
    booked: 1,
    pay: PAY.sup,
    meet: BRIEFING,
    instructions:
      "Supervise the North Gate team: search lanes, ticket checks and the queue outside. Report to event control on channel 2. Tell the control room before you move anyone.",
  },
  {
    key: "north-gate-sia",
    post: "North Gate",
    role: "door_supervisor",
    kind: "sia",
    time: STANDARD,
    places: 13,
    booked: 10,
    pay: PAY.sia,
    meet: BRIEFING,
    instructions:
      "Search and ticket checks at the North Gate turnstiles. Bag searches in the lanes; anything you take goes in the bag store. Report to event control through your supervisor. At 17:15, when the gate closes, 4 of you move to the South Ramp for the away fans' exit.",
    urgent: "office",
  },
  {
    key: "south-bridge-supervisor",
    post: "South Bridge",
    role: "supervisor",
    kind: "sup",
    time: STANDARD,
    places: 1,
    booked: 1,
    pay: PAY.sup,
    meet: BRIEFING,
    instructions:
      "Supervise the South Bridge team and the queue on the bridge. Keep the bridge's footpath clear for the ambulance route.",
  },
  {
    key: "south-bridge-sia",
    post: "South Bridge",
    role: "door_supervisor",
    kind: "sia",
    time: STANDARD,
    places: 11,
    booked: 11,
    pay: PAY.sia,
    meet: BRIEFING,
    instructions:
      "Queue management and ticket checks on South Bridge, then searches at the south turnstiles. At 15:45, 5 of you move to the Demo Central station queue: your supervisor will say who.",
  },
  {
    key: "west-ramp-supervisor",
    post: "West Ramp",
    role: "supervisor",
    kind: "sup",
    time: STANDARD,
    places: 1,
    booked: 1,
    pay: PAY.sup,
    meet: BRIEFING,
    instructions: "Supervise the West Ramp team. Wheelchair users' entrance: keep the lift clear.",
  },
  {
    key: "west-ramp",
    post: "West Ramp",
    role: "steward",
    kind: "stw",
    time: STANDARD,
    places: 4,
    booked: 4,
    pay: PAY.stw,
    meet: BRIEFING,
    instructions:
      "Help fans up the West Ramp and keep it moving. No standing on the ramp. Point families to the Family Stand.",
  },
  {
    key: "south-ramp-supervisor",
    post: "South Ramp",
    role: "supervisor",
    kind: "sup",
    time: STANDARD,
    places: 1,
    booked: 1,
    pay: PAY.sup,
    meet: BRIEFING,
    instructions:
      "Supervise the South Ramp team. The away fans leave this way at full time: hold them until the police say go.",
  },
  {
    key: "south-ramp",
    post: "South Ramp",
    role: "steward",
    kind: "stw",
    time: STANDARD,
    places: 4,
    booked: 4, // one cancels below
    pay: PAY.stw,
    meet: BRIEFING,
    instructions:
      "Away fans' ramp. Keep home and away fans apart at the bottom of the ramp. At full time, hold the away fans until the police say go.",
  },
  {
    key: "players-entrance",
    post: "Players' entrance search",
    role: "door_supervisor",
    kind: "sia",
    time: STANDARD,
    places: 4,
    booked: 4,
    pay: PAY.sia,
    meet: "Players' entrance, west side of the Main Stand",
    instructions:
      "Search everyone coming in at the players' entrance, staff and guests included. Check every pass against the list. Nobody in without one: call the control room.",
  },
  {
    key: "stadium-tours",
    post: "Stadium tours",
    role: "steward",
    kind: "stw",
    time: { start: "09:30", end: "17:00" },
    places: 2,
    booked: 2,
    pay: PAY.stw,
    meet: "Club shop, Demo Road entrance",
    instructions:
      "Walk the morning tours round with the tour guide (10:00, 11:30 and 13:00). From 14:00, help at the club shop's queue.",
  },
  {
    key: "station-central",
    post: "Station queue (Demo Central station)",
    role: "steward",
    kind: "stw",
    time: { start: "14:00", end: "20:00" },
    places: 5,
    booked: 5,
    pay: PAY.stw,
    meet: "Demo Central station, main entrance (meet the station's own staff there)",
    instructions:
      "Queue management outside the station before the match and after it. Keep the crossing clear. Report to event control on channel 4.",
  },
  {
    key: "station-park",
    post: "Station queue (Demo Park station)",
    role: "steward",
    kind: "stw",
    time: { start: "14:00", end: "20:00" },
    places: 5,
    booked: 5, // the office cancels one below
    pay: PAY.stw,
    meet: "Demo Park station, the ticket hall",
    instructions:
      "Queue management at Demo Park station. Away fans come in here: keep them on the east platform side. Report to event control on channel 4.",
  },
  {
    key: "estate-patrol",
    post: "Estate patrol",
    role: "csas_officer",
    kind: "csas",
    time: STANDARD,
    places: 3,
    booked: 2,
    pay: PAY.csas,
    meet: "Event control, level 3 of the Main Stand",
    instructions:
      "Patrol the Demo Road estate in pairs: parking on the pavements, gates and gardens. Report anything to event control on channel 3.",
  },
  {
    key: "car-park-north",
    post: "Car park North",
    role: "steward",
    kind: "cp",
    time: { before: 255, length: 495 },
    places: 8,
    booked: 4,
    pay: PAY.cp,
    meet: "Car park North cabin",
    instructions:
      "Traffic marshalling in Car park North: Chapter 8 signs and cones out by 12:30. Blue badge bays by the cabin. Close the car park when it's full and tell event control.",
    extra: [CHAPTER_8],
  },
  {
    key: "car-park-south",
    post: "Car park South",
    role: "steward",
    kind: "cp",
    time: { before: 255, length: 495 },
    places: 6,
    booked: 6,
    pay: PAY.cp,
    meet: "Car park South cabin",
    instructions:
      "Traffic marshalling in Car park South: coaches only for the away fans. Chapter 8 signs and cones out by 12:30. After the match, hold the cars until the coaches have gone.",
    extra: [CHAPTER_8],
  },
  {
    key: "agency-area",
    post: "Agency area",
    role: "steward",
    kind: "stw",
    time: STANDARD,
    places: 10,
    booked: 6,
    pay: PAY.stw,
    meet: "Agency area, under the East Stand",
    instructions:
      "Sign in at the agency area, then go where the deployment manager sends you: gates first, then the stands. Stay until you're signed out.",
  },
];

export function acmeMatchDay(firm: SeedFirm, now: Date): MatchSeed {
  const day = matchDayFor(now);
  const kickOff = at(day, MATCH_KICK_OFF);
  const previousDay = addDays(day, -14);
  const previousKickOff = at(previousDay, "15:00");
  const nextDay = addDays(day, 14);
  const strikesRules = strikeSettings(firm.settings);
  const windowHours = urgentWindowHours(firm.settings);

  // The squad.
  const mobiles = squadMobiles();
  const workers: MatchWorker[] = [];
  for (const kind of KINDS) {
    for (let index = 0; index < SQUAD[kind]; index += 1) {
      const n = workers.length;
      const mobile = mobiles[n];
      if (!mobile) throw new Error("the match squad needs more made-up numbers");
      workers.push({
        id: id(`worker/${kind}/${index}`),
        kind,
        index,
        firstName: FIRST[n % FIRST.length] ?? "Sam",
        lastName: LAST[(n + Math.floor(n / FIRST.length) * 3) % LAST.length] ?? "Webb",
        mobileE164: mobile,
        email: n % 3 === 0 ? `acme.match${n}@example.com` : null,
        roles: ROLES[kind],
      });
    }
  }
  const pick = (kind: Kind, index: number) => {
    const w = workers.find((x) => x.kind === kind && x.index === index);
    if (!w) throw new Error(`no match worker ${kind} ${index}`);
    return w;
  };
  const today = localDateOf(now, TZ);
  const credentials: MatchCredential[] = [];
  workers.forEach((w, n) => {
    const held = (type: string, expiresOn: string | null) =>
      credentials.push({
        id: id(`credential/${w.kind}/${w.index}/${type}`),
        workerId: w.id,
        type,
        number: `TEST-${type}-M${String(n).padStart(3, "0")}`,
        expiresOn,
      });
    held(INDUCTION, null);
    held("STEWARD_L2", null);
    if (w.kind === "sup" || w.kind === "sia") held("SIA_DS", addDays(today, 240 + n * 9));
    if (w.kind === "cp") held(CHAPTER_8, addDays(today, 500 + n * 11));
    if (w.kind === "csas") held("CSAS", addDays(today, 300 + n * 5));
  });

  const event = (key: string, name: string) => ({ id: id(`event/${key}`), name });
  const events = [event("this", MATCH_NAME), event("previous", PREVIOUS_MATCH_NAME)];
  const eventOf = (m: "this" | "previous") => id(`event/${m}`);

  const sessions: MatchSession[] = [];
  const bookings: MatchBooking[] = [];
  const created = new Date(now.getTime() - 21 * DAY);

  // This match's sessions and their bookings, each made a while before now (as the app would).
  // Who's on which: each kind's casuals in order, never two places each.
  const next: Record<Kind, number> = { sup: 0, sia: 0, stw: 0, cp: 0, csas: 0 };
  let bookedSoFar = 0;
  for (const p of THIS_MATCH) {
    const startsAt =
      "before" in p.time
        ? new Date(kickOff.getTime() - p.time.before * MINUTE)
        : at(day, p.time.start);
    const endsAt =
      "before" in p.time
        ? new Date(startsAt.getTime() + p.time.length * MINUTE)
        : at(day, p.time.end);
    const s: MatchSession = {
      id: id(`session/this/${p.key}`),
      key: p.key,
      eventId: eventOf("this"),
      match: "this",
      role: p.role,
      post: p.post,
      startsAt,
      endsAt,
      headcount: p.places,
      booked: p.booked,
      isUrgent: p.urgent === "office",
      urgentCause: p.urgent ?? null,
      payRatePence: p.pay,
      meetingPoint: p.meet,
      uniform: UNIFORM[p.kind],
      instructions: p.instructions,
      requiredCredentials: [INDUCTION, ...(p.extra ?? [])],
      createdAt: new Date(Math.min(created.getTime(), startsAt.getTime() - 7 * DAY)),
    };
    sessions.push(s);
    for (let slot = 1; slot <= p.booked; slot += 1) {
      const w = pick(p.kind, next[p.kind]);
      next[p.kind] += 1;
      // Booked between 1 and about 17 days ago, the later ones nearer now.
      const confirmedAt = new Date(now.getTime() - (24 + ((bookedSoFar * 37) % 380)) * HOUR);
      bookedSoFar += 1;
      bookings.push({
        id: id(`booking/this/${p.key}/${slot}`),
        shiftId: s.id,
        slot,
        workerId: w.id,
        status: "confirmed",
        confirmedAt,
        bookedNoticeHours: noticeHours(startsAt, confirmedAt),
        cancelledAt: null,
        cancelReason: null,
        noticeHours: null,
        cancelVia: null,
        strikeCode: null,
        reopenedId: null,
      });
    }
  }
  const session = (match: "this" | "previous", key: string) => {
    const s = sessions.find((x) => x.id === id(`session/${match}/${key}`));
    if (!s) throw new Error(`no match session ${key}`);
    return s;
  };

  // A casual cancels on the South Ramp: three hours before the seed ran (never after the session
  // starts). Whether it's a strike is the rules' decision, from the notice it gave; inside the
  // firm's urgent window the place is marked urgent by the system, as the app does.
  {
    const s = session("this", "south-ramp");
    const b = bookings.find((x) => x.shiftId === s.id && x.slot === s.headcount);
    if (!b) throw new Error("no South Ramp booking to cancel");
    const cancelledAt = new Date(Math.min(now.getTime() - 3 * HOUR, s.startsAt.getTime() - HOUR));
    const notice = noticeHours(s.startsAt, cancelledAt);
    const reason = "Travel problem";
    const decision = strikeDecision({
      cancelledBy: "worker",
      noticeHours: notice,
      thresholdHours: strikesRules.noticeHours,
      booking: { by: "worker", overridden: false },
      changedAfterBooking: false,
      reason,
    });
    Object.assign(b, {
      status: "cancelled_worker",
      cancelledAt,
      cancelReason: reason,
      noticeHours: notice,
      cancelVia: "app",
      strikeCode: decision.code,
      reopenedId: id(`booking/this/south-ramp/reopened`),
    } satisfies Partial<MatchBooking>);
    s.booked -= 1;
    if (insideUrgentWindow(s.startsAt, cancelledAt, windowHours)) {
      s.isUrgent = true;
      s.urgentCause = "dropout";
    }
  }
  // The office cancels one booking at Demo Park's station queue: she can't work there any more
  // (the firm's own reason, with the notice she had: golden rule 12). Five hours before the seed.
  {
    const s = session("this", "station-park");
    const b = bookings.find((x) => x.shiftId === s.id && x.slot === s.headcount);
    if (!b) throw new Error("no station booking to cancel");
    const cancelledAt = new Date(
      Math.min(now.getTime() - 5 * HOUR, s.startsAt.getTime() - 2 * HOUR),
    );
    Object.assign(b, {
      status: "cancelled_firm",
      cancelledAt,
      cancelReason: FIRM_CHANGE_REASONS.not_available,
      noticeHours: noticeHours(s.startsAt, cancelledAt),
      cancelVia: "office",
      strikeCode: strikeDecision({ cancelledBy: "firm" }).code,
      reopenedId: id(`booking/this/station-park/reopened`),
    } satisfies Partial<MatchBooking>);
    s.booked -= 1;
  }

  // The previous home match: worked (marked by the office), with one late cancellation, a strike.
  const prev = (o: {
    key: string;
    post: string;
    role: string;
    kind: Kind;
    before: number;
    length: number;
    places: number;
    workers: number[];
    pay: number;
    meet: string;
    instructions: string;
    extra?: string[];
  }) => {
    const startsAt = new Date(previousKickOff.getTime() - o.before * MINUTE);
    const s: MatchSession = {
      id: id(`session/previous/${o.key}`),
      key: o.key,
      eventId: eventOf("previous"),
      match: "previous",
      role: o.role,
      post: o.post,
      startsAt,
      endsAt: new Date(startsAt.getTime() + o.length * MINUTE),
      headcount: o.places,
      booked: o.workers.length,
      isUrgent: false,
      urgentCause: null,
      payRatePence: o.pay,
      meetingPoint: o.meet,
      uniform: UNIFORM[o.kind],
      instructions: o.instructions,
      requiredCredentials: [INDUCTION, ...(o.extra ?? [])],
      createdAt: new Date(startsAt.getTime() - 21 * DAY),
    };
    sessions.push(s);
    o.workers.forEach((index, i) => {
      const confirmedAt = new Date(startsAt.getTime() - (30 + i * 5) * HOUR);
      bookings.push({
        id: id(`booking/previous/${o.key}/${i + 1}`),
        shiftId: s.id,
        slot: i + 1,
        workerId: pick(o.kind, index).id,
        status: "completed",
        confirmedAt,
        bookedNoticeHours: noticeHours(startsAt, confirmedAt),
        cancelledAt: null,
        cancelReason: null,
        noticeHours: null,
        cancelVia: null,
        strikeCode: null,
        reopenedId: null,
      });
    });
    return s;
  };
  const prevGate = prev({
    key: "north-gate-sia",
    post: "North Gate",
    role: "door_supervisor",
    kind: "sia",
    before: 240,
    length: 420,
    places: 6,
    workers: [0, 1, 2, 3, 4, 5],
    pay: PAY.sia,
    meet: BRIEFING,
    instructions: "Search and ticket checks at the North Gate turnstiles.",
  });
  const prevAgency = prev({
    key: "agency-area",
    post: "Agency area",
    role: "steward",
    kind: "stw",
    before: 240,
    length: 420,
    places: 6, // 4, and 2 more the client asked for (accepted below)
    workers: [20, 21, 22, 23, 24, 25],
    pay: PAY.stw,
    meet: "Agency area, under the East Stand",
    instructions: "Sign in at the agency area, then go where the deployment manager sends you.",
  });
  const prevCarPark = prev({
    key: "car-park-north",
    post: "Car park North",
    role: "steward",
    kind: "cp",
    before: 255,
    length: 495,
    places: 4,
    workers: [0, 1, 2, 3],
    pay: PAY.cp,
    meet: "Car park North cabin",
    instructions: "Traffic marshalling in Car park North.",
    extra: [CHAPTER_8],
  });
  // The late one: 5 hours before, by the casual, for a travel problem. Under the firm's notice, so
  // the rules make it a strike (and the system marked the place urgent: inside the window).
  const strikes: MatchStrike[] = [];
  {
    const b = bookings.find((x) => x.shiftId === prevGate.id && x.slot === 6);
    if (!b) throw new Error("no previous match booking to cancel");
    const cancelledAt = new Date(prevGate.startsAt.getTime() - 5 * HOUR);
    const notice = noticeHours(prevGate.startsAt, cancelledAt);
    const decision = strikeDecision({
      cancelledBy: "worker",
      noticeHours: notice,
      thresholdHours: strikesRules.noticeHours,
      booking: { by: "worker", overridden: false },
      changedAfterBooking: false,
      reason: "Travel problem",
    });
    Object.assign(b, {
      status: "cancelled_worker",
      cancelledAt,
      cancelReason: "Travel problem",
      noticeHours: notice,
      cancelVia: "app",
      strikeCode: decision.code,
      reopenedId: id("booking/previous/north-gate-sia/reopened"),
    } satisfies Partial<MatchBooking>);
    prevGate.booked -= 1;
    if (insideUrgentWindow(prevGate.startsAt, cancelledAt, windowHours)) {
      prevGate.isUrgent = true;
      prevGate.urgentCause = "dropout";
    }
    if (decision.result === "strike") {
      strikes.push({
        id: id("strike/previous/north-gate-sia"),
        bookingId: b.id,
        workerId: b.workerId,
        shiftId: b.shiftId,
        noticeHours: notice,
        issuedAt: cancelledAt,
        expiresAt: new Date(cancelledAt.getTime() + strikesRules.liveDays * DAY),
      });
    }
  }
  // This match's South Ramp cancellation, when the rules made it a strike.
  {
    const b = bookings.find(
      (x) => x.status === "cancelled_worker" && x.shiftId === session("this", "south-ramp").id,
    );
    if (b?.strikeCode === "issued" && b.cancelledAt && b.noticeHours !== null) {
      strikes.push({
        id: id("strike/this/south-ramp"),
        bookingId: b.id,
        workerId: b.workerId,
        shiftId: b.shiftId,
        noticeHours: b.noticeHours,
        issuedAt: b.cancelledAt,
        expiresAt: new Date(b.cancelledAt.getTime() + strikesRules.liveDays * DAY),
      });
    }
  }

  // Two offers waiting on North Gate, to the two SIA stewards nobody has booked, sent by the admin
  // this week outside quiet hours (none on a run before quiet hours first end this week).
  const offers: MatchOffer[] = [];
  {
    const gate = session("this", "north-gate-sia");
    const quiet = quietHours(firm.settings);
    const weekStart = startOfDay(mondayOf(today), TZ).getTime();
    let t = Math.floor((now.getTime() - 20 * MINUTE) / MINUTE) * MINUTE;
    while (
      t >= weekStart &&
      !mayMessageNow({ now: new Date(t), timeZone: TZ, quiet, urgent: false }).ok
    ) {
      t -= MINUTE;
    }
    if (t >= weekStart && t > gate.createdAt.getTime()) {
      [25, 26].forEach((index, i) => {
        const w = pick("sia", index);
        offers.push({
          id: id(`offer/this/north-gate-sia/${w.id}`),
          shiftId: gate.id,
          workerId: w.id,
          sentAt: new Date(t - i * MINUTE),
        });
      });
    }
  }

  // The pay query: a car park steward from the previous match, still open, and their pay line.
  const asker = pick("cp", 2);
  const workDate = localDateOf(prevCarPark.startsAt, TZ);
  const periodStart = mondayOf(workDate);
  const payHours = (prevCarPark.endsAt.getTime() - prevCarPark.startsAt.getTime()) / HOUR;
  const pay = [
    {
      id: id(`pay/${asker.id}/${periodStart}`),
      workerId: asker.id,
      periodStart,
      periodEnd: addDays(periodStart, 6),
      hours: payHours.toFixed(2),
      ratePence: PAY.cp,
      grossPence: Math.round(payHours * PAY.cp),
      payDate: addDays(periodStart, 11),
    },
  ];
  const payQuery = {
    id: id("pay-query/previous/car-park-north"),
    workerId: asker.id,
    shiftId: prevCarPark.id,
    workDate,
    details:
      "I stayed an hour after the end to help clear Car park North. That hour isn't on my pay.",
    createdAt: new Date(
      Math.min(prevCarPark.endsAt.getTime() + 6 * DAY, now.getTime() - 26 * HOUR),
    ),
  };

  // The client's requests.
  const gate = session("this", "north-gate-sia");
  const moreAt = new Date(now.getTime() - 2 * HOUR);
  const newEventAt = new Date(now.getTime() - 5 * HOUR);
  const nextEvent = newEventPayload.parse({
    name: NEXT_MATCH_NAME,
    venue: { siteId: MATCH_SITE_ID },
    date: nextDay,
    sessions: [
      { role: "supervisor", places: 6, start: "12:30", end: "19:30" },
      {
        role: "door_supervisor",
        places: 30,
        start: "12:30",
        end: "19:30",
        notes: "North Gate and South Bridge",
      },
      { role: "steward", places: 24, start: "12:30", end: "19:30" },
      {
        role: "steward",
        places: 14,
        start: "12:15",
        end: "20:30",
        notes: "Car parks: Chapter 8 needed",
      },
      { role: "csas_officer", places: 3, start: "12:30", end: "19:30", notes: "Estate patrol" },
    ],
  });
  const requests: MatchRequest[] = [
    {
      id: id("request/north-gate-more"),
      kind: "more_places",
      shiftId: gate.id,
      eventId: gate.eventId,
      payload: { places: 4 },
      clientNote: "4 more SIA stewards at North Gate, please. The away allocation has gone up.",
      status: "waiting",
      urgent:
        urgentWhy({
          kind: "more_places",
          now: moreAt,
          startsAt: gate.startsAt,
          booked: gate.booked,
          free: gate.headcount - gate.booked,
          places: 4,
        }) !== null,
      officeAnswer: null,
      answeredAt: null,
      createdAt: moreAt,
    },
    {
      id: id("request/next-match"),
      kind: "new_event",
      shiftId: null,
      eventId: null,
      payload: nextEvent,
      clientNote: "Same set-up as this Saturday, please. Kick-off 16:30 again.",
      status: "waiting",
      urgent: false, // two weeks ahead: never within 48 hours when it's sent
      officeAnswer: null,
      answeredAt: null,
      createdAt: newEventAt,
    },
    {
      id: id("request/previous-agency-more"),
      kind: "more_places",
      shiftId: prevAgency.id,
      eventId: prevAgency.eventId,
      payload: { places: 2 },
      clientNote: "2 more for the agency area, please. The away end has sold out.",
      status: "accepted",
      urgent: false,
      officeAnswer: null,
      answeredAt: new Date(prevAgency.startsAt.getTime() - 4 * DAY),
      createdAt: new Date(prevAgency.startsAt.getTime() - 4 * DAY - 3 * HOUR),
      accepted: { from: 4, to: 6, offers: 2 },
    },
    {
      id: id("request/previous-programmes"),
      kind: "other",
      shiftId: null,
      eventId: eventOf("previous"),
      payload: { text: "Can your stewards sell match programmes at the gates before kick-off?" },
      clientNote: null,
      status: "declined",
      urgent: false,
      officeAnswer:
        "Sorry, our stewards can't sell programmes. It takes them off their posts and away from the searches.",
      answeredAt: new Date(prevGate.startsAt.getTime() - 6 * DAY + 2 * HOUR),
      createdAt: new Date(prevGate.startsAt.getTime() - 6 * DAY),
    },
  ];
  // Never after the seed's now: a request is made before it's answered, and both have happened.
  for (const r of requests) {
    if (r.createdAt.getTime() > now.getTime() || (r.answeredAt?.getTime() ?? 0) > now.getTime())
      throw new Error(`match request ${r.id} is after the seed's now`);
  }

  return {
    day,
    kickOff,
    previousDay,
    site: {
      id: MATCH_SITE_ID,
      name: "Demo Stadium",
      addressLine1: "1 Demo Road",
      town: "Exampleton",
      postcode: "ZZ1 9SR",
    },
    contract: { id: MATCH_CONTRACT_ID, name: "Demo Stadium Ltd" },
    contact: {
      ...MATCH_CLIENT_CONTACT,
      createdAt: new Date(now.getTime() - 30 * DAY),
      lastLoginAt: new Date(now.getTime() - 5 * HOUR - 10 * MINUTE),
    },
    credentialTypes: [
      { code: INDUCTION, name: "Demo Stadium ground induction", officeRecorded: true },
      { code: CHAPTER_8, name: "Chapter 8 traffic management certificate", officeRecorded: false },
    ],
    rules: [{ role: "supervisor", requiredTypes: ["SIA_DS", "STEWARD_L2"] }],
    workers,
    credentials,
    events,
    sessions,
    bookings,
    strikes,
    offers,
    payQuery,
    pay,
    requests,
  };
}
