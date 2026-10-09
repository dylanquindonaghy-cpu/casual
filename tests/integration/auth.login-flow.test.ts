import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumeWorkerLoginLink,
  currentWorker,
  requestWorkerLoginLink,
} from "@/lib/auth/worker-login";
import { superuserPool } from "../helpers/db";
import {
  captureTransport,
  eventMark,
  eventsFor,
  latestLinkJob,
  mobileOf,
  movableClock,
  runLinkJob,
  tokenFrom,
} from "../helpers/auth";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Worker login end to end in console mode, on the real database as the app role: the login
// request queues a job; the job (run exactly as the worker runs it) sends the link; the link
// logs the worker in once, on its own firm only.

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

describe("worker login, start to finish", () => {
  let A: Tenant;
  let B: Tenant;
  let since = 0;
  const { transport, sent } = captureTransport();
  const time = movableClock();

  beforeAll(async () => {
    A = await createTenant(su);
    B = await createTenant(su);
    since = await eventMark(su);
  });

  it("works once, on its own firm only, and writes an event for every step", async () => {
    const mobile = await mobileOf(su, A.workerId);
    const typed = `0${mobile.slice(3, 7)} ${mobile.slice(7)}`; // as a worker types it: 07700 900123

    // 1. Request a link.
    expect(await requestWorkerLoginLink({ firm: { id: A.firmId } }, typed)).toEqual({
      status: "sent",
    });

    // 2. The queued job holds ids and fixed words only: no number, no token. (Phase 10: which of
    // the firm's addresses the request came in on, a word, never the address itself.)
    const job = await latestLinkJob(su, A.firmId);
    expect(Object.keys(job?.data ?? {}).sort()).toEqual([
      "address",
      "firmId",
      "idempotencyKey",
      "purpose",
      "subjectId",
    ]);
    expect(job?.data).toMatchObject({
      firmId: A.firmId,
      purpose: "worker_login",
      address: "portal",
      subjectId: A.workerId,
    });

    // 3. The worker runs it: one WhatsApp message to the worker, signed by the firm.
    const result = await runLinkJob(job ?? { id: "", data: {} }, { transport, clock: time.clock });
    expect(result.status).toBe("completed");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "whatsapp", to: mobile });
    expect(sent[0]?.body).toContain(`http://${A.slug}.localhost:3000/l#`);
    expect(sent[0]?.body).toMatch(/— Test Firm \S+ Shift Team$/);
    const token = tokenFrom(sent[0]);

    // 4. Only the hash is stored, and the token appears nowhere in the queue.
    const stored = await su.query<{ hash: Buffer }>(
      "select token_hash as hash from magic_links where request_id = $1",
      [job?.data.idempotencyKey],
    );
    expect(stored.rows.map((r) => r.hash.toString("hex"))).toEqual([
      createHash("sha256").update(token).digest("hex"),
    ]);
    const leaked = await su.query(
      "select 1 from pgboss.job where data::text like $1 or output::text like $1",
      [`%${token}%`],
    );
    expect(leaked.rowCount).toBe(0);

    // 5. The link from Firm A does nothing on Firm B's portal...
    expect(
      await consumeWorkerLoginLink({ firm: { id: B.firmId }, clock: time.clock }, token),
    ).toEqual({
      status: "rejected",
    });
    // ...logs the worker in on Firm A...
    const login = await consumeWorkerLoginLink(
      { firm: { id: A.firmId }, clock: time.clock },
      token,
    );
    expect(login.status).toBe("ok");
    if (login.status !== "ok") return;
    // ...and never works again.
    expect(
      await consumeWorkerLoginLink({ firm: { id: A.firmId }, clock: time.clock }, token),
    ).toEqual({
      status: "rejected",
    });

    // 6. The session belongs to Firm A only.
    expect(
      (await currentWorker({ firm: { id: A.firmId }, clock: time.clock }, login.token))?.worker.id,
    ).toBe(A.workerId);
    expect(
      await currentWorker({ firm: { id: B.firmId }, clock: time.clock }, login.token),
    ).toBeNull();

    // 7. The action log, in each firm.
    const a = await eventsFor(su, A.firmId, since);
    expect(a.map((e) => [e.action, e.actor_type])).toEqual([
      ["auth.link_requested", "system"],
      ["auth.link_sent", "system"],
      ["auth.login", "worker"],
      ["auth.link_rejected", "system"],
    ]);
    expect(a[0]?.data).toEqual({ kind: "worker", matched: true });
    expect(a[2]).toMatchObject({ actor_id: A.workerId, entity_type: "session" });
    expect(a[3]?.data).toEqual({ kind: "worker", reason: "used" });
    const b = await eventsFor(su, B.firmId, since);
    expect(b.map((e) => [e.action, e.data])).toEqual([
      ["auth.link_rejected", { kind: "worker", reason: "unknown" }],
    ]);
    // No event anywhere holds the token or the number.
    for (const e of [...a, ...b]) {
      expect(JSON.stringify(e)).not.toContain(token);
      expect(JSON.stringify(e)).not.toContain(mobile.slice(3));
    }
  });
});

describe("numbers that don't belong to an active worker", () => {
  it("get the same answer, the same event and a job, but no message", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    const { transport, sent } = captureTransport();
    const time = movableClock();

    const known = await requestWorkerLoginLink(
      { firm: { id: T.firmId } },
      await mobileOf(su, T.workerId),
    );
    const knownJob = await latestLinkJob(su, T.firmId);
    const unknown = await requestWorkerLoginLink({ firm: { id: T.firmId } }, "07700 900999");
    const unknownJob = await latestLinkJob(su, T.firmId);
    expect(unknown).toEqual(known);
    expect(unknownJob?.id).not.toBe(knownJob?.id);
    expect(unknownJob?.data).toMatchObject({ subjectId: null });

    const result = await runLinkJob(unknownJob ?? { id: "", data: {} }, {
      transport,
      clock: time.clock,
    });
    expect(result).toMatchObject({
      status: "completed",
      output: { sent: false, reason: "no_subject" },
    });
    expect(sent).toHaveLength(0);

    const events = await eventsFor(su, T.firmId, since);
    expect(events.map((e) => e.data)).toEqual([
      { kind: "worker", matched: true },
      { kind: "worker", matched: false },
    ]);
  });

  it("a blocked worker's number is treated as unknown", async () => {
    const T = await createTenant(su);
    await su.query("update workers set status = 'blocked' where id = $1", [T.workerId]);
    await requestWorkerLoginLink({ firm: { id: T.firmId } }, await mobileOf(su, T.workerId));
    expect((await latestLinkJob(su, T.firmId))?.data).toMatchObject({ subjectId: null });
  });

  it("something that isn't a phone number is refused before anything is written", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    expect(await requestWorkerLoginLink({ firm: { id: T.firmId } }, "not a number")).toEqual({
      status: "invalid_number",
    });
    expect(await latestLinkJob(su, T.firmId)).toBeUndefined();
    expect(await eventsFor(su, T.firmId, since)).toEqual([]);
  });
});
