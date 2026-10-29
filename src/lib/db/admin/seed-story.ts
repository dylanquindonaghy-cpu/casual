import { FIRM_CHANGE_REASONS } from "../../roster/firm-reasons";
import { addDays, localDateOf, zonedToUtc } from "../../time/zoned";
import { fakePoint } from "../../travel/geocoder";
import { fakeTrip } from "../../travel/provider";
import { strikeSettings } from "../../strikes/settings";
import { seedId, type SeedFirm } from "./seed-data";
export { STRIKES_TEAM } from "./seed-data";

// The demo's made-up story (docs/office-v2.md §9 "Demo seed"; 12I.1): Acme Events as the mock-up
// shows it, with dates relative to the day the seed runs, so weekdays are always right. Pure
// builders, loaded by seed.ts (seed-story-load.ts: loadStory). Fake data only (golden rule 7):
// invented people, places and numbers (07700 900400-900407), example addresses.
//
// - Six events: Northern Lights Live at the Arena tomorrow (door supervisor urgent 3/4, steward,
//   response team lead needing first aid), Night patrols at Northgate the day after (CSAS officer,
//   urgent 3/4), Riverside Food Festival, Raceday, Northgate Charity 10K, and Hillside Christmas
//   Market, switched off. Each session has its pay, post, meeting point and uniform.
// - Eight casuals with the mock-up's qualifications, photos, strikes and travel areas.
// - Every open place needs something only these eight hold (their own roles, CSAS officer and
//   response team lead, or a manual handling certificate as an extra), so the lists the
//   walkthrough's own workers see stay exactly as they were.
// - Past sessions for the cancellations (Kieran's two strikes, Priya's flagged for review, Mo's
//   withdrawn, the office's cancellation of Tom) and two pay groups payroll has sorted.
// - Pay for Zoe and Ben (Phase 24: the mock-up's Pay): Zoe's last five complete weeks, the newest
//   with two rates (£324.00 in all), and Ben's last two, the newest with one line payroll gave no
//   gross for (so no week total shows: only payroll's own grosses).
// - Ids are fixed and undated: added once, so a re-run changes nothing (`npm run db:reset` moves
//   the story to a new day).

const TZ = "Europe/London";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const STORY_LINE = "+447700900000"; // Acme's shifts line (seed-data.ts)

const id = (name: string) => seedId(`acme/story/${name}`);

export type StoryKey = "zoe" | "kieran" | "ben" | "priya" | "leah" | "jamal" | "mo" | "tom";

export interface StoryWorker {
  key: StoryKey;
  id: string;
  firstName: string;
  lastName: string;
  mobileE164: string;
  email: string | null;
  roles: string[];
  travel: { startPostcode: string; modes: "car" | "public_transport" | "both"; maxMinutes: number };
}

export interface StorySite {
  id: string;
  name: string;
  town: string;
  postcode: string;
}

export interface StoryEvent {
  id: string;
  name: string;
  siteId: string;
  showing: boolean;
}

export interface StorySession {
  id: string;
  eventId: string | null; // null: its site and day's automatic event (the past ones)
  siteId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  status: "open" | "filled";
  isUrgent: boolean;
  payRatePence: number;
  post: string;
  meetingPoint: string;
  uniform: string;
  requiredCredentials: string[];
  createdAt: Date;
  // Why it's urgent: the office marked it, or the system did when someone dropped out inside the
  // firm's urgent window (as src/lib/roster/urgent.ts does). Null: not urgent.
  urgentCause: "office" | "dropout" | null;
}

export interface StoryBooking {
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
  // The place it freed, reopened (an open row for the same slot), when a booking was cancelled.
  reopenedId: string | null;
}

export interface StoryStrike {
  id: string;
  bookingId: string;
  workerId: string;
  shiftId: string;
  noticeHours: number;
  issuedAt: Date;
  expiresAt: Date;
  reviewReasons: ("unwell" | "family_or_caring")[];
  withdrawn: { at: Date; reason: string } | null;
}

export interface StoryCredential {
  id: string;
  workerId: string;
  type: string;
  number: string | null;
  expiresOn: string | null;
  status: "valid" | "expired";
  checkState: "verified" | "waiting";
  uploadId: string | null; // the image it came from (her renewal waiting for the office)
}

export interface StoryUpload {
  id: string;
  workerId: string;
  kind: "photo" | "certificate";
  credentialType: string | null;
  status: "approved" | "waiting";
  createdAt: Date;
  checkedAt: Date | null; // approved: when the office checked it
}

