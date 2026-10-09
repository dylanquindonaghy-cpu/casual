import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { normaliseEmail } from "../src/lib/auth/office-login";
import { applyCredentialPack } from "../src/lib/credentials/apply-pack";
import { officeUsers, SECTORS } from "../src/lib/db/schema";
import type { WithFirm } from "../src/lib/db/scoped";
import { recordEvent } from "../src/lib/events/record";
import { isValidSlug } from "../src/lib/tenancy/slug";

// Creating a pilot firm (Phase 9, `npm run firm:create`, scripts/firm-create.ts; docs/runbooks.md
// "Onboarding a pilot firm"). Two steps:
// 1. As the owner (the app role can only read firms): the firm's row, with its slug, name and
//    sector. RLS is forced for the owner too, so it sets the new firm for its transaction only;
//    kept out of src/ on purpose (scripts/invariants.sh, invariant 5).
//    Logged firm.created {sector} in the same transaction.
// 2. As the app role, inside the firm (withFirm, exactly as the app works), holding a lock for the
//    firm and only while it still has no office user: the sector's credential pack (its types and
//    default rules, logged credential_pack.applied) and the first admin office user (logged
//    office_user.added {role}).
// If step 2 stops (the database went away, say), running it again with the same slug, name and
// sector finishes it: a firm with no office user yet is picked up, not refused.

export interface NewFirm {
  slug: string;
  name: string;
  sector: string;
  adminEmail: string;
  adminName: string;
}

export type CreateFirmResult =
  | {
      status: "created";
      firmId: string;
      resumed: boolean;
      createdAt: Date;
      typesAdded: number;
      rulesAdded: number;
    }
  | { status: "taken" }
  | { status: "bad"; field: "slug" | "name" | "sector" | "adminEmail" | "adminName" };

type Sector = (typeof SECTORS)[number];
const NAME = /^[^\p{Cc}]{2,80}$/u;
const tidy = (s: string) => s.trim().replace(/ {2,}/g, " ");

// The events (the office's action log: src/lib/office/log-types.ts and event-words.ts).
const FIRM_CREATED = "firm.created";
const OFFICE_USER_ADDED = "office_user.added";

