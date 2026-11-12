import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { officeUsers } from "./people";
import { shiftEvents, shifts } from "./roster";
import { clients, firms } from "./tenancy";

// The firm's clients' own logins and requests (Phase 36.3, 36.4; docs/data-model.md). A contract
// (clients: Phase 26.3) has client contacts, each a person at the client with a work email, added,
// switched off and on by the firm's admins; they log in with a one-time link (magic_links and
// sessions, kind 'client') and see their contract's events in numbers only, never a casual. They
// ask the office for a new event or a change to a session (client_requests), which the office
// accepts, declines or asks about. Both go with their contract when an admin removes it (the
// cascade: the contract's log entries stay).

export const CLIENT_CONTACT_NAME_MAX = 120;

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    contractId: uuid("contract_id").notNull(),
    name: text("name").notNull(),
    // Lower case, as the office's (one address per firm: the login finds the person by it).
    email: text("email").notNull(),
    isOn: boolean("is_on").notNull().default(true),
    // The admin who added them. No ON DELETE action: an office user is switched off, not deleted.
    createdBy: uuid("created_by").notNull(),
    lastLoginAt: timestamptz("last_login_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("client_contacts_firm_id_id_key").on(t.firmId, t.id),
    // For the requests' link to a contact on the request's own contract (client_requests_contact_fk).
    unique("client_contacts_firm_id_contract_id_id_key").on(t.firmId, t.contractId, t.id),
    unique("client_contacts_firm_id_email_key").on(t.firmId, t.email),
    foreignKey({
      name: "client_contacts_contract_fk",
      columns: [t.firmId, t.contractId],
      foreignColumns: [clients.firmId, clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "client_contacts_created_by_fk",
      columns: [t.firmId, t.createdBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    index("client_contacts_firm_id_contract_id_idx").on(t.firmId, t.contractId),
    check(
      "client_contacts_email_lower",
      sql`${t.email} = lower(${t.email}) and ${t.email} ~ '^[^@ ]+@[^@ ]+$'
        and char_length(${t.email}) <= 254`,
    ),
    check(
      "client_contacts_name_length",
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(CLIENT_CONTACT_NAME_MAX))}`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// What a client asks for (36.4). kind: a new event, or a change to one session (more or fewer
// places, new times, cancel it), or something else (about a session, an event or nothing in
// particular). payload is checked in code per kind (src/lib/client/payloads.ts) and by the
// database's shape check below. status: waiting (for the office), accepted (applied here),
// declined (with a reason the client sees), asked (the office asked the client something; the
// client's reply puts it back to waiting), done_in_planner (accepted, but the session is the firm's
// planner's, sheet's or connector's: listed "To do in <planner>" until the office marks it done,
// planner_done_at). urgent: the rules' answer when it was sent (src/lib/client/urgency.ts),
// worked out again whenever it's read.
export const CLIENT_REQUEST_KINDS = [
  "new_event",
  "more_places",
  "fewer_places",
  "new_times",
  "cancel_session",
  "other",
] as const;
export type ClientRequestKind = (typeof CLIENT_REQUEST_KINDS)[number];
export const CLIENT_REQUEST_STATUSES = [
  "waiting",
  "accepted",
  "declined",
  "asked",
  "done_in_planner",
] as const;
export type ClientRequestStatus = (typeof CLIENT_REQUEST_STATUSES)[number];
// The kinds about one session (shift_id required).
export const SESSION_REQUEST_KINDS = [
  "more_places",
  "fewer_places",
  "new_times",
  "cancel_session",
] as const;

const list = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(", "));

export const clientRequests = pgTable(
  "client_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    contractId: uuid("contract_id").notNull(),
    clientContactId: uuid("client_contact_id").notNull(),
    kind: text("kind", { enum: CLIENT_REQUEST_KINDS }).notNull(),
    // The session it's about (the four session kinds; "other" may name one).
    shiftId: uuid("shift_id"),
    // The event it's about ("other" may name one), and for a new event once accepted, the event
    // the office made.
    eventId: uuid("event_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    clientNote: text("client_note"),
    status: text("status", { enum: CLIENT_REQUEST_STATUSES }).notNull().default("waiting"),
    urgent: boolean("urgent").notNull().default(false),
    officeAnswer: text("office_answer"),
    answeredBy: uuid("answered_by"),
    answeredAt: timestamptz("answered_at"),
    // done_in_planner only: when the office marked it done in the planner, and who.
    plannerDoneAt: timestamptz("planner_done_at"),
    plannerDoneBy: uuid("planner_done_by"),
    // When the client last changed their note (a reply to the office's question, 36.4).
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("client_requests_firm_id_id_key").on(t.firmId, t.id),
    // The request goes with its contract (and its contact, who goes with the contract too). Its
    // contact is one on the request's own contract (the database holds it, not only the code).
    foreignKey({
      name: "client_requests_contract_fk",
      columns: [t.firmId, t.contractId],
      foreignColumns: [clients.firmId, clients.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "client_requests_contact_fk",
      columns: [t.firmId, t.contractId, t.clientContactId],
      foreignColumns: [clientContacts.firmId, clientContacts.contractId, clientContacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "client_requests_shift_fk",
      columns: [t.firmId, t.shiftId],
      foreignColumns: [shifts.firmId, shifts.id],
    }),
    foreignKey({
      name: "client_requests_event_fk",
      columns: [t.firmId, t.eventId],
      foreignColumns: [shiftEvents.firmId, shiftEvents.id],
    }),
    foreignKey({
      name: "client_requests_answered_by_fk",
      columns: [t.firmId, t.answeredBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    foreignKey({
      name: "client_requests_planner_done_by_fk",
      columns: [t.firmId, t.plannerDoneBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    index("client_requests_firm_id_status_idx").on(t.firmId, t.status, t.createdAt),
    index("client_requests_firm_id_contract_id_idx").on(t.firmId, t.contractId, t.createdAt),
    check("client_requests_kind_check", sql`${t.kind} in (${list(CLIENT_REQUEST_KINDS)})`),
    check("client_requests_status_check", sql`${t.status} in (${list(CLIENT_REQUEST_STATUSES)})`),
    check(
      "client_requests_session_kinds",
      sql`(${t.kind} in (${list(SESSION_REQUEST_KINDS)})) = (${t.shiftId} is not null)
        or ${t.kind} = 'other'`,
    ),
    check("client_requests_payload_object", sql`jsonb_typeof(${t.payload}) = 'object'`),
    check(
      "client_requests_note_length",
      sql`${t.clientNote} is null or char_length(${t.clientNote}) between 1 and 1000`,
    ),
    check(
      "client_requests_answer_length",
      sql`${t.officeAnswer} is null or char_length(${t.officeAnswer}) between 1 and 1000`,
    ),
    // A decline always carries its reason (the client sees it), and every answer says who and when.
    check(
      "client_requests_answer_shape",
      sql`(${t.status} = 'waiting' or (${t.answeredBy} is not null and ${t.answeredAt} is not null))
        and (${t.status} not in ('declined', 'asked') or ${t.officeAnswer} is not null)`,
    ),
    check(
      "client_requests_planner_done",
      sql`(${t.plannerDoneAt} is null) = (${t.plannerDoneBy} is null)
        and (${t.plannerDoneAt} is null or ${t.status} = 'done_in_planner')`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();