export interface StoryMessage {
  id: string;
  workerKey: StoryKey;
  body: string;
  receivedAt: Date;
}

export interface StoryPayQuery {
  id: string;
  workerId: string;
  shiftId: string;
  workDate: string;
  issue: "missing_hours" | "wrong_rate";
  details: string;
  createdAt: Date;
  resolvedAt: Date;
  note: string;
}

// A pay line as payroll's file gives it (pay_records), for a story casual's Pay page (Phase 24).
// `grossPence` null: payroll gave no gross for that line.
export interface StoryPay {
  id: string;
  workerId: string;
  periodStart: string;
  periodEnd: string;
  hours: string;
  ratePence: number;
  grossPence: number | null;
  payDate: string;
}

export interface StoryEstimate {
  originPostcode: string;
  siteId: string;
  mode: "car" | "public_transport";
  arriveBy: Date;
  minutes: number | null;
  metres: number | null;
  expiresAt: Date;
}

export interface StorySeed {
  today: string;
  sites: StorySite[];
  workers: StoryWorker[];
  rules: { role: string; requiredTypes: string[] }[];
  credentials: StoryCredential[];
  uploads: StoryUpload[];
  events: StoryEvent[];
  sessions: StorySession[];
  bookings: StoryBooking[];
  strikes: StoryStrike[];
  estimates: StoryEstimate[];
  messages: StoryMessage[];
  payQueries: StoryPayQuery[];
  pay: StoryPay[];
}

// Two small made-up images (a grey silhouette and a blank card), so the office's pages show a
// picture for each upload. Never anyone's photo.
export const STORY_PHOTO_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdB" +
    "RkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09P" +
    "T09PT09PT09PT09PT0//wAARCABgAGADASIAAhEBAxEB/8QAGQABAAMBAQAAAAAAAAAAAAAAAAQFBgIB/8QAMBAAAgIBAgMF" +
    "BwQDAAAAAAAAAAECAxEEBRIhYSIxUcHwBhNBgZGhsRQjcdEyQuH/xAAXAQEBAQEAAAAAAAAAAAAAAAAAAgED/8QAFhEBAQEA" +
    "AAAAAAAAAAAAAAAAAAER/9oADAMBAAIRAxEAPwDZgA6oAAAAIt+46PTy4bdRBSy01HtNY8cdwYlAh1broLZcMdTBPGe1mK+r" +
    "JgAABoAAAAAAEXc7np9uvsjniUcJp4azyz9wxUbzu3veLTaWX7fdOa/26Lp+f476QAtgWm0bo9JJU3Nuhv5w6rp09OrAY3cZ" +
    "KUVKLTi1lNPkz0rdhudu2xUs5rk4Zbzn4+ePkWRCgABoAABD3et27XfGLWVHi59HnyJgDGDBabvtb0kndSm6G/nDo+nX06st" +
    "IATts26euty8xpi+1PyXUC69nq3DbeJtYsm5LH08i0Oa4RrrjXBYjFJJeCR0QoAAaAAADyUlGLlJpRSy23yRnNy3qy6UqtJJ" +
    "11J/5rKlL+l66CRi41W46KmMoXWwm8NOEe034p/9M9q79tssTo0lsV3vFijl/wAYf2IAKkZqbp7dvjbm7S3Sg1zzbnHySX5L" +
    "/Sbnt861CqcKUk3wSXAlz+hkwLDW8Bldu3e7SNV2N205XJvLiun9fg09VsLqo21SUoSWU0TZjXYADQA4usVNM7ZJuMIuTx38" +
    "gKH2g16nL9HVJOMXmxp/Hw9eRSHVk5WWSsm8yk22/Fs5LiQABgAABabHr1pdQ6rZJU2vm2+UX4+vIqwBvAR9vvep0NNzy5Sj" +
    "2m1jLXJ/dEghQQd6k47Te4tp4S5PxaJxE3Wv3u2aiOcYhxd3hz8hBjgAWkAAAAAAABp/ZyTe3STbajY0svu5ItSs9n6+DbIy" +
    "zn3k3Lu7vh5FmRVR/9k=",
  "base64",
);
export const STORY_CERTIFICATE_JPEG = Buffer.from(
  "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" +
    "AAAAAAAAAAAAAAAAAAAAAAf/2Q==",
  "base64",
);

