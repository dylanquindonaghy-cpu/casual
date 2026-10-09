import { and, asc, eq } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { normaliseEmail } from "../auth/office-login";
import type { OfficeRole } from "../auth/roles";
import { endEverySession } from "../auth/sessions";
import { officeUsers } from "../db/schema";
import type { WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// Taking office access away, giving it back and changing roles (audit M21, L80): the office team
// page (`/office/team`, admins) and `npm run firm:office-user` (the command line, as "system").
// One transaction each:
//   - the firm's active admins locked first (in id order), so two changes at once take turns: two
//     admins turning each other off at once can't both win, and the firm always keeps an admin.
//     The locks are FOR NO KEY UPDATE: they take turns with each other but not with the key-share
//     lock a new session's or link's foreign key takes, so a login finishing at the same moment
//     can't deadlock with this; ending their sessions waits for it and ends its session too
//     (`endEverySession`, links first);
//   - from the office, the acting admin checked again (`officeUserMay`); nobody changes their own
//     access there (another admin does);
//   - the person locked, then the change:
//       turn off: status disabled, and every session and unused login link ended at once
//         (`endEverySession`): logged out everywhere, now, not at their next page;
//       turn back on: status active, and anything left from before ended too, so no old session
//         comes back: they log in afresh with a new link;
//       change role: read again at their next request (a session holds no role);
//       sign out on every device: for a lost laptop, without turning access off;
//   - logged `office_user.disabled` / `enabled` / `role_changed` / `signed_out` {officeUserId, …,
//     sessions and links ended}, by the admin or the system. A change that changes nothing logs
//     nothing. Ids and counts only: never a name or an email.

export type OfficeAccessChange =
  | { kind: "disable" }
  | { kind: "enable" }
  | { kind: "role"; role: OfficeRole }
  | { kind: "sign_out" };

export type OfficeAccessResult =
  | {
      status: "done";
      change: OfficeAccessChange["kind"];
      name: string;
      role: OfficeRole;
      sessionsEnded: number;
    }
  | { status: "unchanged"; change: OfficeAccessChange["kind"]; name: string; role: OfficeRole }
  | { status: "last_admin"; name: string }
  | { status: "self" }
  | { status: "not_found" }
  | { status: "not_allowed" };

export type AccessChangedBy = { type: "office"; id: string } | { type: "system" };

export async function changeOfficeAccess(
  run: WithFirm,
  firmId: string,
  input: {
    person: { id: string } | { email: string };
    change: OfficeAccessChange;
    by: AccessChangedBy;
  },
  deps: { clock?: Clock } = {},
): Promise<OfficeAccessResult> {
  const now = (deps.clock ?? systemClock).now();
  const { change, by } = input;
  const email = "email" in input.person ? normaliseEmail(input.person.email) : null;
  if ("email" in input.person && !email) return { status: "not_found" };
  return run(firmId, async (tx): Promise<OfficeAccessResult> => {
    const admins = await tx
      .select({ id: officeUsers.id })
      .from(officeUsers)
      .where(and(eq(officeUsers.role, "admin"), eq(officeUsers.status, "active")))
      .orderBy(asc(officeUsers.id))
      .for("no key update");
    if (by.type === "office" && !(await officeUserMay(tx, by.id, "team"))) {
      return { status: "not_allowed" };
    }
    const [person] = await tx
      .select({
        id: officeUsers.id,
        name: officeUsers.name,
        role: officeUsers.role,
        status: officeUsers.status,
      })
      .from(officeUsers)
      .where(
        "id" in input.person
          ? eq(officeUsers.id, input.person.id)
          : eq(officeUsers.email, email ?? ""),
      )
      .for("no key update");
    if (!person) return { status: "not_found" };
    if (by.type === "office" && by.id === person.id) return { status: "self" };

    const same = { change: change.kind, name: person.name, role: person.role };
    // Would this leave the firm with no active admin?
    const lastAdmin =
      person.role === "admin" &&
      person.status === "active" &&
      admins.every((a) => a.id === person.id);
    const log = (action: string, data: Record<string, unknown>) =>
      recordEvent(tx, {
        ...(by.type === "office"
          ? { actorType: "office", actorId: by.id }
          : { actorType: "system" }),
        action,
        entityType: "office_user",
        entityId: person.id,
        data: { officeUserId: person.id, ...data },
      });
    const end = () => endEverySession(tx, { kind: "office", subjectId: person.id, now });

    switch (change.kind) {
      case "disable": {
        if (person.status === "disabled") return { status: "unchanged", ...same };
        if (lastAdmin) return { status: "last_admin", name: person.name };
        await tx
          .update(officeUsers)
          .set({ status: "disabled" })
          .where(eq(officeUsers.id, person.id));
        const ended = await end();
        await log("office_user.disabled", {
          role: person.role,
          sessionsEnded: ended.sessions,
          linksSpent: ended.links,
        });
        return { status: "done", ...same, sessionsEnded: ended.sessions };
      }
      case "enable": {
        if (person.status === "active") return { status: "unchanged", ...same };
        await tx.update(officeUsers).set({ status: "active" }).where(eq(officeUsers.id, person.id));
        const ended = await end();
        await log("office_user.enabled", {
          role: person.role,
          sessionsEnded: ended.sessions,
          linksSpent: ended.links,
        });
        return { status: "done", ...same, sessionsEnded: ended.sessions };
      }
      case "role": {
        if (person.role === change.role) return { status: "unchanged", ...same };
        if (lastAdmin) return { status: "last_admin", name: person.name };
        await tx
          .update(officeUsers)
          .set({ role: change.role })
          .where(eq(officeUsers.id, person.id));
        await log("office_user.role_changed", { from: person.role, to: change.role });
        return { status: "done", ...same, role: change.role, sessionsEnded: 0 };
      }
      case "sign_out": {
        const ended = await end();
        if (ended.sessions === 0 && ended.links === 0) return { status: "unchanged", ...same };
        await log("office_user.signed_out", {
          sessionsEnded: ended.sessions,
          linksSpent: ended.links,
        });
        return { status: "done", ...same, sessionsEnded: ended.sessions };
      }
    }
  });
}

// The office team page's change: the firm from the request, the admin from their session.
export function changeAccessFromOffice(
  ctx: OfficeContext,
  officeUserId: string,
  change: OfficeAccessChange,
): Promise<OfficeAccessResult> {
  const { run, deps } = parts(ctx);
  return changeOfficeAccess(
    run,
    ctx.firm.id,
    { person: { id: officeUserId }, change, by: { type: "office", id: ctx.officeUserId } },
    deps,
  );
}
