import { eq, sql, type SQL } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { uuidArray } from "../db/arrays";
import { firms } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { getTransport } from "../messaging";
import { clientRequestAnswerEmail, officeClientRequestPush } from "../messaging/templates";
import type { MessagingTransport } from "../messaging/transport";
import { pushToTargets, recordPushes, type InFirm } from "../notify/send";
import { firmVoice } from "../offers/waves";
import { forgetOfficePushTarget, officePushTargets } from "../push/office-subscriptions";
import { getPushTransport, type PushTransport } from "../push/transport";
import { wantsSql } from "../office/tell-me";
import { ownDomainUrl, portalUrl } from "../tenancy/portal-url";
import {
  queueClientRequestAlert,
  CLIENT_REQUEST_ALERT_QUEUE,
  CLIENT_REQUEST_ANSWER_QUEUE,
  clientRequestAlertPayload,
  clientRequestAnswerPayload,
  type ClientRequestAlertPayload,
  type ClientRequestAnswerPayload,
} from "./jobs";
import { loadClientRequest, loadOpenClientRequests, OPEN_REQUESTS_READ } from "./queue";

// Client requests' messages (Phase 36.4), each claimed once (a log entry committed before anything
// goes) and sent with no transaction open, as the office alerts are (src/lib/office/alerts.ts):
// a job that runs twice tells nobody twice.
//
// - The urgent alert: a notification to each active admin and resourcer who left "Tell me about:
//   client requests" on (the default), looks after the request's contract (or no contract at all)
//   and turned notifications on in a browser. Only while the request still waits and the rules
//   still find it urgent. Tapping it opens Client requests. No casual's name: the contract's name and
//   what was asked for.
// - The answer: an email to the client contact who sent the request, while they're switched on,
//   saying the office accepted it, declined it (with the reason) or asked something, with a link to
//   their requests page: on the firm's own domain when it has a verified one (as login links are,
//   src/lib/auth/send-portal-link.ts), otherwise its portal.
// - A request that has become urgent since it was sent (a session now within 48 hours, a casual
//   booked since): the office alerts' tick (src/lib/office/alerts.ts) queues the alert for it while
//   someone it would tell hasn't been (queueBecameUrgentAlerts).

export interface ClientNotifyDeps {
  push: PushTransport;
  transport: MessagingTransport;
  baseDomain: string;
  clock: Clock;
  logger?: Logger;
}

const OFFICE_BROWSERS = {
  forget: forgetOfficePushTarget,
  entityType: "office_push_subscription",
  action: "office_push.forgotten",
};

export const CLIENT_REQUESTS_PAGE = "/office/client-requests";
export const CLIENT_REQUESTS_OWN_PAGE = "/client/requests";

// "The office user `ou` is told about an urgent request on `contract`": active admins and resourcers
// who want it, with a browser, who look after the contract or none at all.
const recipientSql = (contract: SQL) => sql`
  ou.status = 'active' and ou.role in ('admin', 'resourcer')
  and ${wantsSql("client_requests")}
  and (not exists (select 1 from office_user_clients oc
                    where oc.firm_id = ou.firm_id and oc.office_user_id = ou.id)
       or exists (select 1 from office_user_clients oc
                   where oc.firm_id = ou.firm_id and oc.office_user_id = ou.id
                     and oc.client_id = ${contract}))
  and exists (select 1 from office_push_subscriptions p
               where p.firm_id = ou.firm_id and p.office_user_id = ou.id)`;

// "... and hasn't been told about request `request` yet" (the alert's claim, below).
const notToldSql = (request: SQL) => sql`
  not exists (select 1 from events
               where action = 'office.alerted' and entity_id = ${request}
                 and data ->> 'officeUserId' = ou.id::text and data ->> 'kind' = 'client_requests')`;