function at(date: string, time: string): Date {
  const [year = 2000, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return zonedToUtc({ year, month, day, hour, minute }, TZ);
}

// "3 years ago, less 20 days" and the like, from the seed day.
const monthsAgo = (now: Date, months: number, plusDays = 0) => {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return new Date(d.getTime() + plusDays * DAY);
};

export function acmeStory(firm: SeedFirm, now: Date): StorySeed {
  const today = localDateOf(now, TZ);
  const on = (offset: number, time: string) => at(addDays(today, offset), time);
  const iso = (offset: number) => addDays(today, offset);

  const arena = siteNamed(firm, "Acme Demo Arena");
  const racecourse = siteNamed(firm, "Acme Demo Racecourse");
  const sites: StorySite[] = [
    {
      id: id("site/northgate"),
      name: "Northgate Demo Town Centre",
      town: "Exampleton",
      postcode: "ZZ6 1AA",
    },
    {
      id: id("site/common"),
      name: "Northgate Demo Common",
      town: "Exampleton",
      postcode: "ZZ6 5CC",
    },
    {
      id: id("site/riverside"),
      name: "Riverside Demo Park",
      town: "Exampleton",
      postcode: "ZZ7 2AB",
    },
    {
      id: id("site/hillside"),
      name: "Hillside Demo Square",
      town: "Sampleford",
      postcode: "ZZ8 1AA",
    },
  ];
  const [northgate, common, riverside, hillside] = sites.map((s) => s.id) as [
    string,
    string,
    string,
    string,
  ];

  const person = (
    key: StoryKey,
    n: number,
    firstName: string,
    lastName: string,
    roles: string[],
    travel: StoryWorker["travel"],
  ): StoryWorker => ({
    key,
    id: id(`worker/${key}`),
    firstName,
    lastName,
    mobileE164: `+447700900${400 + n}`,
    email: n % 2 === 0 ? `${key}.${lastName.toLowerCase()}@example.com` : null,
    roles,
    travel,
  });
  const workers: StoryWorker[] = [
    person("zoe", 0, "Zoe", "Adeyemi", ["door_supervisor", "steward", "csas_officer"], {
      startPostcode: "ZZ1 4DE",
      modes: "both",
      maxMinutes: 45,
    }),
    person("kieran", 1, "Kieran", "Doyle", ["door_supervisor"], {
      startPostcode: "ZZ2 3AB",
      modes: "car",
      maxMinutes: 60,
    }),
    person("ben", 2, "Ben", "Fraser", ["steward"], {
      startPostcode: "ZZ3 2CD",
      modes: "public_transport",
      maxMinutes: 45,
    }),
    person("priya", 3, "Priya", "Shah", ["door_supervisor", "steward"], {
      startPostcode: "ZZ1 5EF",
      modes: "both",
      maxMinutes: 60,
    }),
    person("leah", 4, "Leah", "Ward", ["door_supervisor"], {
      startPostcode: "ZZ2 6GH",
      modes: "car",
      maxMinutes: 30,
    }),
    person("jamal", 5, "Jamal", "Morgan", ["csas_officer", "door_supervisor"], {
      startPostcode: "ZZ6 2JK",
      modes: "both",
      maxMinutes: 45,
    }),
    person("mo", 6, "Mo", "Rahman", ["csas_officer", "steward"], {
      startPostcode: "ZZ6 3LM",
      modes: "public_transport",
      maxMinutes: 60,
    }),
    person("tom", 7, "Tom", "Hale", ["csas_officer", "response_team_lead", "door_supervisor"], {
      startPostcode: "ZZ1 7NP",
      modes: "car",
      maxMinutes: 90,
    }),
  ];
  const w = (key: StoryKey) => {
    const found = workers.find((x) => x.key === key);
    if (!found) throw new Error(`no story worker ${key}`);
    return found.id;
  };

  // Qualifications, each checked by the office unless it's her renewal waiting.
  const credentials: StoryCredential[] = [];
  const held = (
    key: StoryKey,
    type: string,
    expiresOn: string | null,
    status: StoryCredential["status"] = "valid",
  ) =>
    credentials.push({
      id: id(`credential/${key}/${type}`),
      workerId: w(key),
      type,
      number: `TEST-${type}-S${String(workers.findIndex((x) => x.key === key)).padStart(3, "0")}`,
      expiresOn,
      status,
      checkState: "verified",
      uploadId: null,
    });
  held("zoe", "SIA_DS", iso(420));
  held("zoe", "STEWARD_L2", null);
  held("zoe", "CSAS", iso(510));
  held("zoe", "MANUAL_HANDLING", iso(22)); // expiring in 22 days; no first aid
  // Ran out 5 days ago: after his two past shifts (the rules allowed those bookings).
  held("kieran", "SIA_DS", iso(-5));
  held("ben", "STEWARD_L2", null);
  held("ben", "MANUAL_HANDLING", iso(300));
  held("priya", "SIA_DS", iso(600));
  held("priya", "STEWARD_L2", null);
  held("priya", "MANUAL_HANDLING", iso(250));
  held("leah", "SIA_DS", iso(12)); // expiring in 12 days; her new one waiting
  held("leah", "MANUAL_HANDLING", iso(400));
  held("jamal", "CSAS", iso(380));
  held("jamal", "SIA_DS", iso(700));
  held("jamal", "MANUAL_HANDLING", iso(200));
  held("mo", "CSAS", iso(290));
  held("mo", "STEWARD_L2", null);
  held("mo", "MANUAL_HANDLING", iso(320));
  held("tom", "CSAS", iso(450));
  held("tom", "SIA_DS", iso(530));
  held("tom", "FIRST_AID", iso(610));
  held("tom", "MANUAL_HANDLING", iso(180));

  // Photos (the office checked each), Ben's new one and Leah's new licence waiting.
  const resourcerCheck = (created: Date) => new Date(created.getTime() + 3 * HOUR);
  const photo = (key: StoryKey, created: Date, status: StoryUpload["status"] = "approved") => ({
    id: id(`upload/${key}/photo/${status}`),
    workerId: w(key),
    kind: "photo" as const,
    credentialType: null,
    status,
    createdAt: created,
    checkedAt: status === "approved" ? resourcerCheck(created) : null,
  });
  const uploads: StoryUpload[] = [
    photo("zoe", monthsAgo(now, 36, 20)), // due soon: renew by in 20 days
    photo("kieran", monthsAgo(now, 14)),
    photo("ben", monthsAgo(now, 26)),
    photo("ben", new Date(now.getTime() - 20 * HOUR), "waiting"),
    photo("priya", monthsAgo(now, 9)),
    photo("jamal", monthsAgo(now, 18)),
    photo("mo", monthsAgo(now, 5)),
    photo("tom", monthsAgo(now, 30)),
    {
      id: id("upload/leah/SIA_DS/waiting"),
      workerId: w("leah"),
      kind: "certificate",
      credentialType: "SIA_DS",
      status: "waiting",
      createdAt: new Date(now.getTime() - 30 * HOUR),
      checkedAt: null,
    },
  ];
  // Her new licence as sent: waiting for the office (a waiting record is never valid until checked).
  credentials.push({
    id: id("credential/leah/SIA_DS/renewal"),
    workerId: w("leah"),
    type: "SIA_DS",
    number: null,
    expiresOn: null,
    status: "expired",
    checkState: "waiting",
    uploadId: id("upload/leah/SIA_DS/waiting"),
  });

  // The six events.
  const event = (key: string, name: string, siteId: string, showing = true): StoryEvent => ({
    id: id(`event/${key}`),
    name,
    siteId,
    showing,
  });
  const events: StoryEvent[] = [
    event("northern-lights", "Northern Lights Live", arena),
    event("night-patrols", "Night patrols", northgate),
    event("riverside", "Riverside Food Festival", riverside),
    event("raceday", "Raceday", racecourse),
    event("charity-10k", "Northgate Charity 10K", common),
    event("hillside", "Hillside Christmas Market", hillside, false),
  ];
  const ev = (key: string) => id(`event/${key}`);

  const created = new Date(now.getTime() - 21 * DAY);
  const S = {
    ds: {
      payRatePence: 1550,
      uniform: "Black suit and tie, white shirt, your SIA badge on show",
    },
    steward: {
      payRatePence: 1260,
      uniform: "Hi-vis tabard (we provide it), black trousers, comfortable shoes",
    },
    csas: { payRatePence: 1500, uniform: "Your CSAS tabard and card, black trousers" },
    rtl: { payRatePence: 1700, uniform: "Black suit, red lanyard (collect at the briefing)" },
  };
  const session = (
    key: string,
    o: {
      event: string | null;
      site: string;
      role: string;
      start: Date;
      hours: number;
      headcount: number;
      booked: number;
      urgent?: boolean;
      dropout?: boolean; // made urgent by a dropout (its booking cancelled inside the urgent window)
      post: string;
      meet: string;
      needs?: string[];
      pay: { payRatePence: number; uniform: string };
    },
  ): StorySession => ({
    id: id(`session/${key}`),
    eventId: o.event ? ev(o.event) : null,
    siteId: o.site,
    role: o.role,
    startsAt: o.start,
    endsAt: new Date(o.start.getTime() + o.hours * HOUR),
    headcount: o.headcount,
    status: o.booked >= o.headcount ? "filled" : "open",
    isUrgent: (o.urgent ?? false) || (o.dropout ?? false),
    urgentCause: o.dropout ? "dropout" : o.urgent ? "office" : null,
    payRatePence: o.pay.payRatePence,
    post: o.post,
    meetingPoint: o.meet,
    uniform: o.pay.uniform,
    requiredCredentials: o.needs ?? [],
    // Added 3 weeks ago, or a week before it starts if that's earlier: before anyone booked it.
    createdAt: new Date(Math.min(created.getTime(), o.start.getTime() - 7 * DAY)),
  });
  const MH = ["MANUAL_HANDLING"];
  const sessions: StorySession[] = [
    // Northern Lights Live, tomorrow at the Arena.
    session("nl-door", {
      event: "northern-lights",
      site: arena,
      role: "door_supervisor",
      start: on(1, "08:00"),
      hours: 8,
      headcount: 4,
      booked: 3,
      urgent: true,
      post: "Gate A",
      meet: "Staff entrance on Arena Way",
      needs: MH,
      pay: S.ds,
    }),
    session("nl-steward", {
      event: "northern-lights",
      site: arena,
      role: "steward",
      start: on(1, "10:00"),
      hours: 8,
      headcount: 2,
      booked: 2,
      post: "Concourse B",
      meet: "Steward briefing room, north stand",
      pay: S.steward,
    }),
    session("nl-lead", {
      event: "northern-lights",
      site: arena,
      role: "response_team_lead",
      start: on(1, "09:00"),
      hours: 8,
      headcount: 1,
      booked: 0,
      post: "Control room",
      meet: "Control room, level 2",
      needs: ["FIRST_AID"],
      pay: S.rtl,
    }),
    // Night patrols, Northgate, the day after.
    session("np-csas", {
      event: "night-patrols",
      site: northgate,
      role: "csas_officer",
      start: on(2, "19:00"),
      hours: 6,
      headcount: 4,
      booked: 3,
      urgent: true,
      post: "Market Square patrol",
      meet: "The Demo Town Centre police box",
      pay: S.csas,
    }),
    // Riverside Food Festival: Zoe's next shift, then a second day.
    session("rf-day1", {
      event: "riverside",
      site: riverside,
      role: "steward",
      // 14:00: 13 hours after the night patrols end (the rules' 11 hours' rest), so she can see them.
      start: on(3, "14:00"),
      hours: 8,
      headcount: 2,
      booked: 2,
      post: "Gate 2",
      meet: "Volunteer tent by the river gate",
      pay: S.steward,
    }),
    session("rf-day2", {
      event: "riverside",
      site: riverside,
      role: "steward",
      start: on(4, "11:00"),
      hours: 8,
      headcount: 3,
      booked: 0,
      post: "Gate 2",
      meet: "Volunteer tent by the river gate",
      needs: MH,
      pay: S.steward,
    }),
    // Raceday at the Racecourse (further than Zoe travels).
    session("raceday-door", {
      event: "raceday",
      site: racecourse,
      role: "door_supervisor",
      start: on(5, "12:00"),
      hours: 8,
      headcount: 3,
      booked: 0,
      post: "Paddock gate",
      meet: "Main stand reception",
      needs: MH,
      pay: S.ds,
    }),
    // More at the Arena and Northgate, inside her area.
    session("nl-evening", {
      event: "northern-lights",
      site: arena,
      role: "steward",
      start: on(6, "18:00"),
      hours: 5,
      headcount: 4,
      booked: 0,
      post: "Concourse A",
      meet: "Steward briefing room, north stand",
      needs: MH,
      pay: S.steward,
    }),
    session("np-door", {
      event: "night-patrols",
      site: northgate,
      role: "door_supervisor",
      start: on(7, "20:00"),
      hours: 6,
      headcount: 2,
      booked: 0,
      post: "Station Road",
      meet: "The Demo Town Centre police box",
      needs: MH,
      pay: S.ds,
    }),
    // Northgate Charity 10K (further than Zoe travels).
    session("10k-steward", {
      event: "charity-10k",
      site: common,
      role: "steward",
      start: on(8, "07:00"),
      hours: 6,
      headcount: 6,
      booked: 0,
      post: "Mile 3 water station",
      meet: "Start line marquee",
      needs: MH,
      pay: S.steward,
    }),
    // Hillside Christmas Market: switched off, so no casual sees it.
    session("hillside-steward", {
      event: "hillside",
      site: hillside,
      role: "steward",
      start: on(20, "10:00"),
      hours: 8,
      headcount: 4,
      booked: 0,
      post: "Market entrance",
      meet: "Market office",
      needs: MH,
      pay: S.steward,
    }),
    // Past sessions: the cancellations and strikes, and the sorted pay groups.
    session("past-kieran-1", {
      event: null,
      site: arena,
      role: "door_supervisor",
      start: on(-20, "18:00"),
      hours: 8,
      headcount: 1,
      booked: 1,
      dropout: true,
      post: "Gate C",
      meet: "Staff entrance on Arena Way",
      pay: S.ds,
    }),
    session("past-kieran-2", {
      event: null,
      site: arena,
      role: "door_supervisor",
      start: on(-8, "08:00"),
      hours: 8,
      headcount: 1,
      booked: 1,
      dropout: true,
      post: "Gate A",
      meet: "Staff entrance on Arena Way",
      pay: S.ds,
    }),
    session("past-priya", {
      event: null,
      site: riverside,
      role: "steward",
      start: on(-12, "11:00"),
      hours: 8,
      headcount: 1,
      booked: 1,
      post: "Gate 1",
      meet: "Volunteer tent by the river gate",
      pay: S.steward,
    }),
    session("past-mo", {
      event: null,
      site: northgate,
      role: "csas_officer",
      start: on(-30, "19:00"),
      hours: 6,
      headcount: 1,
      booked: 1,
      dropout: true,
      post: "Market Square patrol",
      meet: "The Demo Town Centre police box",
      pay: S.csas,
    }),
    session("past-tom", {
      event: null,
      site: racecourse,
      role: "door_supervisor",
      start: on(-9, "12:00"),
      hours: 8,
      headcount: 1,
      booked: 1,
      post: "Paddock gate",
      meet: "Main stand reception",
      pay: S.ds,
    }),
    session("past-patrol", {
      event: null,
      site: northgate,
      role: "csas_officer",
      start: on(-14, "19:00"),
      hours: 6,
      headcount: 2,
      booked: 2,
      post: "Market Square patrol",
      meet: "The Demo Town Centre police box",
      pay: S.csas,
    }),
    session("past-riverside", {
      event: null,
      site: riverside,
      role: "steward",
      start: on(-15, "11:00"),
      hours: 8,
      headcount: 2,
      booked: 2,
      post: "Gate 2",
      meet: "Volunteer tent by the river gate",
      pay: S.steward,
    }),
  ];
  const sessionOf = (key: string) => {
    const s = sessions.find((x) => x.id === id(`session/${key}`));
    if (!s) throw new Error(`no story session ${key}`);
    return s;
  };

  // Bookings: who's on what, each booked a while before (as the app would have).
  const bookings: StoryBooking[] = [];
  const book = (
    session: string,
    key: StoryKey,
    slot: number,
    o: {
      status?: StoryBooking["status"];
      cancelledHoursBefore?: number;
      reason?: string;
      via?: "app" | "office";
    } = {},
  ) => {
    const s = sessionOf(session);
    const confirmedAt = new Date(s.startsAt.getTime() - 6 * DAY);
    const cancelledAt =
      o.cancelledHoursBefore !== undefined
        ? new Date(s.startsAt.getTime() - o.cancelledHoursBefore * HOUR)
        : null;
    const status = o.status ?? "confirmed";
    bookings.push({
      id: id(`booking/${session}/${key}`),
      shiftId: s.id,
      slot,
      workerId: w(key),
      status,
      confirmedAt,
      bookedNoticeHours: 6 * 24,
      cancelledAt,
      cancelReason: o.reason ?? null,
      noticeHours: o.cancelledHoursBefore ?? null,
      cancelVia: o.via ?? null,
      reopenedId: cancelledAt ? id(`booking/${session}/reopened`) : null,
    });
  };
  book("nl-door", "priya", 1);
  book("nl-door", "leah", 2);
  book("nl-door", "jamal", 3);
  book("nl-steward", "ben", 1);
  book("nl-steward", "mo", 2);
  book("np-csas", "jamal", 1);
  book("np-csas", "mo", 2);
  book("np-csas", "tom", 3);
  book("rf-day1", "zoe", 1);
  book("rf-day1", "ben", 2);
  book("past-kieran-1", "kieran", 1, {
    status: "cancelled_worker",
    cancelledHoursBefore: 20,
    reason: "Travel problem",
    via: "app",
  });
  book("past-kieran-2", "kieran", 1, {
    status: "cancelled_worker",
    cancelledHoursBefore: 6,
    reason: "Something else: overslept",
    via: "app",
  });
  book("past-priya", "priya", 1, {
    status: "cancelled_worker",
    cancelledHoursBefore: 30,
    reason: "I'm unwell",
    via: "app",
  });
  book("past-mo", "mo", 1, {
    status: "cancelled_worker",
    cancelledHoursBefore: 10,
    reason: "Travel problem",
    via: "app",
  });
  book("past-tom", "tom", 1, {
    status: "cancelled_firm",
    cancelledHoursBefore: 30,
    reason: FIRM_CHANGE_REASONS.weather,
    via: "office",
  });
  book("past-patrol", "jamal", 1, { status: "completed" });
  book("past-patrol", "mo", 2, { status: "completed" });
  book("past-riverside", "ben", 1, { status: "completed" });
  book("past-riverside", "priya", 2, { status: "completed" });

  // Strikes: each casual's own cancellation inside the firm's notice, issued as it was cancelled,
  // counting for the firm's strikes.live_days.
  const { liveDays } = strikeSettings(firm.settings);
  const strikeFor = (
    session: string,
    key: StoryKey,
    o: {
      review?: StoryStrike["reviewReasons"];
      withdrawn?: { afterHours: number; reason: string };
    } = {},
  ): StoryStrike => {
    const b = bookings.find((x) => x.id === id(`booking/${session}/${key}`));
    if (!b?.cancelledAt || b.noticeHours === null) throw new Error(`no cancellation ${session}`);
    return {
      id: id(`strike/${session}/${key}`),
      bookingId: b.id,
      workerId: b.workerId,
      shiftId: b.shiftId,
      noticeHours: b.noticeHours,
      issuedAt: b.cancelledAt,
      expiresAt: new Date(b.cancelledAt.getTime() + liveDays * DAY),
      reviewReasons: o.review ?? [],
      withdrawn: o.withdrawn
        ? {
            at: new Date(b.cancelledAt.getTime() + o.withdrawn.afterHours * HOUR),
            reason: o.withdrawn.reason,
          }
        : null,
    };
  };
  const strikes: StoryStrike[] = [
    strikeFor("past-kieran-1", "kieran"),
    strikeFor("past-kieran-2", "kieran"),
    strikeFor("past-priya", "priya", { review: ["unwell"] }),
    strikeFor("past-mo", "mo", {
      withdrawn: {
        afterHours: 26,
        reason: "His car broke down on the way in. He sent us the breakdown service's report.",
      },
    }),
  ];

  // Fixed travel times: Zoe's from the mock-up; everyone else's from the fake provider's own
  // reckoning, so they never change.
  const ZOE_TRIPS: Record<string, { metres: number; car: number; pt: number }> = {
    [arena]: { metres: 4989, car: 12, pt: 24 },
    [northgate]: { metres: 13518, car: 21, pt: 38 },
    [riverside]: { metres: 8047, car: 15, pt: 31 },
    [racecourse]: { metres: 30577, car: 52, pt: 75 },
    [common]: { metres: 33796, car: 55, pt: 80 },
    [hillside]: { metres: 16093, car: 30, pt: 50 },
  };
  const sitePoint = new Map(
    [...firm.sites, ...sites].map((s) => [s.id, fakePoint(s.postcode)] as const),
  );
  const estimates: StoryEstimate[] = [];
  const origins = [...new Set(workers.map((x) => x.travel.startPostcode))];
  for (const s of sessions.filter((x) => x.startsAt.getTime() > now.getTime())) {
    const arriveBy = new Date(s.startsAt.getTime() - 30 * 60_000);
    const expiresAt = new Date(s.endsAt.getTime() + 7 * DAY);
    for (const origin of origins) {
      if (
        estimates.some(
          (e) =>
            e.originPostcode === origin &&
            e.siteId === s.siteId &&
            e.arriveBy.getTime() === arriveBy.getTime(),
        )
      )
        continue;
      const fixed = origin === "ZZ1 4DE" ? ZOE_TRIPS[s.siteId] : undefined;
      const from = fakePoint(origin);
      const to = sitePoint.get(s.siteId);
      if (!from || !to) throw new Error(`no fake point for ${origin} or ${s.siteId}`);
      const car = fixed ? { minutes: fixed.car, metres: fixed.metres } : fakeTrip(from, to, "car");
      const pt = fixed
        ? { minutes: fixed.pt, metres: null }
        : fakeTrip(from, to, "public_transport");
      estimates.push(
        {
          originPostcode: origin,
          siteId: s.siteId,
          mode: "car",
          arriveBy,
          minutes: car?.minutes ?? null,
          metres: car?.metres ?? null,
          expiresAt,
        },
        {
          originPostcode: origin,
          siteId: s.siteId,
          mode: "public_transport",
          arriveBy,
          minutes: pt?.minutes ?? null,
          metres: null,
          expiresAt,
        },
      );
    }
  }

  // The shifts line: Zoe asks for shifts, Ben about his pay, Kieran to cancel, just before the seed
  // ran. The job worker answers them with the app's own replies when it runs (seed-story-load.ts).
  const messages: StoryMessage[] = [
    {
      id: id("message/zoe"),
      workerKey: "zoe",
      body: "Hi, any shifts for me?",
      receivedAt: new Date(now.getTime() - 3 * 60_000),
    },
    {
      id: id("message/ben"),
      workerKey: "ben",
      body: "When will I get paid for the food festival?",
      receivedAt: new Date(now.getTime() - 2 * 60_000),
    },
    {
      id: id("message/kieran"),
      workerKey: "kieran",
      body: "I need to cancel please",
      receivedAt: new Date(now.getTime() - 60_000),
    },
  ];

  // Two pay groups payroll has sorted (the existing 10 open queries stay as they are).
  const sorted = (
    session: string,
    key: StoryKey,
    issue: StoryPayQuery["issue"],
    details: string,
    note: string,
  ): StoryPayQuery => {
    const s = sessionOf(session);
    const createdAt = new Date(s.endsAt.getTime() + 4 * DAY);
    return {
      id: id(`pay-query/${session}/${key}`),
      workerId: w(key),
      shiftId: s.id,
      workDate: localDateOf(s.startsAt, TZ),
      issue,
      details,
      createdAt,
      resolvedAt: new Date(createdAt.getTime() + 2 * DAY),
      note,
    };
  };
  const payQueries: StoryPayQuery[] = [
    sorted(
      "past-patrol",
      "jamal",
      "wrong_rate",
      "Paid £13.50 an hour, not £15.00.",
      "The new CSAS rate goes on the next pay run.",
    ),
    sorted(
      "past-patrol",
      "mo",
      "wrong_rate",
      "My rate looks lower than it should be.",
      "The new CSAS rate goes on the next pay run.",
    ),
    sorted(
      "past-riverside",
      "ben",
      "missing_hours",
      "Only 6 hours paid, I worked 8.",
      "The missing 2 hours are on the next pay run.",
    ),
    sorted(
      "past-riverside",
      "priya",
      "missing_hours",
      "Two hours missing from the festival.",
      "The missing 2 hours are on the next pay run.",
    ),
  ];

  // Pay: complete Monday-to-Sunday weeks before this one, paid the Friday after (D8), as payroll's
  // file gives them. Week 1 is the last complete week. Undated ids: added once.
  const thisMonday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const payLine = (
    key: StoryKey,
    week: number,
    hours: number,
    ratePence: number,
    gross: "given" | "not given" = "given",
  ): StoryPay => {
    const periodStart = addDays(thisMonday, -7 * week);
    const periodEnd = addDays(periodStart, 6);
    return {
      id: id(`pay/${key}/${week}/${ratePence}`),
      workerId: w(key),
      periodStart,
      periodEnd,
      hours: hours.toFixed(2),
      ratePence,
      grossPence: gross === "given" ? Math.round(hours * ratePence) : null,
      payDate: addDays(periodEnd, 5),
    };
  };
  const pay: StoryPay[] = [
    payLine("zoe", 1, 16, 1250),
    payLine("zoe", 1, 8, 1550),
    payLine("zoe", 2, 16, 1250),
    payLine("zoe", 3, 24, 1250),
    payLine("zoe", 4, 8, 1550),
    payLine("zoe", 5, 16, 1250),
    payLine("ben", 1, 12, 1260),
    payLine("ben", 1, 4, 1550, "not given"),
    payLine("ben", 2, 6, 1260),
  ];

  return {
    today,
    sites,
    workers,
    rules: [{ role: "response_team_lead", requiredTypes: ["SIA_DS"] }],
    credentials,
    uploads,
    events,
    sessions,
    bookings,
    strikes,
    estimates,
    messages,
    payQueries,
    pay,
  };
}

function siteNamed(firm: SeedFirm, name: string): string {
  const site = firm.sites.find((s) => s.name === name);
  if (!site) throw new Error(`no seeded site ${name}`);
  return site.id;
}
