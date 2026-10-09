import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { activeFirmId, type FirmTx } from "../db/scoped";
import { magicLinks, sessions } from "../db/schema";
import { recordEvent } from "../events/record";
import { addMs, DAY, HOUR } from "./clock";
import { hashToken, newToken } from "./tokens";

// Sessions for workers and office users (docs/architecture.md, Login). The cookie holds a random
// token; the database holds its sha256. A session lasts 30 days from login, whatever happens.
// Its token is replaced every 24 hours by a server action (cookies can't be set while a page
// renders); the previous token keeps working for 60 seconds so requests already in flight with
// the old cookie aren't logged out. Every lookup checks the kind and that the person is still
// active, so a disabled worker or office user is out at their next request.

export type SubjectKind = "worker" | "office";

export const SESSION_LIFETIME_MS = 30 * DAY;
export const ROTATE_AFTER_MS = 24 * HOUR;
export const PREVIOUS_TOKEN_GRACE_MS = 60_000;

export interface NewSession {
  id: string;
  token: string;
  expiresAt: Date;
}

export async function createSession(
  tx: FirmTx,
  opts: { kind: SubjectKind; subjectId: string; now: Date },
): Promise<NewSession> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("createSession must be called inside withFirm");
  const token = newToken();
  const expiresAt = addMs(opts.now, SESSION_LIFETIME_MS);
  const [row] = await tx
    .insert(sessions)
    .values({
      firmId,
      kind: opts.kind,
      workerId: opts.kind === "worker" ? opts.subjectId : null,
      officeUserId: opts.kind === "office" ? opts.subjectId : null,
      tokenHash: hashToken(token),
      expiresAt,
      rotatedAt: opts.now,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error("session insert returned nothing");
  return { id: row.id, token, expiresAt };
}

export interface ActiveSession {
  id: string;
  kind: SubjectKind;
  subjectId: string;
  expiresAt: Date;
  rotatedAt: Date;
  steppedUpUntil: Date | null;
  rotationDue: boolean;
}

export async function findSession(
  tx: FirmTx,
  opts: { kind: SubjectKind; token: string; now: Date },
): Promise<ActiveSession | null> {
  const hash = hashToken(opts.token);
  const { rows } = await tx.execute<{
    id: string;
    subject_id: string;
    expires_at: Date | string;
    rotated_at: Date | string;
    stepped_up_until: Date | string | null;
  }>(sql`
    select s.id, coalesce(s.worker_id, s.office_user_id) as subject_id, s.expires_at,
           s.rotated_at, s.stepped_up_until
      from sessions s
     where s.kind = ${opts.kind}
       and s.revoked_at is null
       and s.expires_at > ${opts.now}
       and (s.token_hash = ${hash}
            or (s.prev_token_hash = ${hash} and s.prev_valid_until > ${opts.now}))
       and case s.kind
             when 'worker' then exists (select 1 from workers w
                                         where w.id = s.worker_id and w.status = 'active')
             else exists (select 1 from office_users o
                           where o.id = s.office_user_id and o.status = 'active')
           end
  `);
  const row = rows[0];
  if (!row) return null;
  const rotatedAt = new Date(row.rotated_at);
  return {
    id: row.id,
    kind: opts.kind,
    subjectId: row.subject_id,
    expiresAt: new Date(row.expires_at),
    rotatedAt,
    steppedUpUntil: row.stepped_up_until ? new Date(row.stepped_up_until) : null,
    rotationDue: opts.now.getTime() - rotatedAt.getTime() >= ROTATE_AFTER_MS,
  };
}

// Replaces the session's token. Conditional on rotated_at, so two requests racing to rotate
// can't both win (the loser keeps its still-valid cookie).
export async function rotateSession(
  tx: FirmTx,
  opts: { session: ActiveSession; now: Date },
): Promise<{ token: string; expiresAt: Date } | null> {
  const token = newToken();
  const updated = await tx
    .update(sessions)
    .set({
      prevTokenHash: sql`${sessions.tokenHash}`,
      prevValidUntil: addMs(opts.now, PREVIOUS_TOKEN_GRACE_MS),
      tokenHash: hashToken(token),
      rotatedAt: opts.now,
    })
    .where(
      and(
        eq(sessions.id, opts.session.id),
        eq(sessions.rotatedAt, opts.session.rotatedAt),
        isNull(sessions.revokedAt), // ended meanwhile (logged out, access turned off): stays ended
      ),
    )
    .returning({ id: sessions.id });
  if (updated.length === 0) return null;
  await recordEvent(tx, {
    actorType: opts.session.kind,
    actorId: opts.session.subjectId,
    action: "auth.session_rotated",
    entityType: "session",
    entityId: opts.session.id,
  });
  return { token, expiresAt: opts.session.expiresAt };
}

// Logout: the session can never be used again. One conditional statement, so two logouts at
// once revoke (and log) it once.
export async function endSession(
  tx: FirmTx,
  opts: { kind: SubjectKind; token: string; now: Date },
): Promise<boolean> {
  const hash = hashToken(opts.token);
  const [ended] = await tx
    .update(sessions)
    .set({ revokedAt: opts.now })
    .where(
      and(
        eq(sessions.kind, opts.kind),
        isNull(sessions.revokedAt),
        or(
          eq(sessions.tokenHash, hash),
          and(eq(sessions.prevTokenHash, hash), gt(sessions.prevValidUntil, opts.now)),
        ),
      ),
    )
    .returning({
      id: sessions.id,
      workerId: sessions.workerId,
      officeUserId: sessions.officeUserId,
    });
  if (!ended) return false;
  await recordEvent(tx, {
    actorType: opts.kind,
    actorId: ended.workerId ?? ended.officeUserId,
    action: "auth.logout",
    entityType: "session",
    entityId: ended.id,
  });
  return true;
}

// Signs someone out everywhere: every session they have ends and every login link they haven't
// used yet is spent, at once. For an office user turned off or back on, or signed out on every
// device (src/lib/office/team.ts), and a worker whose mobile or status changes
// (src/lib/roster/workers.ts). Inside the caller's transaction; the caller logs it.
//
// Links first: a login using one of their links at this moment holds that link's row, so this
// waits for it to finish, and the sessions statement after it (a fresh look, under READ COMMITTED)
// then sees the session it made and ends that too. Only live ones are counted (and ended): an
// expired session or link is dead already, and "logged out on every device" must mean something.
export async function endEverySession(
  tx: FirmTx,
  opts: { kind: SubjectKind; subjectId: string; now: Date },
): Promise<{ sessions: number; links: number }> {
  const sessionOf =
    opts.kind === "worker"
      ? eq(sessions.workerId, opts.subjectId)
      : eq(sessions.officeUserId, opts.subjectId);
  const linkOf =
    opts.kind === "worker"
      ? eq(magicLinks.workerId, opts.subjectId)
      : eq(magicLinks.officeUserId, opts.subjectId);
  const spent = await tx
    .update(magicLinks)
    .set({ usedAt: opts.now })
    .where(
      and(
        eq(magicLinks.kind, opts.kind),
        linkOf,
        isNull(magicLinks.usedAt),
        gt(magicLinks.expiresAt, opts.now),
      ),
    )
    .returning({ id: magicLinks.id });
  const ended = await tx
    .update(sessions)
    .set({ revokedAt: opts.now })
    .where(
      and(
        eq(sessions.kind, opts.kind),
        sessionOf,
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, opts.now),
      ),
    )
    .returning({ id: sessions.id });
  return { sessions: ended.length, links: spent.length };
}
