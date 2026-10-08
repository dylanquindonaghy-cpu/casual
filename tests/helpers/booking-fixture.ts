import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { HOUR } from "@/lib/auth/clock";
import { applyCredentialPack } from "@/lib/credentials/apply-pack";
import type { WithFirm } from "@/lib/db/scoped";
import { uniqueSlug } from "./db";

// A security firm for booking tests: the security credential pack (a steward needs the Level 2
// spectator safety qualification, a door supervisor an SIA door supervisor licence, and "applied"
// may count for SIA licences), plus helpers to add fake workers, shifts, bookings and office users
// straight into the tables (as the superuser, so the fixture never depends on the code under test).

// Monday 2 November 2026, 09:00 London (GMT).
export const NOW = new Date("2026-11-02T09:00:00Z");
export const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * HOUR);

export interface CredentialCells {
  type: string;
  status?: "valid" | "expired" | "applied" | "suspended";
  expiresOn?: string | null;
}

let mobiles = 0;

export async function bookingFirm(
  su: Pool,
  withFirm: WithFirm,
  opts: { settings?: Record<string, unknown> } = {},
) {
  const slug = uniqueSlug("b");
  const { rows } = await su.query<{ id: string }>(
    `insert into firms (name, slug, sector, settings) values ($1, $2, 'security', $3)
     returning id::text as id`,
    [`Booking Test ${slug}`, slug, JSON.stringify(opts.settings ?? {})],
  );
  const firmId = rows[0]?.id ?? "";
  await withFirm(firmId, (tx) => applyCredentialPack(tx, "security", { type: "system" }));

  const one = async (text: string, values: unknown[]) => {
    const { rows: r } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
    const id = r[0]?.id;
    if (!id) throw new Error(`insert returned no id: ${text}`);
    return id;
  };

  // Every shift belongs to an event (shift_events): the firm's one "Fixture event" unless a test
  // makes its own with event().
  let fixtureEvent: string | undefined;
  const event = (o: { name?: string; showing?: boolean } = {}) =>
    one(`insert into shift_events (firm_id, name, showing_to_casuals) values ($1, $2, $3)`, [
      firmId,
      o.name ?? "Fixture event",
      o.showing ?? true,
    ]);

  return {
    firmId,
    event,

    async worker(
      o: {
        first?: string;
        roles?: string[];
        status?: "active" | "inactive" | "blocked";
        credentials?: CredentialCells[];
      } = {},
    ): Promise<string> {
      mobiles += 1;
      const id = await one(
        `insert into workers (firm_id, first_name, last_name, mobile_e164, roles, status)
         values ($1, $2, 'Booker', $3, $4, $5)`,
        [
          firmId,
          o.first ?? "Sam",
          // Ofcom's drama range (+44 7700 900000-900999); unique within a firm.
          `+447700900${String(mobiles % 1000).padStart(3, "0")}`,
          o.roles ?? ["steward", "door_supervisor"],
          o.status ?? "active",
        ],
      );
      const creds = o.credentials ?? [
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_DS", expiresOn: "2029-01-01" },
      ];
      for (const c of creds) {
        await su.query(
          `insert into credentials (firm_id, worker_id, type, status, expires_on)
           values ($1, $2, $3, $4, $5)`,
          [firmId, id, c.type, c.status ?? "valid", c.expiresOn ?? null],
        );
      }
      return id;
    },

    async shift(
      o: {
        role?: string;
        startsAt?: Date;
        hours?: number;
        headcount?: number;
        status?: "draft" | "open" | "filled" | "cancelled";
        source?: "native" | "sheets" | "csv";
        eventId?: string;
      } = {},
    ): Promise<string> {
      const startsAt = o.startsAt ?? hoursFromNow(48);
      const source = o.source ?? "native";
      fixtureEvent ??= o.eventId ? undefined : await event();
      return one(
        `insert into shifts (firm_id, event_id, role, starts_at, ends_at, headcount, status, source, external_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          firmId,
          o.eventId ?? fixtureEvent,
          o.role ?? "door_supervisor",
          startsAt,
          new Date(startsAt.getTime() + (o.hours ?? 8) * HOUR),
          o.headcount ?? 1,
          o.status ?? "open",
          source,
          source === "native" ? null : `row-${Math.random().toString(36).slice(2, 10)}`,
        ],
      );
    },

    // A booking made earlier (by any route), straight into assignments.
    async booking(
      workerId: string,
      shiftId: string,
      status: "confirmed" | "completed" | "offered" | "no_show" | "cancelled_worker" = "confirmed",
      slot = 1,
    ): Promise<string> {
      const cancelled = status === "cancelled_worker";
      return one(
        `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at, offered_at,
                                  cancelled_at, cancel_reason, notice_hours)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          firmId,
          shiftId,
          slot,
          workerId,
          status,
          status === "offered" ? null : hoursFromNow(-100),
          status === "offered" ? hoursFromNow(-1) : null,
          cancelled ? hoursFromNow(-50) : null,
          cancelled ? "Unwell" : null,
          cancelled ? 20 : null,
        ],
      );
    },

    async office(
      role: "admin" | "resourcer" | "payroll" = "resourcer",
      status: "active" | "disabled" = "active",
    ): Promise<string> {
      return one(
        `insert into office_users (firm_id, email, name, role, status)
         values ($1, $2, 'Office Person', $3, $4)`,
        [firmId, `${role}.${Math.random().toString(36).slice(2, 10)}@example.com`, role, status],
      );
    },

    // The firm's Google Sheet source, last synced at `syncedAt` (null: never).
    async sheetSource(syncedAt: Date | null, enabled = true): Promise<void> {
      await su.query(
        `insert into roster_sources (firm_id, kind, enabled, spreadsheet_id, mapping, last_synced_at)
         values ($1, 'sheets', $2, $3, '{}', $4)`,
        [firmId, enabled, `test_sheet_${randomUUID().replace(/-/g, "")}`, syncedAt],
      );
    },
  };
}

export type BookingFirm = Awaited<ReturnType<typeof bookingFirm>>;
