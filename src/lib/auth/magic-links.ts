import { eq, sql } from "drizzle-orm";
import { activeFirmId, type FirmTx } from "../db/scoped";
import { magicLinks } from "../db/schema";
import { addMs, MINUTE } from "./clock";
import type { SubjectKind } from "./sessions";
import { hashToken, newToken } from "./tokens";

// One-time login links (docs/architecture.md, Login): 32 random bytes, stored as a sha256,
// single use, 15 minutes. The token travels in the URL fragment (/l#<token>), so it never
// reaches server or proxy logs.

export const LINK_LIFETIME_MS = 15 * MINUTE;

// Creates the link for one login request. Safe to retry: if the request's link was already
// sent, nothing happens (null); if an earlier attempt created it but never sent it, its token
// is replaced (the old one was never delivered).
export async function issueMagicLink(
  tx: FirmTx,
  opts: { kind: SubjectKind; subjectId: string; requestId: string; now: Date },
): Promise<{ id: string; token: string } | null> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("issueMagicLink must be called inside withFirm");
  const token = newToken();
  const rows = await tx
    .insert(magicLinks)
    .values({
      firmId,
      kind: opts.kind,
      workerId: opts.kind === "worker" ? opts.subjectId : null,
      officeUserId: opts.kind === "office" ? opts.subjectId : null,
      tokenHash: hashToken(token),
      requestId: opts.requestId,
      expiresAt: addMs(opts.now, LINK_LIFETIME_MS),
    })
    .onConflictDoUpdate({
      target: magicLinks.requestId,
      set: { tokenHash: sql`excluded.token_hash`, expiresAt: sql`excluded.expires_at` },
      setWhere: sql`${magicLinks.sentAt} is null and ${magicLinks.usedAt} is null`,
    })
    .returning({ id: magicLinks.id });
  const row = rows[0];
  return row ? { id: row.id, token } : null;
}

export async function markLinkSent(tx: FirmTx, id: string, now: Date): Promise<void> {
  await tx.update(magicLinks).set({ sentAt: now }).where(eq(magicLinks.id, id));
}

// Spends (uses up) a link: one conditional UPDATE, so two taps racing for the same link can't both log in
// (first yes wins). Only a live link of the right kind, for a person who is still active.
export async function spendMagicLink(
  tx: FirmTx,
  opts: { kind: SubjectKind; token: string; now: Date },
): Promise<{ id: string; subjectId: string } | null> {
  const { rows } = await tx.execute<{ id: string; subject_id: string }>(sql`
    update magic_links ml set used_at = ${opts.now}
     where ml.token_hash = ${hashToken(opts.token)}
       and ml.kind = ${opts.kind}
       and ml.used_at is null
       and ml.expires_at > ${opts.now}
       and case ml.kind
             when 'worker' then exists (select 1 from workers w
                                         where w.id = ml.worker_id and w.status = 'active')
             else exists (select 1 from office_users o
                           where o.id = ml.office_user_id and o.status = 'active')
           end
    returning ml.id, coalesce(ml.worker_id, ml.office_user_id) as subject_id
  `);
  const row = rows[0];
  return row ? { id: row.id, subjectId: row.subject_id } : null;
}

// After a successful login, the person's other unused links stop working too. Rows another
// transaction holds are skipped (SKIP LOCKED): two of the same worker's links used at the same
// moment would otherwise wait on each other and deadlock. The skipped link is the one that
// other transaction is using up anyway.
export async function retireOtherLinks(
  tx: FirmTx,
  opts: { kind: SubjectKind; subjectId: string; now: Date },
): Promise<void> {
  const column = opts.kind === "worker" ? sql`worker_id` : sql`office_user_id`;
  await tx.execute(sql`
    update magic_links set used_at = ${opts.now}
     where id in (select id from magic_links
                   where ${column} = ${opts.subjectId} and used_at is null
                   for update skip locked)
  `);
}

export type RejectReason = "unknown" | "used" | "expired" | "wrong_kind" | "inactive";

// Why a link didn't work, for the action log only (the screen says the same thing either way).
// A link from another firm is invisible here (RLS), so it reads as "unknown".
export async function whyRejected(
  tx: FirmTx,
  opts: { kind: SubjectKind; token: string; now: Date },
): Promise<{ id: string | null; reason: RejectReason }> {
  const [link] = await tx
    .select({
      id: magicLinks.id,
      kind: magicLinks.kind,
      usedAt: magicLinks.usedAt,
      expiresAt: magicLinks.expiresAt,
    })
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, hashToken(opts.token)));
  if (!link) return { id: null, reason: "unknown" };
  if (link.kind !== opts.kind) return { id: link.id, reason: "wrong_kind" };
  if (link.usedAt) return { id: link.id, reason: "used" };
  if (link.expiresAt <= opts.now) return { id: link.id, reason: "expired" };
  return { id: link.id, reason: "inactive" };
}
