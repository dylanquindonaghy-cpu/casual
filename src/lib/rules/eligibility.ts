import { z } from "zod";
import { HOUR, MINUTE } from "../auth/clock";
import { nextDay, wallTimeOf, zonedToUtc, type WallTime } from "../time/zoned";
import { dayLabel, REASONS, shortDate } from "./reasons";

// Can this worker take this shift? The rules engine (golden rule 1: code decides, never a model)
// as one pure function: no database, no clock, no settings lookups. Callers load everything
// (docs/rules-and-credentials.md) and pass it in; the same input always gives the same answer,
// so the rules are tested as a table.
//
// Every failing check adds a code and a plain-English reason, in the doc's order, so the screen
// can show all of them. The office may override only a started shift, rest, weekly hours and
// unavailable, with a reason the caller logs; credentials (3-4) and the rest never. Input that
// doesn't make sense (a NaN setting, a badly written date) throws: it must never let a worker
// through. When the worker may take the shift, the result carries an EligibilityPass: a token only
// this function makes (isEligibilityPass checks it), for the booking code to require.

export const RULE_CODES = [
  "started",
  "not_active",
  "wrong_role",
  "no_rule",
  "credential_missing",
  "credential_expired",
  "credential_suspended",
  "applied_over_allowance",
  "overlap",
  "rest",
  "weekly_hours",
  "unavailable",
  "blocked_site",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

// The office's overrides: never credentials, role, account, site or a double booking.
export const OVERRIDABLE_CODES = ["started", "rest", "weekly_hours", "unavailable"] as const;
export type OverridableCode = (typeof OVERRIDABLE_CODES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a yyyy-mm-dd date");
const count = z.number().int().nonnegative();
const interval = z
  .object({ startsAt: z.date(), endsAt: z.date() })
  .refine((i) => i.endsAt.getTime() > i.startsAt.getTime(), "must end after it starts");

export const eligibilityInputSchema = z.object({
  now: z.date(),
  // The firm's: dates and weeks are local.
  timeZone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "an IANA time zone"),
  worker: z.object({
    id: z.string().min(1),
    status: z.enum(["active", "inactive", "blocked"]),
    roles: z.array(z.string()),
  }),
  // expiresOn: yyyy-mm-dd, or null for a credential with no expiry.
  credentials: z.array(
    z.object({
      type: z.string().min(1),
      status: z.enum(["valid", "expired", "applied", "suspended"]),
      expiresOn: isoDate.nullable(),
    }),
  ),
  shift: z
    .object({
      id: z.string().min(1),
      role: z.string().min(1),
      siteId: z.string().nullable(),
      // From the firm's credential rule for the role; null when the firm has no rule (fails).
      requiredTypes: z.array(z.string().min(1)).nullable(),
    })
    .and(interval),
  // The worker's other confirmed bookings in every week this shift touches, +/- a day, never
  // this shift itself (a shiftId equal to shift.id is skipped anyway).
  otherAssignments: z.array(z.object({ shiftId: z.string().optional() }).and(interval)),
  unavailableDates: z.array(isoDate), // firm-local
  settings: z.object({
    minRestHours: z.number().min(0), // default 11
    weeklyHoursCap: z.number().positive(), // default 48
    travelBufferMinutes: z.number().min(0), // default 0
    appliedAllowancePct: z.number().min(0).max(100), // e.g. 15 (SIA ACS), else 0
    // The credential types an application in progress may count for (credential_types.applied_allowed:
    // SIA licences in the security pack). Any other type needs a valid credential.
    appliedAllowedTypes: z.array(z.string()),
    appliedInUseCount: count, // "applied" staff already deployed that day, not counting this worker
    deployedCount: count, // everyone deployed that day, not counting this worker
    blockedSites: z.array(z.string()), // sites this worker may not work at
  }),
  names: z.record(z.string(), z.string()).optional(), // credential type -> its name for workers
  overrides: z.array(z.enum(OVERRIDABLE_CODES)).optional(), // the office's, logged by the caller
});
export type EligibilityInput = z.input<typeof eligibilityInputSchema>;
export type CredentialStatus = EligibilityInput["credentials"][number]["status"];

declare const passBrand: unique symbol;
export interface EligibilityPass {
  readonly [passBrand]: true;
  readonly workerId: string;
  readonly shiftId: string;
  readonly overridden: readonly OverridableCode[];
}

export interface EligibilityResult {
  ok: boolean;
  reasons: string[];
  codes: RuleCode[]; // one per reason, same order
  overridden: OverridableCode[]; // checks that failed but the office overrode
  pass?: EligibilityPass;
}

const issued = new WeakSet<object>();
export function isEligibilityPass(value: unknown): value is EligibilityPass {
  return typeof value === "object" && value !== null && issued.has(value);
}

// For roster plugs, before they book: the pass must be one checkEligibility() issued, for exactly
// this worker and shift, and not used before. It is used up here, so a pass kept around can never
// book anything later. Anything else throws (a caller skipping the rules is a bug, not a result).
export function consumeEligibilityPass(
  pass: unknown,
  booking: { workerId: string; shiftId: string },
): EligibilityPass {
  if (!isEligibilityPass(pass)) {
    throw new Error("booking without an eligibility pass (a used pass counts as none)");
  }
  if (pass.workerId !== booking.workerId || pass.shiftId !== booking.shiftId) {
    throw new Error("the eligibility pass is for another worker or shift");
  }
  issued.delete(pass);
  return pass;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateOf = (w: Pick<WallTime, "year" | "month" | "day">) =>
  `${w.year}-${pad(w.month)}-${pad(w.day)}`;

// The calendar days a shift touches, in the firm's zone (a night shift touches two).
function localDates(start: Date, end: Date, timeZone: string): string[] {
  const last = dateOf(wallTimeOf(new Date(end.getTime() - 1), timeZone));
  const dates: string[] = [];
  let day: WallTime = wallTimeOf(start, timeZone);
  for (let i = 0; i < 400; i++) {
    dates.push(dateOf(day));
    if (dateOf(day) >= last) break;
    day = nextDay(day);
  }
  return dates;
}

// Monday 00:00 to the next Monday 00:00, local, around a local date.
function weekOf(date: string, timeZone: string): { from: number; to: number } {
  const [y = 2000, m = 1, d = 1] = date.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon = 0
  const back = new Date(Date.UTC(y, m - 1, d - weekday));
  let monday: WallTime = {
    year: back.getUTCFullYear(),
    month: back.getUTCMonth() + 1,
    day: back.getUTCDate(),
    hour: 0,
    minute: 0,
  };
  const from = zonedToUtc(monday, timeZone).getTime();
  for (let i = 0; i < 7; i++) monday = nextDay(monday);
  return { from, to: zonedToUtc(monday, timeZone).getTime() };
}

const clip = (a: { startsAt: Date; endsAt: Date }, from: number, to: number) =>
  Math.max(0, Math.min(a.endsAt.getTime(), to) - Math.max(a.startsAt.getTime(), from));

export function checkEligibility(raw: EligibilityInput): EligibilityResult {
  const input = eligibilityInputSchema.parse(raw); // throws on nonsense: never lets it through
  const { shift, worker, settings, timeZone } = input;
  const failures: { code: RuleCode; reason: string }[] = [];
  const fail = (code: RuleCode, reason: string) => failures.push({ code, reason });
  const name = (type: string) => input.names?.[type] ?? type.replace(/_/g, " ");
  const start = shift.startsAt.getTime();
  const end = shift.endsAt.getTime();
  const shiftYear = wallTimeOf(shift.startsAt, timeZone).year;
  const days = localDates(shift.startsAt, shift.endsAt, timeZone);
  const firstDay = days[0] ?? "";
  const lastDay = days.at(-1) ?? firstDay; // a credential must be in date to the end of the shift
  const today = dateOf(wallTimeOf(input.now, timeZone));
  const timeOf = (d: Date) => {
    const w = wallTimeOf(d, timeZone);
    return `${pad(w.hour)}:${pad(w.minute)}`;
  };

  // 0. Not a shift that has already started.
  if (start <= input.now.getTime()) fail("started", REASONS.started());

  // 1. The worker's account is active.
  if (worker.status !== "active") fail("not_active", REASONS.not_active());

  // 2. The worker has the shift's role.
  if (!worker.roles.includes(shift.role)) fail("wrong_role", REASONS.wrong_role(shift.role));

  // 3-4. Every credential the role needs, in date on every day the shift touches, or "applied"
  // within the firm's allowance. A suspended one fails whatever else is held. No rule for the
  // role means not eligible (fail closed).
  if (shift.requiredTypes === null) {
    fail("no_rule", REASONS.no_rule());
  } else {
    for (const type of shift.requiredTypes) {
      const held = input.credentials.filter((c) => c.type === type);
      if (held.some((c) => c.status === "suspended")) {
        fail("credential_suspended", REASONS.credential_suspended(name(type)));
        continue;
      }
      const inDate = held.some(
        (c) => c.status === "valid" && (c.expiresOn === null || c.expiresOn >= lastDay),
      );
      if (inDate) continue;
      const applied = held.some((c) => c.status === "applied");
      if (applied && settings.appliedAllowedTypes.includes(type)) {
        const pct = settings.appliedAllowancePct;
        const share = (settings.appliedInUseCount + 1) / (settings.deployedCount + 1);
        if (pct > 0 && share <= pct / 100) continue;
        fail("applied_over_allowance", REASONS.applied_over_allowance(name(type)));
      } else if (
        applied &&
        !held.some((c) => c.status === "expired" || (c.expiresOn !== null && c.expiresOn < lastDay))
      ) {
        // In progress, for a type where only a valid credential counts.
        fail("credential_missing", REASONS.applied_not_allowed(name(type)));
      } else if (held.length > 0) {
        // Out of date by its expiry, or marked expired by the office.
        const dated = held
          .map((c) => c.expiresOn)
          .filter((d): d is string => d !== null && d < lastDay)
          .sort()
          .at(-1);
        fail(
          "credential_expired",
          dated
            ? REASONS.credential_expired(name(type), shortDate(dated, shiftYear), dated < today)
            : REASONS.credential_marked_expired(name(type)),
        );
      } else {
        fail("credential_missing", REASONS.credential_missing(name(type)));
      }
    }
  }

  // 5. No overlap with another booking, allowing the travel buffer either side.
  const buffer = settings.travelBufferMinutes * MINUTE;
  const others = input.otherAssignments
    .filter((o) => o.shiftId !== shift.id)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const overlaps = (o: (typeof others)[number], pad: number) =>
    o.startsAt.getTime() < end + pad && start < o.endsAt.getTime() + pad;
  const clash = others.find((o) => overlaps(o, buffer));
  if (clash) {
    const time = timeOf(clash.startsAt);
    if (overlaps(clash, 0)) {
      const day = dateOf(wallTimeOf(clash.startsAt, timeZone));
      fail("overlap", REASONS.overlap(time, day === firstDay ? null : dayLabel(day)));
    } else {
      fail("overlap", REASONS.travel(time));
    }
  }

  // 6. Enough rest between this shift and the bookings either side of it.
  const minRest = settings.minRestHours * HOUR;
  const apart = others.filter((o) => o !== clash && !overlaps(o, 0)); // one reason per booking
  if (apart.some((o) => o.endsAt.getTime() <= start && start - o.endsAt.getTime() < minRest)) {
    fail("rest", REASONS.rest("previous", settings.minRestHours));
  }
  if (apart.some((o) => o.startsAt.getTime() >= end && o.startsAt.getTime() - end < minRest)) {
    fail("rest", REASONS.rest("next", settings.minRestHours));
  }

  // 7. Hours within the weekly cap in every week (Monday to Sunday, local) the shift touches,
  // each booking counting only its hours inside that week.
  const weeks = [...new Set(days.map((d) => JSON.stringify(weekOf(d, timeZone))))].map(
    (w) => JSON.parse(w) as { from: number; to: number },
  );
  const cap = settings.weeklyHoursCap * HOUR;
  const over = weeks.some(
    (w) =>
      others.reduce((sum, o) => sum + clip(o, w.from, w.to), 0) + clip(shift, w.from, w.to) > cap,
  );
  if (over) fail("weekly_hours", REASONS.weekly_hours());

  // 8. Not on a day the worker marked unavailable.
  const unavailable = new Set(input.unavailableDates);
  if (days.some((d) => unavailable.has(d))) fail("unavailable", REASONS.unavailable());

  // 9. Not a site the worker is blocked from.
  if (shift.siteId !== null && settings.blockedSites.includes(shift.siteId)) {
    fail("blocked_site", REASONS.blocked_site());
  }

  const allowed = new Set<RuleCode>(input.overrides ?? []);
  const overridden = [
    ...new Set(failures.filter((f) => allowed.has(f.code)).map((f) => f.code as OverridableCode)),
  ];
  const remaining = failures.filter((f) => !allowed.has(f.code));
  const result: EligibilityResult = {
    ok: remaining.length === 0,
    reasons: remaining.map((f) => f.reason),
    codes: remaining.map((f) => f.code),
    overridden,
  };
  if (result.ok) {
    const pass = Object.freeze({
      workerId: worker.id,
      shiftId: shift.id,
      overridden: Object.freeze([...overridden]),
    }) as unknown as EligibilityPass;
    issued.add(pass);
    result.pass = pass;
  }
  return result;
}
