import { and, eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { events, firms, officeUsers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { getTransport } from "../messaging";
import type { MessagingTransport } from "../messaging/transport";
import { officeCancelPush, officeOpenPush, officeSummaryEmail } from "../messaging/templates";
import { pushToTargets, recordPushes, type InFirm } from "../notify/send";
import { forgetOfficePushTarget, officePushTargets } from "../push/office-subscriptions";
import { getPushTransport, type PushPayload, type PushTransport } from "../push/transport";
import { firmVoice } from "../offers/waves";
import { noticeText } from "../portal/cancel-reasons";
import { portalUrl } from "../tenancy/portal-url";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { dayMonthLabel } from "./dashboard-cards-copy";
import { sessionWhen } from "./dashboard-map-copy";
import { bookedJoin, placeFree } from "./events";
import { recipientsFor } from "./tell-me";
import {
  CANCEL_PUSH_HOURS,
  OPEN_PUSH_HOURS,
  SUMMARY_HOUR,
  SUMMARY_LATEST_HOUR,
  type TellMeKind,
} from "./tell-me-copy";
import {
  OFFICE_CANCEL_ALERT_QUEUE,
  OFFICE_OPEN_ALERT_QUEUE,
  OFFICE_SUMMARY_QUEUE,
  officeCancelAlertPayload,
  officeOpenAlertPayload,
  officeSummaryPayload,
  type OfficeCancelAlertPayload,
  type OfficeOpenAlertPayload,
  type OfficeSummaryPayload,
} from "./alert-jobs";
import { loadUpdatesPage } from "./updates";
import { startsIn, summaryLine } from "./updates-copy";

// Office alerts (Phase 26.4; the spec page's upd-4 and upd-5, decision 5), each to the admins and
// resourcers who switched it on under Updates' "Tell me about", for their contracts only:
// - a notification on their phone or computer when a casual cancels with under 48 hours' notice
//   (queued by the cancellation itself: src/lib/roster/cancel.ts);
// - a notification for places still open 6 hours before a session starts (a tick every 5 minutes);
// - an email at 08:00 (the firm's time) with what needs action and what happened since 08:00
//   yesterday (the same tick, once a day, up to 11:00).
// Each is claimed once per person (an `office.alerted` / `office.summary_emailed` event, committed
// before anything goes) and sent with no transaction open, as the 3-hour escalation email is
// (src/lib/offers/waves.ts runEscalation): a job that runs twice tells nobody twice. No casual's
// name goes in a notification or an email (src/lib/messaging/templates.ts "Office alerts").

const SLOT_MS = 5 * 60_000;
const DAY_SECONDS = 24 * 3600;
// At most this many sessions are looked at per firm per tick, soonest first (the rest next tick).
export const OPEN_ALERT_SESSIONS = 50;
// The summary lists this many things that need action ("and N more" after).
export const SUMMARY_NEEDS_LISTED = 10;

export interface OfficeAlertDeps {
  push: PushTransport;
  transport: MessagingTransport;
  baseDomain: string;
  clock: Clock;
  logger?: Logger;
}

// The browsers forgotten when the push service says they're gone are office users' (recordPushes).
const OFFICE_BROWSERS = {
  forget: forgetOfficePushTarget,
  entityType: "office_push_subscription",
  action: "office_push.forgotten",
};

// One person's claim on one alert, inside the sender's transaction: their row locked (two copies of
// the job take turns), then whether it was already claimed. True: theirs to send.
async function claim(
  tx: FirmTx,
  officeUserId: string,
  kind: TellMeKind,
  entity: { type: "assignment" | "shift"; id: string },
): Promise<boolean> {
  await tx
    .select({ id: officeUsers.id })
    .from(officeUsers)
    .where(eq(officeUsers.id, officeUserId))
    .for("update");
  const [done] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.action, "office.alerted"),
        eq(events.entityId, entity.id),
        sql`${events.data} ->> 'officeUserId' = ${officeUserId}`,
        sql`${events.data} ->> 'kind' = ${kind}`,
      ),
    )
    .limit(1);
  if (done) return false;
  await recordEvent(tx, {
    actorType: "system",
    action: "office.alerted",
    entityType: entity.type,
    entityId: entity.id,
    data: { officeUserId, kind },
  });
  return true;
}

