import { sql } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
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
import { portalUrl } from "../tenancy/portal-url";
import {
  CLIENT_REQUEST_ALERT_QUEUE,
  CLIENT_REQUEST_ANSWER_QUEUE,
  clientRequestAlertPayload,
  clientRequestAnswerPayload,
  type ClientRequestAlertPayload,
  type ClientRequestAnswerPayload,
} from "./jobs";
import { loadClientRequest } from "./queue";

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
//   their requests page.

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

// Who is told about an urgent request on this contract: active admins and resourcers who want it,
// with a browser, who look after the contract or none at all. In id order.
async function alertRecipients(tx: FirmTx, contractId: string): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    select ou.id::text as id
      from office_users ou
     where ou.status = 'active' and ou.role in ('admin', 'resourcer')
       and ${wantsSql("client_requests")}
       and (not exists (select 1 from office_user_clients oc
                         where oc.firm_id = ou.firm_id and oc.office_user_id = ou.id)
            or exists (select 1 from office_user_clients oc
                        where oc.firm_id = ou.firm_id and oc.office_user_id = ou.id
                          and oc.client_id = ${contractId}::uuid))
       and exists (select 1 from office_push_subscriptions p
                    where p.firm_id = ou.firm_id and p.office_user_id = ou.id)
     order by ou.id
  `);
  return rows.map((r) => r.id);
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
        link: `${portalUrl(firm.slug, deps.baseDomain)}${CLIENT_REQUESTS_OWN_PAGE}`,
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