export async function createFirm(
  adminUrl: string,
  run: WithFirm,
  input: NewFirm,
): Promise<CreateFirmResult> {
  const slug = input.slug.trim().toLowerCase();
  if (!isValidSlug(slug)) return { status: "bad", field: "slug" };
  const name = tidy(input.name);
  if (!NAME.test(name)) return { status: "bad", field: "name" };
  if (!(SECTORS as readonly string[]).includes(input.sector)) {
    return { status: "bad", field: "sector" };
  }
  const sector = input.sector as Sector;
  const email = normaliseEmail(input.adminEmail);
  if (!email) return { status: "bad", field: "adminEmail" };
  const adminName = tidy(input.adminName);
  if (!NAME.test(adminName)) return { status: "bad", field: "adminName" };

  // Step 1, as the owner.
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  let firmId: string;
  let createdAt: Date;
  let resumed = false;
  try {
    const { rows: found } = await owner.query<{
      id: string;
      name: string;
      sector: string;
      created_at: Date;
    }>("select id::text as id, name, sector, created_at from firms where slug = $1", [slug]);
    const existing = found[0];
    if (existing) {
      await owner.query("begin");
      await owner.query("select set_config('app.current_firm_id', $1, true)", [existing.id]);
      const { rows: users } = await owner.query<{ n: number }>(
        "select count(*)::int as n from office_users",
      );
      await owner.query("rollback");
      // A firm whose setup stopped before its first office user: finish it. Anything else is taken.
      if ((users[0]?.n ?? 0) > 0 || existing.name !== name || existing.sector !== sector) {
        return { status: "taken" };
      }
      firmId = existing.id;
      createdAt = existing.created_at;
      resumed = true;
    } else {
      firmId = randomUUID();
      await owner.query("begin");
      try {
        await owner.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
        const { rows: made } = await owner.query<{ created_at: Date }>(
          "insert into firms (id, name, slug, sector) values ($1, $2, $3, $4) returning created_at",
          [firmId, name, slug, sector],
        );
        createdAt = made[0]?.created_at ?? new Date();
        await owner.query(
          `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
           values ($1, 'system', $2, 'firm', $1, $3)`,
          [firmId, FIRM_CREATED, JSON.stringify({ sector })],
        );
        await owner.query("commit");
      } catch (err) {
        await owner.query("rollback").catch(() => undefined);
        // Someone else took the slug at the same moment.
        if ((err as { code?: string }).code === "23505") return { status: "taken" };
        throw err;
      }
    }
  } finally {
    await owner.end();
  }

  // Step 2, as the app role inside the new firm: one run at a time per firm, and only while it has no
  // office user (two runs finishing the same half-made firm at once: the second finds the admin).
  const added = await run(firmId, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('firm-create:' || app_current_firm_id()::text, 0))`,
    );
    const [users] = await tx.select({ n: sql<number>`count(*)::int` }).from(officeUsers);
    if ((users?.n ?? 0) > 0) return null;
    const pack = await applyCredentialPack(tx, sector, { type: "system" });
    const [admin] = await tx
      .insert(officeUsers)
      .values({ firmId, email, name: adminName, role: "admin" })
      .returning({ id: officeUsers.id });
    if (!admin) throw new Error("the admin's insert returned nothing");
    await recordEvent(tx, {
      actorType: "system",
      action: OFFICE_USER_ADDED,
      entityType: "office_user",
      entityId: admin.id,
      data: { role: "admin" },
    });
    return pack;
  });
  if (!added) return { status: "taken" };
  return { status: "created", firmId, resumed, createdAt, ...added };
}

export const OFFICE_ROLES_TO_ADD = ["admin", "resourcer", "payroll"] as const;

export type AddOfficeUserResult =
  | { status: "added" }
  // That email already has an office login at this firm (as it is: this changes nothing).
  | { status: "already"; role: string; active: boolean }
  | { status: "no_firm" }
  | { status: "bad"; field: "email" | "name" | "role" };

// Another office user for a firm (Phase 9, `npm run firm:office-user`): a resourcer or payroll
// user, or another admin, until the office has its own users screen (parked). As the app role
// inside the firm; logged office_user.added {role}.
export async function addOfficeUser(
  run: WithFirm,
  firmId: string | null,
  input: { email: string; name: string; role: string },
): Promise<AddOfficeUserResult> {
  const email = normaliseEmail(input.email);
  if (!email) return { status: "bad", field: "email" };
  const name = tidy(input.name);
  if (!NAME.test(name)) return { status: "bad", field: "name" };
  if (!(OFFICE_ROLES_TO_ADD as readonly string[]).includes(input.role)) {
    return { status: "bad", field: "role" };
  }
  const role = input.role as (typeof OFFICE_ROLES_TO_ADD)[number];
  if (!firmId) return { status: "no_firm" };
  return run(firmId, async (tx): Promise<AddOfficeUserResult> => {
    const [user] = await tx
      .insert(officeUsers)
      .values({ firmId, email, name, role })
      .onConflictDoNothing({ target: [officeUsers.firmId, officeUsers.email] })
      .returning({ id: officeUsers.id });
    if (!user) {
      const [existing] = await tx
        .select({ role: officeUsers.role, status: officeUsers.status })
        .from(officeUsers)
        .where(eq(officeUsers.email, email));
      return {
        status: "already",
        role: existing?.role ?? role,
        active: existing?.status === "active",
      };
    }
    await recordEvent(tx, {
      actorType: "system",
      action: OFFICE_USER_ADDED,
      entityType: "office_user",
      entityId: user.id,
      data: { role },
    });
    return { status: "added" };
  });
}