// Each claimed person's browsers, pushed with no transaction open; gone ones forgotten after.
async function pushToEach(
  inFirm: InFirm,
  deps: OfficeAlertDeps,
  people: string[],
  payload: PushPayload,
): Promise<number> {
  let pushes = 0;
  for (const id of people) {
    const outcome = await pushToTargets(
      inFirm,
      deps,
      (tx) => officePushTargets(tx, id),
      payload,
      "office alerts",
    );
    pushes += await inFirm((tx) => recordPushes(tx, outcome, deps.logger ?? log, OFFICE_BROWSERS));
  }
  return pushes;
}

const timeZoneOf = async (tx: FirmTx) => {
  const [firm] = await tx.select({ tz: firms.timezone }).from(firms);
  return firm?.tz ?? "Europe/London";
};

export type AlertResult =
  { status: "not_needed" } | { status: "sent"; people: number; pushes: number };

export async function runOfficeCancelAlert(
  payload: OfficeCancelAlertPayload,
  run: WithFirm,
  deps: OfficeAlertDeps,
): Promise<AlertResult> {
  const inFirm: InFirm = (fn) => run(payload.firmId, fn);
  const now = deps.clock.now();
  const found = await inFirm(async (tx) => {
    const timeZone = await timeZoneOf(tx);
    const { rows } = await tx.execute<{
      notice_hours: string | number;
      role: string;
      starts_at: string | Date;
      site_id: string | null;
      site: string | null;
      reopened: boolean;
    }>(sql`
      select a.notice_hours, s.role, s.starts_at, coalesce(s.site_id, e.site_id)::text as site_id,
             coalesce(si.name, esi.name) as site, (${placeFree(now)}) as reopened
        from assignments a
        join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
        join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
        ${bookedJoin}
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
        left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
       where a.id = ${payload.assignmentId}::uuid and a.status = 'cancelled_worker'
    `);
    const r = rows[0];
    if (!r) return null;
    const startsAt = new Date(r.starts_at);
    const notice = Number(r.notice_hours);
    // Not a casual's any more (put back), long notice, or the session has started: nothing to say.
    if (notice >= CANCEL_PUSH_HOURS || startsAt.getTime() <= now.getTime()) return null;
    const people: string[] = [];
    for (const p of await recipientsFor(tx, "cancel_push", {
      siteId: r.site_id,
      withBrowser: true,
    })) {
      if (await claim(tx, p.id, "cancel_push", { type: "assignment", id: payload.assignmentId }))
        people.push(p.id);
    }
    const words = officeCancelPush({
      notice: noticeText(notice),
      role: r.role,
      site: r.site,
      when: sessionWhen(startsAt, timeZone),
      reopened: r.reopened,
    });
    return { people, payload: { ...words, url: "/office/updates", urgent: true, until: startsAt } };
  });
  if (!found || found.people.length === 0) return { status: "not_needed" };
  const pushes = await pushToEach(inFirm, deps, found.people, found.payload);
  return { status: "sent", people: found.people.length, pushes };
}

// --- Places still open 6 hours before the start (the tick's job) ---------------------------------

