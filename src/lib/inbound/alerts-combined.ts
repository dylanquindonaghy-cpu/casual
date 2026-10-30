import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { firms, officeUsers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import { unknownNumbersCombinedEmail } from "../messaging/templates";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { wallTimeOf } from "../time/zoned";
import { takeCombinedAlert, UNKNOWN_ALERTS } from "./limits";

// The hour's one email for the rest (Phase 25.3; docs/messaging-templates.md
// `unknown_numbers_combined`). Past the firm's 5 unknown-number alerts in a clock hour, each
// message's claim (src/lib/inbound/reply.ts) logs `alertHeld` with its hour and queues this job for
// a minute after the hour ends (once a slot: a pg-boss singleton key). The job, at most once per
// firm and hour (claim → send → record, like the alert itself):
//   1. a short transaction claims the hour (takeCombinedAlert) and counts its held alerts; none, or
//      already claimed: nothing more;
//   2. the email goes to each active admin and resourcer, no transaction open;
//   3. a short transaction logs `message.office_alerts_combined {hourStart, from, to, messages,
//      recipients, failed, skipped}` (the hour in the firm's time; counts, never an address).
// Like the alert, no number and no message: they're on Enquiries, under Need a person.

export const OFFICE_ALERTS_COMBINED_QUEUE = "office-alerts-combined";

export const officeAlertsCombinedPayload = firmJobEnvelope.extend({
  hourStart: z.iso.datetime(),
});
export type OfficeAlertsCombinedPayload = z.infer<typeof officeAlertsCombinedPayload>;
export const officeAlertsCombinedJob = {
  queue: OFFICE_ALERTS_COMBINED_QUEUE,
  schema: officeAlertsCombinedPayload,
};

// When the hour's job runs: a minute after it ends, so a claim made in its last moments is counted.
export const COMBINED_GRACE_MS = 60_000;

// What the claim queues (reply.ts): the hour's key and when to run.
export function combinedAlertJob(hourStart: Date): {
  payload: Omit<OfficeAlertsCombinedPayload, "firmId">;
  options: { startAfter: Date; singletonKey: string; singletonSeconds: number };
} {
  const key = `alerts-combined:${hourStart.getTime()}`;
  return {
    payload: { idempotencyKey: key, hourStart: hourStart.toISOString() },
    options: {
      startAfter: new Date(hourStart.getTime() + UNKNOWN_ALERTS.windowMs + COMBINED_GRACE_MS),
      singletonKey: key,
      singletonSeconds: 3_600,
    },
  };
}

// Who the office's alerts go to: active admins and resourcers with an address that is one.
export async function officeAlertRecipients(
  tx: FirmTx,
): Promise<{ recipients: string[]; skipped: number }> {
  const office = await tx
    .select({ email: officeUsers.email })
    .from(officeUsers)
    .where(and(eq(officeUsers.status, "active"), inArray(officeUsers.role, ["admin", "resourcer"])))
    .orderBy(asc(officeUsers.email));
  const recipients = office.map((o) => o.email).filter((e) => z.email().safeParse(e).success);
  return { recipients, skipped: office.length - recipients.length };
}

export interface OfficeAlertsCombinedDeps {
  transport: MessagingTransport;
  baseDomain: string;
}

export type OfficeAlertsCombinedResult =
  | { status: "already" } // the hour was claimed before
  | { status: "none" } // no message that hour went without its email
  | { status: "sent"; messages: number; emailed: number; failed: number }
  | { status: "no_recipients"; messages: number };

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (at: Date, timeZone: string) => {
  const w = wallTimeOf(at, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

export async function runOfficeAlertsCombined(
  payload: OfficeAlertsCombinedPayload,
  run: WithFirm,
  deps: OfficeAlertsCombinedDeps,
): Promise<OfficeAlertsCombinedResult> {
  const hourStart = new Date(payload.hourStart);
  const hourEnd = new Date(hourStart.getTime() + UNKNOWN_ALERTS.windowMs);
  const claim = await run(payload.firmId, async (tx) => {
    if (!(await takeCombinedAlert(tx, hourStart))) return { status: "already" as const };
    // The hour's messages that got no email (their claim said so, with the hour), among those
    // logged in the last 2 days by the database's clock (on the log's action index: this runs a
    // minute after the hour ends, unless the worker was down).
    const { rows } = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from events e
       where e.action = 'message.received' and e.created_at > now() - interval '2 days'
         and e.data ->> 'alertHeld' = 'true' and e.data ->> 'alertHour' = ${payload.hourStart}
    `);
    const messages = rows[0]?.n ?? 0;
    if (messages === 0) return { status: "none" as const };
    const [firm] = await tx
      .select({
        name: firms.name,
        slug: firms.slug,
        timezone: firms.timezone,
        settings: firms.settings,
      })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    if (!firm) throw new Error("firm not visible inside its own transaction");
    const hour = {
      hourStart: payload.hourStart,
      from: clock(hourStart, firm.timezone),
      to: clock(hourEnd, firm.timezone),
    };
    const { recipients, skipped } = await officeAlertRecipients(tx);
    if (recipients.length === 0) {
      // Nobody to email: said so, never "emailed 0 people".
      await recordEvent(tx, {
        actorType: "system",
        action: "message.office_alerts_combined",
        entityType: "firm",
        entityId: payload.firmId,
        data: { ...hour, messages, recipients: 0, failed: 0, skipped },
      });
      return { status: "no_recipients" as const, messages };
    }
    const voice = { name: firm.name, signOff: signOffFor(firm.name, firm.settings.sign_off) };
    return {
      status: "send" as const,
      hour,
      messages,
      recipients,
      skipped,
      email: unknownNumbersCombinedEmail(
        voice,
        `${portalUrl(firm.slug, deps.baseDomain)}/office/enquiries?view=person`,
        { messages, from: hour.from, to: hour.to },
      ),
    };
  });
  if (claim.status !== "send") return claim;

  let emailed = 0;
  let failed = 0;
  for (const to of claim.recipients) {
    try {
      await deps.transport.send({ channel: "email", to, ...claim.email });
      emailed += 1;
    } catch {
      failed += 1;
    }
  }
  await run(payload.firmId, (tx) =>
    recordEvent(tx, {
      actorType: "system",
      action: "message.office_alerts_combined",
      entityType: "firm",
      entityId: payload.firmId,
      data: {
        ...claim.hour,
        messages: claim.messages,
        recipients: emailed,
        failed,
        skipped: claim.skipped,
      },
    }),
  );
  return { status: "sent", messages: claim.messages, emailed, failed };
}

export function createOfficeAlertsCombinedTask(
  deps: () => OfficeAlertsCombinedDeps,
): FirmTask<OfficeAlertsCombinedPayload> {
  return {
    queue: OFFICE_ALERTS_COMBINED_QUEUE,
    schema: officeAlertsCombinedPayload,
    task: (payload, run) => runOfficeAlertsCombined(payload, run, deps()),
  };
}

const workerDeps = (): OfficeAlertsCombinedDeps => {
  const env = workerEnv();
  return { transport: getTransport(env), baseDomain: env.APP_BASE_DOMAIN };
};
export const officeAlertsCombinedTask = createOfficeAlertsCombinedTask(workerDeps);
