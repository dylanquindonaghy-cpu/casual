import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seed } from "@/lib/db/admin/seed";
import { seedFirms, seedId } from "@/lib/db/admin/seed-data";
import { acmeStory, type StorySeed } from "@/lib/db/admin/seed-story";

type StoryMessage = StorySeed["messages"][number];
import { answerStoryMessages } from "@/lib/db/admin/seed-story-load";
import { withFirm } from "@/lib/db/scoped";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import type { runInboundMessage } from "@/lib/inbound/reply";
import { superuserPool, urls } from "../helpers/db";

// The seed answers the demo story's messages once each (src/lib/db/admin/seed-story-load.ts). On the
// demo server all five once stayed unanswered with nothing to say why (16 Nov 2026): one that fails
// is logged, the rest still run, the reset goes on, and any still unanswered is queued for the
// shifts line's job, the way a real text is, so the job worker answers it with its own retries.

const ACME = seedId("firm/acme");
const acmeFirm = () => {
  const firm = seedFirms().find((f) => f.slug === "acme");
  if (!firm) throw new Error("no acme");
  return firm;
};
const STORY = acmeStory(acmeFirm(), new Date());
const byBody = (text: string) => {
  const m = STORY.messages.find((x) => x.body.includes(text));
  if (!m) throw new Error(`no story message "${text}"`);
  return m;
};
// Ben's pay question and Kieran's cancel, oldest first (the order the seed tries them): the older
// fails, so the newer is only answered if a failure doesn't end the pass.
const [FIRST, SECOND] = [byBody("my pay"), byBody("cancel")].sort(
  (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id),
) as [StoryMessage, StoryMessage];
const mobileOf = (m: StoryMessage) =>
  STORY.workers.find((w) => w.key === m.workerKey)?.mobileE164 ?? "";

let su: Pool;

const jobsFor = async (messageId: string) =>
  (
    await su.query<{ data: Record<string, unknown>; singleton_key: string | null }>(
      `select data, singleton_key from pgboss.job where name = $1 and data ->> 'messageId' = $2`,
      [INBOUND_MESSAGE_QUEUE, messageId],
    )
  ).rows;

beforeAll(async () => {
  su = superuserPool();
  await seed({ adminUrl: urls.admin, appUrl: urls.app, nodeEnv: "test" });
});
afterAll(async () => {
  // As the seed left them: answered, nothing queued.
  await su.query(
    `update messages set handled_at = now() where id = any($1::uuid[]) and handled_at is null`,
    [[FIRST.id, SECOND.id]],
  );
  await su.query(`delete from pgboss.job where name = $1 and data ->> 'firmId' = $2`, [
    INBOUND_MESSAGE_QUEUE,
    ACME,
  ]);
  await su.end();
});

describe("answering the story's messages in the seed", () => {
  it("the seed answers all five itself and queues none", async () => {
    const { rows } = await su.query<{ n: number }>(
      `select count(*)::int as n from messages where id = any($1::uuid[]) and handled_at is null`,
      [STORY.messages.map((m) => m.id)],
    );
    expect(rows[0]?.n).toBe(0);
    for (const m of STORY.messages) expect(await jobsFor(m.id)).toEqual([]);
  });

  it("one that throws is logged by id and code, the next is still answered, and the one left is queued for the shifts line's job", async () => {
    await su.query(`update messages set handled_at = null where id = any($1::uuid[])`, [
      [FIRST.id, SECOND.id],
    ]);
    const errors: string[] = [];
    const lines = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map((c) => String(c[0]));
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const answered: string[] = [];
    // The first fails as the server's did; the second is answered (marked handled, as the job does).
    const answer: typeof runInboundMessage = async (payload) => {
      if (payload.messageId === FIRST.id) {
        throw Object.assign(new Error("connection terminated"), { code: "57P01" });
      }
      answered.push(payload.messageId);
      await su.query(`update messages set handled_at = now() where id = $1`, [payload.messageId]);
      return { status: "replied", intent: "cancel", handledAs: "keyword" };
    };
    let result: Awaited<ReturnType<typeof answerStoryMessages>>;
    try {
      result = await answerStoryMessages(
        withFirm,
        ACME,
        STORY,
        { baseDomain: "localhost:3000", now: new Date() },
        answer,
      );
    } finally {
      errors.push(...lines(err), ...lines(out));
      out.mockRestore();
      err.mockRestore();
    }

    // Both were tried, in the seed's one pass: Ben's failure didn't stop Kieran's.
    expect(answered).toEqual([SECOND.id]);
    expect(result).toEqual({
      answered: [{ messageId: SECOND.id, status: "replied" }],
      failed: [{ messageId: FIRST.id, code: "57P01" }],
      queued: [FIRST.id],
    });
    // Ben's is queued exactly as a real text is (src/lib/inbound/job.ts); Kieran's isn't.
    const jobs = await jobsFor(FIRST.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({
      firmId: ACME,
      messageId: FIRST.id,
      idempotencyKey: `inbound-message:${FIRST.id}`,
    });
    expect(await jobsFor(SECOND.id)).toEqual([]);

    // The log says what happened, by id and code, and never the casual's words.
    const logged = errors.join("\n");
    expect(logged).toMatch(
      /"level":"error","msg":"seed: story message not answered[^"]*".*"code":"57P01"/,
    );
    expect(logged).toContain(FIRST.id);
    expect(logged).toMatch(/"msg":"seed: story messages left to the shifts line's job".*"count":1/);
    for (const m of [FIRST, SECOND]) {
      expect(logged).not.toContain(m.body);
      expect(mobileOf(m)).toMatch(/^\+44/);
      expect(logged).not.toContain(mobileOf(m));
      expect(logged).not.toContain(mobileOf(m).slice(1));
    }
  });

  it("a second pass with nothing left to answer queues nothing more", async () => {
    await su.query(`update messages set handled_at = now() where id = any($1::uuid[])`, [
      STORY.messages.map((m) => m.id),
    ]);
    const before = (await jobsFor(FIRST.id)).length;
    const answer: typeof runInboundMessage = async () => {
      throw new Error("must not be called");
    };
    const result = await answerStoryMessages(
      withFirm,
      ACME,
      STORY,
      { baseDomain: "localhost:3000", now: new Date() },
      answer,
    );
    expect(result).toEqual({ answered: [], failed: [], queued: [] });
    expect(await jobsFor(FIRST.id)).toHaveLength(before);
  });
});