export async function runOfficeOpenAlert(
  payload: OfficeOpenAlertPayload,
  run: WithFirm,
  deps: OfficeAlertDeps,
): Promise<AlertResult> {
  const inFirm: InFirm = (fn) => run(payload.firmId, fn);
  const now = deps.clock.now();
  const toSend = await inFirm(async (tx) => {
    const timeZone = await timeZoneOf(tx);
    const { rows } = await tx.execute<{
      shift_id: string;
      role: string;
      starts_at: string | Date;
      site_id: string | null;
      site: string | null;
      places_free: number;
      offers: number;
    }>(sql`
      select s.id::text as shift_id, s.role, s.starts_at,
             coalesce(s.site_id, e.site_id)::text as site_id, coalesce(si.name, esi.name) as site,
             (s.headcount - b.booked)::int as places_free,
             (select count(*)::int from offers o
               where o.firm_id = s.firm_id and o.shift_id = s.id) as offers
        from shifts s
        join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
        ${bookedJoin}
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
        left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
       where ${placeFree(now)}
         and s.starts_at <= ${new Date(now.getTime() + OPEN_PUSH_HOURS * 3_600_000)}
       order by s.starts_at, s.id
       limit ${OPEN_ALERT_SESSIONS}
    `);
    const sends: { people: string[]; payload: PushPayload }[] = [];
    for (const r of rows) {
      const startsAt = new Date(r.starts_at);
      const people: string[] = [];
      for (const p of await recipientsFor(tx, "open_push", {
        siteId: r.site_id,
        withBrowser: true,
      })) {
        if (await claim(tx, p.id, "open_push", { type: "shift", id: r.shift_id }))
          people.push(p.id);
      }
      if (people.length === 0) continue;
      const words = officeOpenPush({
        placesFree: r.places_free,
        startsIn: startsIn(startsAt, now),
        role: r.role,
        site: r.site,
        when: sessionWhen(startsAt, timeZone),
        offers: r.offers,
      });
      sends.push({
        people,
        payload: { ...words, url: `/office/offer/${r.shift_id}`, urgent: true, until: startsAt },
      });
    }
    return sends;
  });
  let people = 0;
  let pushes = 0;
  for (const s of toSend) {
    people += s.people.length;
    pushes += await pushToEach(inFirm, deps, s.people, s.payload);
  }
  return people === 0 ? { status: "not_needed" } : { status: "sent", people, pushes };
}

// --- The 08:00 summary (the tick's job, once a day) ----------------------------------------------

export type SummaryResult = { status: "sent"; emailed: number; failed: number; empty: number };

export async function runOfficeSummary(
  payload: OfficeSummaryPayload,
  run: WithFirm,
  deps: OfficeAlertDeps,
): Promise<SummaryResult> {
  const inFirm: InFirm = (fn) => run(payload.firmId, fn);
  const now = deps.clock.now();
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);
  const people = await inFirm((tx) =>
    recipientsFor(tx, "summary", { siteId: null, anyVenue: true }),
  );
  const result: SummaryResult = { status: "sent", emailed: 0, failed: 0, empty: 0 };
  for (const p of people) {
    // Claimed, and the email written, in one transaction; sent with none open.
    const email = await inFirm(async (tx) => {
      await tx
        .select({ id: officeUsers.id })
        .from(officeUsers)
        .where(eq(officeUsers.id, p.id))
        .for("update");
      const [done] = await tx
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.action, "office.summary_emailed"),
            eq(events.entityId, p.id),
            sql`${events.data} ->> 'date' = ${payload.date}`,
          ),
        )
        .limit(1);
      if (done) return null;
      const page = await loadUpdatesPage(tx, now, p.id);
      const recent = page.everything.filter((u) => u.at >= dayAgo && u.at <= now);
      const counts = {
        took: recent.filter((u) => u.kind === "took").length,
        cancelled: recent.filter((u) => u.kind === "cancelled").length,
        under48: recent.filter((u) => u.kind === "cancelled" && u.noticeHours < 48).length,
        uploads: recent.filter((u) => u.kind === "upload").length,
      };
      // Nothing to say: no email (an empty one every morning would teach people to ignore it).
      if (page.needsAction.length === 0 && Object.values(counts).every((n) => n === 0)) {
        return "empty" as const;
      }
      const firm = await firmVoice(tx, payload.firmId);
      await recordEvent(tx, {
        actorType: "system",
        action: "office.summary_emailed",
        entityType: "office_user",
        entityId: p.id,
        data: { officeUserId: p.id, date: payload.date, needs: page.needsAction.length, ...counts },
      });
      const listed = page.needsAction.slice(0, SUMMARY_NEEDS_LISTED);
      return officeSummaryEmail(firm.voice, {
        day: dayMonthLabel(payload.date),
        mine: page.mine,
        needs: listed.map((u) => summaryLine(u, now, page.timeZone)),
        moreNeeds: page.needsAction.length - listed.length,
        ...counts,
        link: `${portalUrl(firm.slug, deps.baseDomain)}/office/updates`,
      });
    });
    if (email === null) continue;
    if (email === "empty") {
      result.empty += 1;
      continue;
    }
    try {
      await deps.transport.send({ channel: "email", to: p.email, ...email });
      result.emailed += 1;
    } catch (err) {
      result.failed += 1;
      await inFirm((tx) =>
        recordEvent(tx, {
          actorType: "system",
          action: "office.summary_failed",
          entityType: "office_user",
          entityId: p.id,
          data: { officeUserId: p.id, date: payload.date, code: errorCode(err) },
        }),
      );
    }
  }
  return result;
}

