import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { messages } from "./messages";
import { officeUsers, workers } from "./people";
import { firms, SECTORS, sites } from "./tenancy";

// The rota (Phase 2). Links between firm tables are composite (firm_id, x_id) foreign keys, as in
// people.ts. Every unique key starts with firm_id: Postgres checks unique indexes before foreign
// keys, so a key without it would let Firm A tell from the error code whether Firm B's slot is
// filled (by pointing a row at Firm B's shift). None of the foreign keys has an ON DELETE action: shifts, assignments, requests and offers are the
// evidence behind the notice report, so deleting a worker, site or shift they point at fails
// instead of erasing or orphaning that history. The app role can't delete these rows at all
// (TABLE_ACCESS); shifts and assignments are cancelled, never removed.

// Roles are data ('steward', 'door_supervisor', 'track_operative'...), matched exactly between
// shifts, credential_rules and workers.roles, so they share one spelling rule. The roster
// adapters' zod schemas use the same pattern (src/lib/roster/plug.ts).
export const ROLE_PATTERN = "^[a-z][a-z0-9_]*$";
// It is pasted into SQL text below, so it must stay a simple pattern: no quote or backslash (which
// would break the SQL, and where JS and Postgres regexes start to differ).
if (/['\\]/.test(ROLE_PATTERN)) throw new Error("ROLE_PATTERN must not contain ' or \\");
const roleFormat = (column: AnyPgColumn) => sql`${column} ~ ${sql.raw(`'${ROLE_PATTERN}'`)}`;

export const SHIFT_STATUSES = ["draft", "open", "filled", "cancelled"] as const;
// `api`: sent by the firm's planner through the API (S11, 12J.1; docs/office-v2.md 5.3.2).
export const SHIFT_SOURCES = ["native", "sheets", "csv", "api"] as const;

export const ASSIGNMENT_STATUSES = [
  "open",
  "offered",
  "confirmed",
  "cancelled_worker",
  "cancelled_firm",
  "no_show",
  "completed",
] as const;
// A cancelled row keeps its worker, reason and notice hours; a new open row reopens the slot.
export const CANCELLED_ASSIGNMENT_STATUSES = ["cancelled_worker", "cancelled_firm"] as const;
// Where a cancellation was made (12C.1, S3): the casual in the app, the office, the firm's rota
// sheet, a file import or the firm's planner through the API (S11, 12J.1). Empty on rows from
// before.
export const CANCEL_VIAS = ["app", "office", "sheet", "import", "api"] as const;
export type CancelVia = (typeof CANCEL_VIAS)[number];
// Where a booking was made (P2.2): the casual in the app (a shift they took, an offer they
// accepted), the office, the firm's rota sheet, or the firm's own system through the API (P5).
// "Who sends what" reads it (P2.3): a booking the firm's own system made may be its to confirm and
// remind. Empty on an open slot, and on a booking with no record of who made it: counted as the
// office's, as a strike's is (src/lib/strikes/issue.ts).
export const BOOK_VIAS = ["app", "office", "sheet", "api"] as const;
export type BookVia = (typeof BOOK_VIAS)[number];
// Who asked for a cancellation (P3.4), apart from who carried it out: the casual, the firm, its
// client, or not known.
export const CANCEL_ASKERS = ["casual", "firm", "client", "unknown"] as const;
export type CancelAsker = (typeof CANCEL_ASKERS)[number];

// review: the worker asks the office to look again at a shift the rules won't let them take.
export const REQUEST_TYPES = ["time_change", "swap", "availability", "general", "review"] as const;
export const REQUEST_STATUSES = [
  "open",
  "approved",
  "declined",
  "auto_resolved",
  "escalated",
] as const;

// How an offer went (P2.4: a push to their phones first, else a WhatsApp or text, else email).
export const OFFER_CHANNELS = ["push", "whatsapp", "sms", "email"] as const;
// failed: the message couldn't be sent (kept as evidence of the attempt; never counts as offered).
export const OFFER_RESPONSES = [
  "accepted",
  "declined",
  "expired",
  "filled_elsewhere",
  "failed",
] as const;

// The credential types a firm uses: code, the name workers know it by, and whether an application
// "in progress" may count within the firm's allowance (an SIA approved-contractor rule, so only
// SIA licences by default). Seeded per firm from its sector's pack (src/lib/rules/packs.ts);
// a firm may add its own. credentials.type holds the code (no foreign key: imports and older
// rows may hold codes a firm hasn't set up, and the rules engine simply finds them missing).
export const CREDENTIAL_TYPE_SECTORS = [...SECTORS, "any"] as const;

export const credentialTypes = pgTable(
  "credential_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // The pack it came from; "any" for types every sector uses (right to work).
    sector: text("sector", { enum: CREDENTIAL_TYPE_SECTORS }).notNull(),
    appliedAllowed: boolean("applied_allowed").notNull().default(false),
    // Recorded by the office only: a casual can't upload an image of it (12F.2). From the pack
    // (src/lib/rules/packs.ts `officeRecorded`); a firm may mark its own types so too, and the
    // pack's list always holds (casualMayUpload).
    officeRecorded: boolean("office_recorded").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("credential_types_firm_id_code_key").on(t.firmId, t.code),
    check("credential_types_code_format", sql`${t.code} ~ '^[A-Z][A-Z0-9_]*$'`),
    check(
      "credential_types_name_length",
      sql`${t.name} = btrim(${t.name}) and length(${t.name}) between 1 and 100`,
    ),
    check(
      "credential_types_sector_check",
      sql`${t.sector} in ('security', 'rail', 'construction', 'cleaning', 'any')`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// Which credentials a role needs. Seeded per firm from its sector's pack
// (docs/rules-and-credentials.md); the rules engine looks a shift's role up here. Type codes are
// data, never an enum of SIA types (golden rule 6).
export const credentialRules = pgTable(
  "credential_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    // The pack the rule belongs to. A firm working in two sectors keeps both packs' rules; a role
    // name belongs to one pack per firm (unique below), so clashing names must differ.
    sector: text("sector", { enum: SECTORS }).notNull(),
    role: text("role").notNull(),
    // Every listed type is required.
    requiredTypes: text("required_types").array().notNull(),
    // And one of these, when there are any (P3.3, Rules 3): a security officer's shift takes an SIA
    // security guard or door supervisor licence ("SIA_SG", "SIA_DS"). Two or more, none of them
    // also in required_types; empty: no such group.
    anyOfTypes: text("any_of_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    unique("credential_rules_firm_id_role_key").on(t.firmId, t.role),
    check(
      "credential_rules_sector_check",
      sql`${t.sector} in ('security', 'rail', 'construction', 'cleaning')`,
    ),
    check("credential_rules_role_format", roleFormat(t.role)),
    // A flat list of type codes like credentials.type: no NULL or blank elements (they would
    // never match a credential), no nested arrays, and no commas inside an element (the
    // cardinality comparison). An empty list means "needs none".
    check(
      "credential_rules_required_types_format",
      sql`coalesce(array_ndims(${t.requiredTypes}), 1) = 1
        and array_position(${t.requiredTypes}, null) is null
        and (cardinality(${t.requiredTypes}) = 0
          or (array_to_string(${t.requiredTypes}, ',') ~ '^[A-Z][A-Z0-9_]*(,[A-Z][A-Z0-9_]*)*$'
            and cardinality(string_to_array(array_to_string(${t.requiredTypes}, ','), ','))
              = cardinality(${t.requiredTypes})))`,
    ),
    check(
      "credential_rules_any_of_types_format",
      sql`${qualificationCodes(t.anyOfTypes)} and cardinality(${t.anyOfTypes}) <> 1
        and not (${t.anyOfTypes} && ${t.requiredTypes})`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export interface SheetIssues {
  change?: {
    fields: string[]; // role, startsAt, endsAt, siteId, status
    wanted: Record<string, unknown>; // the sheet's values
    reason: "rules" | "settings" | "started" | "in_past";
    workers: { workerId: string; codes: string[] }[];
  };
  // In the sheet but not booked (rules codes, no_place, settings_invalid); dropped: taken out of
  // the sheet's cell because it was full of people booked.
  names?: { workerId: string; codes: string[]; dropped?: boolean }[];
}

// The same flat list of qualification codes as credential_rules.required_types: no NULL or blank
// elements, no nested arrays, no commas inside an element. An empty list means "needs none".
const qualificationCodes = (column: AnyPgColumn) =>
  sql`coalesce(array_ndims(${column}), 1) = 1
    and array_position(${column}, null) is null
    and (cardinality(${column}) = 0
      or (array_to_string(${column}, ',') ~ '^[A-Z][A-Z0-9_]*(,[A-Z][A-Z0-9_]*)*$'
        and cardinality(string_to_array(array_to_string(${column}, ','), ','))
          = cardinality(${column})))`;

// An event: the sessions (shifts) of one job, with one switch for whether casuals see them
// (docs/office-v2.md 3.3, S1). Not `events`, which is the action log. Every shift belongs to one:
// "Shifts for an event" creates its own; the sheet sync, the file import, "New shift" and
// migration 0035 put a shift in its site and day's automatic event, found again by its key in
// planner_ref (`auto:{site id or none}:{yyyy-mm-dd}`, src/lib/roster/shift-events.ts), unique per
// firm. The switch is ShiftDesk's own, never read from or written to a planner. Never deleted, only
// hidden: the app may add rows and change only the switch (TABLE_ACCESS, COLUMN_UPDATES).
export const shiftEvents = pgTable(
  "shift_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    siteId: uuid("site_id"),
    source: text("source", { enum: SHIFT_SOURCES }).notNull().default("native"),
    plannerRef: text("planner_ref"),
    showingToCasuals: boolean("showing_to_casuals").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("shift_events_firm_id_id_key").on(t.firmId, t.id),
    // One automatic event per firm, site and day, whoever makes it (two imports at once included).
    uniqueIndex("shift_events_auto_key")
      .on(t.firmId, t.plannerRef)
      .where(sql`${t.plannerRef} like 'auto:%'`),
    // A planner's event by its own id (S11): two PUTs naming one new event share one row.
    unique("shift_events_firm_id_source_planner_ref_key").on(t.firmId, t.source, t.plannerRef),
    foreignKey({
      name: "shift_events_site_fk",
      columns: [t.firmId, t.siteId],
      foreignColumns: [sites.firmId, sites.id],
    }),
    check("shift_events_name_length", sql`char_length(${t.name}) between 1 and 200`),
    check("shift_events_source_check", sql`${t.source} in ('native', 'sheets', 'csv', 'api')`),
    check(
      "shift_events_planner_ref_length",
      sql`${t.plannerRef} is null or char_length(${t.plannerRef}) between 1 and 200`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    // The event it belongs to (shift_events). `shiftEventId`, because `eventId` means an action-log
    // entry everywhere else in the code.
    shiftEventId: uuid("event_id").notNull(),
    siteId: uuid("site_id"),
    role: text("role").notNull(),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    headcount: integer("headcount").notNull().default(1),
    isUrgent: boolean("is_urgent").notNull().default(false),
    status: text("status", { enum: SHIFT_STATUSES }).notNull().default("open"),
    source: text("source", { enum: SHIFT_SOURCES }).notNull().default("native"),
    // The row's id in the firm's own rota (a sheet row key or CSV reference), for upserts.
    externalRef: text("external_ref"),
    instructions: text("instructions"),
    // Sheets only: the staff ids the sheet's "assigned" cell held after the last successful sync.
    // The base of the three-way merge between the sheet and bookings made here
    // (src/lib/roster/sheets/merge.ts). Null until first synced.
    syncedHolders: text("synced_holders").array(),
    // A connector's session only (P5.5's review): when its record was last read from the firm's
    // system and applied (the fetch's time, or the pull's list's). An older read is never applied
    // over a newer one, and it is the session's "last read" for a cancellation's notice
    // (src/lib/connector/bookings.ts). Null: not a connector's session.
    sourceReadAt: timestamptz("source_read_at"),
    // What the firm's Google Sheet asks for that the last sync couldn't do (Phase 10, audit M1, M2,
    // L12), for the dashboard's "From your rota sheet": a change to a booked or started shift the
    // rules refused, and names it couldn't book. Set by each sync to what's true then; null: nothing.
    sheetIssues: jsonb("sheet_issues").$type<SheetIssues>(),
    // The session's own details (docs/office-v2.md S2), set in ShiftDesk's session editor for
    // every source: the sheet sync and the file import never write them. Pay is whole pence an
    // hour; meeting point and uniform are for casuals who can see the session, instructions only
    // for those booked. requiredCredentials: qualification codes needed on top of the role's.
    payRatePence: integer("pay_rate_pence"),
    post: text("post"),
    meetingPoint: text("meeting_point"),
    uniform: text("uniform"),
    requiredCredentials: text("required_credentials")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // The session's own switch (the event has one too). ShiftDesk's own, never a planner's.
    showingToCasuals: boolean("showing_to_casuals").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("shifts_firm_id_id_key").on(t.firmId, t.id),
    foreignKey({
      name: "shifts_event_fk",
      columns: [t.firmId, t.shiftEventId],
      foreignColumns: [shiftEvents.firmId, shiftEvents.id],
    }),
    // One shift per row of a sheet or import. NULLs don't collide, so native shifts are free.
    unique("shifts_firm_id_source_external_ref_key").on(t.firmId, t.source, t.externalRef),
    foreignKey({
      name: "shifts_site_fk",
      columns: [t.firmId, t.siteId],
      foreignColumns: [sites.firmId, sites.id],
    }),
    index("shifts_firm_id_starts_at_idx").on(t.firmId, t.startsAt),
    // A big firm's lists (P4.1): an event's sessions (shifts_event_fk has no index of its own),
    // and sessions still running or to come by their end.
    index("shifts_firm_id_event_id_idx").on(t.firmId, t.shiftEventId),
    index("shifts_firm_id_ends_at_idx").on(t.firmId, t.endsAt),
    check("shifts_role_format", roleFormat(t.role)),
    check("shifts_ends_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    check("shifts_headcount_range", sql`${t.headcount} between 1 and 1000`),
    check("shifts_status_check", sql`${t.status} in ('draft', 'open', 'filled', 'cancelled')`),
    check("shifts_source_check", sql`${t.source} in ('native', 'sheets', 'csv', 'api')`),
    check("shifts_source_read_api_only", sql`${t.sourceReadAt} is null or ${t.source} = 'api'`),
    check("shifts_pay_rate_range", sql`${t.payRatePence} is null or ${t.payRatePence} >= 0`),
    check("shifts_post_length", sql`${t.post} is null or char_length(${t.post}) between 1 and 200`),
    check(
      "shifts_meeting_point_length",
      sql`${t.meetingPoint} is null or char_length(${t.meetingPoint}) between 1 and 300`,
    ),
    check(
      "shifts_uniform_length",
      sql`${t.uniform} is null or char_length(${t.uniform}) between 1 and 300`,
    ),
    check(
      "shifts_required_credentials_format",
      sql`${qualificationCodes(t.requiredCredentials)}
        and cardinality(${t.requiredCredentials}) <= 20`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// One row per holder of a slot (1..headcount). An unfilled slot is a row with no worker; first
// yes wins with one statement that also requires the shift to still be open (golden rule 4):
//   update assignments a set worker_id = $1, status = 'confirmed', confirmed_at = now()
//     from shifts s
//    where a.id = $2 and a.worker_id is null
//      and s.firm_id = a.firm_id and s.id = a.shift_id and s.status = 'open'
//   returning a.id
export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    shiftId: uuid("shift_id").notNull(),
    slot: integer("slot").notNull(),
    workerId: uuid("worker_id"),
    status: text("status", { enum: ASSIGNMENT_STATUSES }).notNull().default("open"),
    offeredAt: timestamptz("offered_at"),
    confirmedAt: timestamptz("confirmed_at"),
    cancelledAt: timestamptz("cancelled_at"),
    cancelReason: text("cancel_reason"),
    // The office's reason for placing someone despite a rule (free text, at most 500 characters,
    // no phone or email): kept here, never in the append-only log, so a worker's deletion and the
    // retention purge can clear it (audit L23, L30, L85).
    overrideReason: text("override_reason"),
    // Shift start minus cancelled_at, in hours. Negative when cancelled after the start.
    noticeHours: numeric("notice_hours", { precision: 8, scale: 2 }),
    // When the office chose to keep this booking though its worker stopped being active, or was
    // blocked from the shift's site (the dashboard's "Bookings to check", Phase 10). Cleared when that
    // happens again, so the booking is flagged again.
    officeKeptAt: timestamptz("office_kept_at"),
    // How it was cancelled (CANCEL_VIAS), and for a casual's own cancellation in the app, the
    // version of the strike warning on their screen when they confirmed, and when (12C.1, S3).
    cancelVia: text("cancel_via", { enum: CANCEL_VIAS }),
    // Who asked for it (P3.4), apart from who carried it out (status) and where (cancel_via): the
    // casual (their own cancel), the firm (the office's), the firm's client, or not known (a rota
    // sheet or a planner, whose data doesn't say). Set on every cancellation; null otherwise.
    cancelAskedBy: text("cancel_asked_by", { enum: CANCEL_ASKERS }),
    bookedVia: text("booked_via", { enum: BOOK_VIAS }),
    strikeWarningVersion: text("strike_warning_version"),
    strikeWarningShownAt: timestamptz("strike_warning_shown_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("assignments_firm_id_id_key").on(t.firmId, t.id),
    foreignKey({
      name: "assignments_shift_fk",
      columns: [t.firmId, t.shiftId],
      foreignColumns: [shifts.firmId, shifts.id],
    }),
    foreignKey({
      name: "assignments_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    // One live holder per slot: a cancelled row stays as evidence and a new open row reopens it.
    uniqueIndex("assignments_one_live_per_slot")
      .on(t.firmId, t.shiftId, t.slot)
      .where(sql`status not in ('cancelled_worker', 'cancelled_firm')`),
    // Nobody holds two live slots on the same shift.
    uniqueIndex("assignments_one_live_per_worker")
      .on(t.firmId, t.shiftId, t.workerId)
      .where(sql`worker_id is not null and status not in ('cancelled_worker', 'cancelled_firm')`),
    index("assignments_firm_id_worker_id_idx").on(t.firmId, t.workerId),
    // The firm's cancellations by when (the cancellations page, the planner API's feed and the
    // dashboard's chart; P4.1).
    index("assignments_firm_id_cancelled_at_idx").on(t.firmId, t.cancelledAt),
    check(
      "assignments_status_check",
      sql`${t.status} in ('open', 'offered', 'confirmed', 'cancelled_worker', 'cancelled_firm', 'no_show', 'completed')`,
    ),
    check("assignments_slot_positive", sql`${t.slot} >= 1`),
    // An open slot has no worker; every other state belongs to one.
    check(
      "assignments_worker_matches_status",
      sql`(${t.status} = 'open') = (${t.workerId} is null)`,
    ),
    check(
      "assignments_offered_at_set",
      sql`${t.status} <> 'offered' or ${t.offeredAt} is not null`,
    ),
    check(
      "assignments_confirmed_at_set",
      sql`${t.status} not in ('confirmed', 'no_show', 'completed') or ${t.confirmedAt} is not null`,
    ),
    // Golden rule 12: every cancellation, by the worker or the firm, records when, why and how
    // much notice was given.
    check(
      "assignments_cancel_evidence",
      sql`${t.status} not in ('cancelled_worker', 'cancelled_firm')
        or (${t.cancelledAt} is not null and ${t.noticeHours} is not null
            and ${t.cancelReason} is not null and length(btrim(${t.cancelReason})) > 0)`,
    ),
    check(
      "assignments_cancel_asked_by_check",
      sql`${t.cancelAskedBy} is null or (${t.cancelAskedBy} in ('casual', 'firm', 'client', 'unknown')
        and ${t.status} in ('cancelled_worker', 'cancelled_firm'))`,
    ),
    check(
      "assignments_cancel_via_check",
      sql`${t.cancelVia} is null or ${t.cancelVia} in ('app', 'office', 'sheet', 'import', 'api')`,
    ),
    check(
      "assignments_booked_via_check",
      sql`${t.bookedVia} is null or ${t.bookedVia} in ('app', 'office', 'sheet', 'api')`,
    ),
    // A warning is stored whole (its version and when), only on a casual's own cancellation.
    check(
      "assignments_strike_warning",
      sql`(${t.strikeWarningVersion} is null) = (${t.strikeWarningShownAt} is null)
        and (${t.strikeWarningVersion} is null
             or (${t.status} = 'cancelled_worker' and length(${t.strikeWarningVersion}) between 1 and 40))`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// Time changes, swaps, availability, general asks and reviews (a worker asking the office to look
// again at a shift the rules refused) for the office. payload is validated in code (zod) per type.
export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    shiftId: uuid("shift_id"),
    type: text("type", { enum: REQUEST_TYPES }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("open"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamptz("resolved_at"),
    // The office's note to the worker with its answer (free text: stays on the row and in the
    // message to them, never in an event).
    resolutionNote: text("resolution_note"),
    // The shifts-line message this question came from (12D.1, S5): a real link, so Enquiries can
    // join a message to its question. Cleared, never the request, when the message is deleted
    // (the 90-day purge, an erasure).
    messageId: uuid("message_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("requests_firm_id_id_key").on(t.firmId, t.id),
    // ON DELETE SET NULL clears message_id only: the column list is written by hand in migration
    // 0044 (Drizzle would clear firm_id too, which can't be null). The one exception to "no ON
    // DELETE action" above: the message goes at 90 days, the question stays as evidence.
    foreignKey({
      name: "requests_message_fk",
      columns: [t.firmId, t.messageId],
      foreignColumns: [messages.firmId, messages.id],
    }).onDelete("set null"),
    // One question per message; also the look-up from a message to its question.
    uniqueIndex("requests_one_per_message")
      .on(t.firmId, t.messageId)
      .where(sql`message_id is not null`),
    foreignKey({
      name: "requests_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    foreignKey({
      name: "requests_shift_fk",
      columns: [t.firmId, t.shiftId],
      foreignColumns: [shifts.firmId, shifts.id],
    }),
    foreignKey({
      name: "requests_resolved_by_fk",
      columns: [t.firmId, t.resolvedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    index("requests_firm_id_status_idx").on(t.firmId, t.status),
    check(
      "requests_type_check",
      sql`${t.type} in ('time_change', 'swap', 'availability', 'general', 'review')`,
    ),
    check(
      "requests_status_check",
      sql`${t.status} in ('open', 'approved', 'declined', 'auto_resolved', 'escalated')`,
    ),
    check(
      "requests_shift_required",
      sql`${t.type} not in ('time_change', 'swap', 'review') or ${t.shiftId} is not null`,
    ),
    check("requests_payload_object", sql`jsonb_typeof(${t.payload}) = 'object'`),
    // Unresolved requests carry no resolution; an office decision always names who and when.
    check(
      "requests_resolution",
      sql`(${t.status} in ('open', 'escalated') and ${t.resolvedAt} is null and ${t.resolvedBy} is null)
        or (${t.status} = 'auto_resolved' and ${t.resolvedAt} is not null)
        or (${t.status} in ('approved', 'declined') and ${t.resolvedAt} is not null and ${t.resolvedBy} is not null)`,
    ),
    // Only an office answer carries a note, and a short one.
    check(
      "requests_resolution_note",
      sql`${t.resolutionNote} is null
        or (${t.status} in ('approved', 'declined') and char_length(${t.resolutionNote}) between 1 and 500)`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// Each shift offer sent and the worker's response: in a wave (src/lib/offers/waves.ts: `wave` set),
// or by the office to one worker (src/lib/offers/office-offer.ts: `offered_by` set). Exactly one of
// the two, so office offers never take a wave's number.
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    shiftId: uuid("shift_id").notNull(),
    workerId: uuid("worker_id").notNull(),
    wave: integer("wave"),
    offeredBy: uuid("offered_by"),
    channel: text("channel", { enum: OFFER_CHANNELS }).notNull(),
    sentAt: timestamptz("sent_at").notNull().defaultNow(),
    respondedAt: timestamptz("responded_at"),
    response: text("response", { enum: OFFER_RESPONSES }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("offers_firm_id_id_key").on(t.firmId, t.id),
    // One offer per worker per wave, so a retried offer-wave job (key shift:wave) sends nothing new.
    unique("offers_firm_id_shift_id_worker_id_wave_key").on(
      t.firmId,
      t.shiftId,
      t.workerId,
      t.wave,
    ),
    foreignKey({
      name: "offers_shift_fk",
      columns: [t.firmId, t.shiftId],
      foreignColumns: [shifts.firmId, shifts.id],
    }),
    foreignKey({
      name: "offers_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    foreignKey({
      name: "offers_offered_by_fk",
      columns: [t.firmId, t.offeredBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    // One office offer per worker per shift (a retried office-offer job sends nothing new).
    uniqueIndex("offers_one_office_offer_per_worker")
      .on(t.firmId, t.shiftId, t.workerId)
      .where(sql`${t.wave} is null`),
    // The daily offer cap counts a worker's offers by sent_at.
    index("offers_firm_id_worker_id_sent_at_idx").on(t.firmId, t.workerId, t.sentAt),
    // The firm's offers by when, whoever they went to (the week's offers chart; P4.1).
    index("offers_firm_id_sent_at_idx").on(t.firmId, t.sentAt),
    check("offers_wave_positive", sql`${t.wave} >= 1`),
    check("offers_wave_or_office", sql`(${t.wave} is null) = (${t.offeredBy} is not null)`),
    check("offers_channel_check", sql`${t.channel} in ('push', 'whatsapp', 'sms', 'email')`),
    check(
      "offers_response_check",
      sql`${t.response} in ('accepted', 'declined', 'expired', 'filled_elsewhere', 'failed')`,
    ),
    check("offers_response_has_time", sql`(${t.response} is null) = (${t.respondedAt} is null)`),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export const REMINDER_KINDS = ["24h", "2h"] as const;
// sending: claimed and being sent (left so if the job stopped part-way: it may have gone, so it's
// never sent again); sent; failed (not resent: it may have arrived); skipped (never sent: quiet
// hours would have held it past its window).
export const REMINDER_STATUSES = ["sending", "sent", "failed", "skipped"] as const;

// Each shift reminder a booking got (src/lib/reminders/send.ts), or why it didn't: one row per
// booking, reminder and start time, written before the message goes, so a retried job never sends
// one twice and a shift moved to a new time gets new reminders. Evidence (a no-show dispute), so
// never deleted by the app.
export const shiftReminders = pgTable(
  "shift_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    assignmentId: uuid("assignment_id").notNull(),
    kind: text("kind", { enum: REMINDER_KINDS }).notNull(),
    // The start time the reminder was for.
    startsAt: timestamptz("starts_at").notNull(),
    status: text("status", { enum: REMINDER_STATUSES }).notNull(),
    // How the message went, or was going (null exactly when skipped): P2.4's push first, else a
    // WhatsApp or text, else email; one nothing could carry (no_channel) keeps the one it was
    // claimed with.
    channel: text("channel", { enum: ["whatsapp", "sms", "push", "email"] }),
    // When the reminder was claimed (just before sending) or skipped.
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("shift_reminders_firm_id_id_key").on(t.firmId, t.id),
    unique("shift_reminders_once_key").on(t.firmId, t.assignmentId, t.kind, t.startsAt),
    foreignKey({
      name: "shift_reminders_assignment_fk",
      columns: [t.firmId, t.assignmentId],
      foreignColumns: [assignments.firmId, assignments.id],
    }),
    check("shift_reminders_kind_check", sql`${t.kind} in ('24h', '2h')`),
    check(
      "shift_reminders_status_check",
      sql`${t.status} in ('sending', 'sent', 'failed', 'skipped')`,
    ),
    check(
      "shift_reminders_channel_check",
      sql`${t.channel} in ('whatsapp', 'sms', 'push', 'email')`,
    ),
    check(
      "shift_reminders_channel_unless_skipped",
      sql`(${t.status} = 'skipped') = (${t.channel} is null)`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// A firm's name map (P3.2; "Connecting the firm's systems" 2): what its own system calls a role, a
// qualification, a staff type or a cancellation reason, mapped to a ShiftDesk code, or to skip
// (code null: "Holiday", "Not Set", a pay tier's own pseudo-role). outside_name is held as
// src/lib/roster/names.ts keys it (trimmed, lower case, one space between words), so "Door
// Supervisor (NLW)" and "door supervisor  (nlw)" are one name. A role may carry the pay rate its
// name stands for (whole pence an hour), for the connector (P5): the sheet sync and the file
// import read role names (and the credentials import qualification names), and never write a
// session's pay (S2). Set only by the owner
// (npm run firm:names); the app reads it.
export const NAME_KINDS = ["role", "qualification", "staff_type", "cancellation_reason"] as const;
export type NameKind = (typeof NAME_KINDS)[number];
export const NAME_CODE_PATTERN = "^[A-Za-z][A-Za-z0-9_]{0,49}$";
if (/['\\]/.test(NAME_CODE_PATTERN)) throw new Error("NAME_CODE_PATTERN must not contain ' or \\");

export const nameMap = pgTable(
  "name_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    kind: text("kind", { enum: NAME_KINDS }).notNull(),
    outsideName: text("outside_name").notNull(),
    code: text("code"),
    payRatePence: integer("pay_rate_pence"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("name_map_firm_id_id_key").on(t.firmId, t.id),
    unique("name_map_name_key").on(t.firmId, t.kind, t.outsideName),
    check(
      "name_map_kind_check",
      sql`${t.kind} in ('role', 'qualification', 'staff_type', 'cancellation_reason')`,
    ),
    check(
      "name_map_outside_name_format",
      sql`char_length(${t.outsideName}) between 1 and 200
          and ${t.outsideName} = lower(${t.outsideName})
          and ${t.outsideName} !~ '^ | $|  |[[:cntrl:]]'`,
    ),
    check(
      "name_map_code_format",
      sql`${t.code} is null or (case when ${t.kind} = 'role' then ${roleFormat(t.code)}
          else ${t.code} ~ ${sql.raw(`'${NAME_CODE_PATTERN}'`)} end)`,
    ),
    check(
      "name_map_pay_rate_role_only",
      sql`${t.payRatePence} is null
          or (${t.kind} = 'role' and ${t.code} is not null and ${t.payRatePence} between 0 and 100000)`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export const ROSTER_SOURCE_KINDS = ["sheets", "connector"] as const;
// Which system a connector source talks to (P5; ADR-026), each with its own adapter in
// src/lib/connector/. Only the made-up portal so far: it stands in for the real one in the tests.
export const CONNECTORS = ["demo_portal"] as const;
export type Connector = (typeof CONNECTORS)[number];
// A connector's base address (P5.2's review): https on its own port (none or 443), a public DNS
// name (dotted, ending in a word: never an IP address, a bare name like a Compose service's, or a
// .localhost, .internal or .local one), an optional path with no "." or ".." segment; no user,
// query or fragment; at most 300 characters. Syntax only: a public name can still point inside,
// so the real system's transport checks the address it connects to as well (PLAN.md P5).
export const CONNECTOR_BASE_URL =
  "^https://(?!.*\\.(localhost|internal|local)(/|:|$))([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}(:443)?(/(?!\\.\\.?(/|$))[A-Za-z0-9._~-]*)*$";
export const CONNECTOR_BASE_URL_MAX = 300;

// Where a firm's rota lives when it isn't our own tables (native firms have no row). A sheet
// ("sheets"): its spreadsheet and column mapping (validated in code,
// src/lib/roster/sheets/mapping.ts); the firm shares it with our service account. A connector
// ("connector", P5.2): which system and its base address; its credentials are the firm's, kept in
// the secret store (firm_secrets), never here. So nothing secret is stored in this table.
export const rosterSources = pgTable(
  "roster_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    kind: text("kind", { enum: ROSTER_SOURCE_KINDS }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    spreadsheetId: text("spreadsheet_id"), // a sheet's only
    connector: text("connector", { enum: CONNECTORS }), // a connector's only
    baseUrl: text("base_url"), // a connector's only
    mapping: jsonb("mapping").$type<Record<string, unknown>>().notNull(),
    lastSyncedAt: timestamptz("last_synced_at"),
    // A connector's last quick pull, the sessions in the next 48 hours (P5.4); last_synced_at is
    // its last full one. Null for a sheet.
    lastNearSyncedAt: timestamptz("last_near_synced_at"),
    // The last sync that ran, success or not: failures back off from it (cadence.ts).
    lastAttemptedAt: timestamptz("last_attempted_at"),
    // A short code only (e.g. "sheet_not_shared"), never a message or a cell's contents.
    lastErrorCode: text("last_error_code"),
    // A sync holds this lease while it runs, so two syncs of one firm never overlap.
    syncStartedAt: timestamptz("sync_started_at"),
    createdAt: createdAt(),
  },
  (t) => [
    // For links from the firm's other tables (connector_events).
    unique("roster_sources_firm_id_id_key").on(t.firmId, t.id),
    // One enabled source per firm; an old one can be kept, disabled.
    uniqueIndex("roster_sources_one_enabled_per_firm")
      .on(t.firmId)
      .where(sql`enabled`),
    // A spreadsheet belongs to one firm (audit L45). Every firm shares its sheet with the same
    // service account, so the id is all that ties a sheet to a firm: the index sees every firm's
    // rows (RLS can't), so no firm can be pointed at a sheet another firm already uses. Set only
    // by the owner (npm run firm:sheet); the app may change only the sync's status columns
    // (src/lib/db/admin/access.ts).
    uniqueIndex("roster_sources_spreadsheet_id_key").on(t.spreadsheetId),
    check("roster_sources_kind_check", sql`${t.kind} in ('sheets', 'connector')`),
    // A sheet has its spreadsheet and nothing of a connector's; a connector the reverse.
    check(
      "roster_sources_kind_fields",
      sql`case when ${t.kind} = 'sheets'
            then ${t.spreadsheetId} is not null and ${t.connector} is null and ${t.baseUrl} is null
            else ${t.spreadsheetId} is null
              and ${t.connector} is not null and ${t.baseUrl} is not null
          end`,
    ),
    check(
      "roster_sources_connector_check",
      sql`${t.connector} in (${sql.raw(CONNECTORS.map((c) => `'${c}'`).join(", "))})`,
    ),
    check(
      "roster_sources_base_url_format",
      sql`${t.baseUrl} ~ ${sql.raw(`'${CONNECTOR_BASE_URL}'`)}
          and char_length(${t.baseUrl}) <= ${sql.raw(String(CONNECTOR_BASE_URL_MAX))}`,
    ),
    check(
      "roster_sources_spreadsheet_id_format",
      sql`${t.spreadsheetId} ~ '^[A-Za-z0-9_-]{20,100}$'`,
    ),
    check("roster_sources_mapping_object", sql`jsonb_typeof(${t.mapping}) = 'object'`),
    check("roster_sources_error_code_format", sql`${t.lastErrorCode} ~ '^[a-z_]{1,50}$'`),
    check(
      "roster_sources_near_sync_connector_only",
      sql`${t.lastNearSyncedAt} is null or ${t.kind} = 'connector'`,
    ),
    firmIsolation(t.firmId),
    // The migrating owner may read every firm's sources: app_connector_source_firm() (0056) runs as
    // the owner, for a connector's webhook before a firm is known. The app role gets no such
    // policy: it sees its own firm's sources only.
    pgPolicy("source_lookup", {
      as: "permissive",
      for: "select",
      to: "current_user",
      using: sql`true`,
    }),
  ],
).enableRLS();