// Who is told about an urgent request on this contract. In id order.
async function alertRecipients(tx: FirmTx, contractId: string): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    select ou.id::text as id from office_users ou
     where ${recipientSql(sql`${contractId}::uuid`)}
     order by ou.id
  `);
  return rows.map((r) => r.id);
}

// The tick's part (every 5 minutes, in the firm's transaction): each waiting request the rules find
// urgent now that someone it would tell hasn't been told about (one urgent when sent was queued
// then; this catches one that has become urgent since, or someone who turned notifications on
// since), queued once for this slot. The job claims each person, so nobody is told twice. Returns
// how many were queued.
export async function queueBecameUrgentAlerts(
  tx: FirmTx,
  now: Date,
  slot: number,
): Promise<number> {
  const urgent = (await loadOpenClientRequests(tx, now, null, OPEN_REQUESTS_READ)).filter(
    (r) => r.status === "waiting" && r.urgent !== null,
  );
  if (urgent.length === 0) return 0;
  const { rows } = await tx.execute<{ id: string }>(sql`
    select r.id::text as id from client_requests r
     where r.id = any(${uuidArray(urgent.map((r) => r.id))})
       and exists (select 1 from office_users ou
                    where ${recipientSql(sql`r.contract_id`)} and ${notToldSql(sql`r.id`)})
     order by r.id
  `);
  let queued = 0;
  for (const r of rows) {
    await queueClientRequestAlert(tx, { requestId: r.id, key: `tick-${slot}` });
    queued += 1;
  }
  return queued;
}

export type ClientAlertResult =
  { status: "not_needed" } | { status: "sent"; people: number; pushes: number };

export async function runClientRequestAlert(
  payload: ClientRequestAlertPayload,
  run: WithFirm,
  deps: ClientNotifyDeps,
): Promise<ClientAlertResult> {
  const inFirm: InFirm = (fn) => run(payload.firmId, fn);
  const now = deps.clock.now();
  const found = await inFirm(async (tx) => {
    const r = await loadClientRequest(tx, now, payload.requestId);
    if (!r || r.status !== "waiting" || r.urgent === null) return null;
    const people: string[] = [];
    for (const id of await alertRecipients(tx, r.contractId)) {
      // Their row held (two copies of the job take turns), then whether it was claimed.
      await tx.execute(sql`select 1 from office_users where id = ${id}::uuid for update`);
      const { rows: done } = await tx.execute(sql`
        select 1 from events
         where action = 'office.alerted' and entity_id = ${r.id}::uuid
           and data ->> 'officeUserId' = ${id} and data ->> 'kind' = 'client_requests'
         limit 1
      `);
      if (done.length > 0) continue;
      await recordEvent(tx, {
        actorType: "system",
        action: "office.alerted",
        entityType: "client_request",
        entityId: r.id,
        data: { officeUserId: id, kind: "client_requests" },
      });
      people.push(id);
    }
    return {
      people,
      payload: {
        ...officeClientRequestPush({ contract: r.contractName, title: r.title }),
        url: CLIENT_REQUESTS_PAGE,
        urgent: true,
        ...(r.session ? { until: r.session.startsAt } : {}),
      },
    };
  });
  if (!found || found.people.length === 0) return { status: "not_needed" };
  let pushes = 0;
  for (const id of found.people) {
    const outcome = await pushToTargets(
      inFirm,
      deps,
      (tx) => officePushTargets(tx, id),
      found.payload,
      "client request alerts",
    );
    pushes += await inFirm((tx) => recordPushes(tx, outcome, deps.logger ?? log, OFFICE_BROWSERS));
  }
  return { status: "sent", people: found.people.length, pushes };
}

export type ClientAnswerResult =
  | { status: "sent" }
  | { status: "failed" }
  | { status: "already" } // claimed by an earlier run
  | { status: "superseded" } // a later answer replaced this one before it went
  | { status: "gone" }; // no such answer, or their login is switched off

const ANSWERS = {
  "client_request.accepted": "accepted",
  "client_request.declined": "declined",
  "client_request.asked": "asked",
} as const;

export async function runClientRequestAnswer(
  payload: ClientRequestAnswerPayload,
  run: WithFirm,
  deps: ClientNotifyDeps,
): Promise<ClientAnswerResult> {
  const inFirm: InFirm = (fn) => run(payload.firmId, fn);
  const now = deps.clock.now();
  const claim = await inFirm(async (tx) => {
    // The request held: two copies of the job take turns.
    const r = await loadClientRequest(tx, now, payload.requestId, { lock: true });
    if (!r) return { status: "gone" as const };
    const { rows: answer } = await tx.execute<{ action: string }>(sql`
      select action from events
       where id = ${payload.answerEventId} and entity_id = ${r.id}::uuid
    `);
    const kind = ANSWERS[answer[0]?.action as keyof typeof ANSWERS] ?? null;
    if (!kind) return { status: "gone" as const };
    const { rows: done } = await tx.execute(sql`
      select 1 from events
       where entity_id = ${r.id}::uuid and action = 'client_request.email_sending'
         and (data ->> 'answerEventId')::bigint = ${payload.answerEventId}
       limit 1
    `);
    if (done.length > 0) return { status: "already" as const };
    const { rows: contact } = await tx.execute<{ email: string }>(sql`
      select email from client_contacts where id = ${r.contactId}::uuid and is_on
    `);
    const to = contact[0]?.email;
    if (!to) return { status: "gone" as const };
    // An answer a later one replaced before this ran (asked, then accepted): that one's email says
    // where it stands, and the words on the request are the later answer's.
    const { rows: latest } = await tx.execute<{ id: number | string }>(sql`
      select id from events
       where entity_id = ${r.id}::uuid
         and action in ('client_request.accepted', 'client_request.declined',
                        'client_request.asked')
       order by id desc limit 1
    `);
    if (Number(latest[0]?.id) !== payload.answerEventId) return { status: "superseded" as const };
    const firm = await firmVoice(tx, payload.firmId);
    // The firm's own domain when it has a verified one (from the firm's own record), else its portal.
    const [own] = await tx
      .select({ domain: firms.customDomain, verified: firms.domainVerified })
      .from(firms)
      .where(eq(firms.id, payload.firmId));
    const site =
      own?.verified && own.domain
        ? ownDomainUrl(own.domain)
        : portalUrl(firm.slug, deps.baseDomain);
    await recordEvent(tx, {
      actorType: "system",
      action: "client_request.email_sending",
      entityType: "client_request",
      entityId: r.id,
      data: { answerEventId: payload.answerEventId, answer: kind },
    });
    return {
      status: "send" as const,
      to,
      message: clientRequestAnswerEmail(firm.voice, {
        answer: kind,
        title: r.title,
        words: r.officeAnswer,
        link: `${site}${CLIENT_REQUESTS_OWN_PAGE}`,
      }),
    };
  });
  if (claim.status !== "send") return { status: claim.status };
  let code: string | null = null;
  try {
    await deps.transport.send({ channel: "email", to: claim.to, ...claim.message });
  } catch (err) {
    code = errorCode(err);
  }
  await inFirm((tx) =>
    recordEvent(tx, {
      actorType: "system",
      action: code === null ? "client_request.email_sent" : "client_request.email_failed",
      entityType: "client_request",
      entityId: payload.requestId,
      data: { answerEventId: payload.answerEventId, ...(code === null ? {} : { code }) },
    }),
  );
  return code === null ? { status: "sent" } : { status: "failed" };
}

// --- The worker's wiring -------------------------------------------------------------------------

export const clientNotifyDeps = (): ClientNotifyDeps => {
  const env = workerEnv();
  return {
    push: getPushTransport(env),
    transport: getTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
  };
};

export function createClientRequestTasks(deps: () => ClientNotifyDeps) {
  const alert: FirmTask<ClientRequestAlertPayload> = {
    queue: CLIENT_REQUEST_ALERT_QUEUE,
    schema: clientRequestAlertPayload,
    task: (payload, run) => runClientRequestAlert(payload, run, deps()),
  };
  const answer: FirmTask<ClientRequestAnswerPayload> = {
    queue: CLIENT_REQUEST_ANSWER_QUEUE,
    schema: clientRequestAnswerPayload,
    task: (payload, run) => runClientRequestAnswer(payload, run, deps()),
  };
  return { alert, answer };
}
export const clientRequestTasks = createClientRequestTasks(clientNotifyDeps);