// --- The tick: every 5 minutes, no firm ----------------------------------------------------------

export interface OfficeAlertsTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}

// Each firm: its open-places job for this 5-minute slot, and from 08:00 to 11:00 its day's summary
// (once: keyed by the firm's date). One firm's failure never stops the others'.
export async function runOfficeAlertsTick(
  deps: OfficeAlertsTickDeps,
): Promise<{ open: number; summaries: number }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  const slot = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS;
  let open = 0;
  let summaries = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      await deps.run(firmId, async (tx) => {
        const timeZone = await timeZoneOf(tx);
        const openKey = `office-open-alert:${slot}`;
        if (
          await sendFirmJob(
            tx,
            { queue: OFFICE_OPEN_ALERT_QUEUE, schema: officeOpenAlertPayload },
            { idempotencyKey: openKey },
            { singletonKey: openKey, singletonSeconds: SLOT_MS / 1000 },
          )
        )
          open += 1;
        const hour = wallTimeOf(now, timeZone).hour;
        if (hour >= SUMMARY_HOUR && hour < SUMMARY_LATEST_HOUR) {
          const date = localDateOf(now, timeZone);
          const key = `office-summary:${date}`;
          if (
            await sendFirmJob(
              tx,
              { queue: OFFICE_SUMMARY_QUEUE, schema: officeSummaryPayload },
              { idempotencyKey: key, date },
              { singletonKey: key, singletonSeconds: DAY_SECONDS },
            )
          )
            summaries += 1;
        }
      });
    } catch (err) {
      logger.error("office alerts tick failed for a firm", { firmId, error: err });
    }
  }
  return { open, summaries };
}

// --- The worker's wiring -------------------------------------------------------------------------

// Read when a job runs, so the web (which only queues) never needs the worker's configuration.
export const officeAlertDeps = (): OfficeAlertDeps => {
  const env = workerEnv();
  return {
    push: getPushTransport(env),
    transport: getTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
  };
};

export function createOfficeAlertTasks(deps: () => OfficeAlertDeps) {
  const cancel: FirmTask<OfficeCancelAlertPayload> = {
    queue: OFFICE_CANCEL_ALERT_QUEUE,
    schema: officeCancelAlertPayload,
    task: (payload, run) => runOfficeCancelAlert(payload, run, deps()),
  };
  const open: FirmTask<OfficeOpenAlertPayload> = {
    queue: OFFICE_OPEN_ALERT_QUEUE,
    schema: officeOpenAlertPayload,
    task: (payload, run) => runOfficeOpenAlert(payload, run, deps()),
  };
  const summary: FirmTask<OfficeSummaryPayload> = {
    queue: OFFICE_SUMMARY_QUEUE,
    schema: officeSummaryPayload,
    task: (payload, run) => runOfficeSummary(payload, run, deps()),
  };
  return { cancel, open, summary };
}
export const officeAlertTasks = createOfficeAlertTasks(officeAlertDeps);
