import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInboxDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { emailAddress } from "@/lib/email/address";
import { collectWorkerData } from "@/lib/gdpr/worker-export";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { setInbox } from "../../scripts/inbox-owner";

// A firm's staffing inbox (P7.1): its address (firms.inbox_address), finding the firm for an
// incoming email's address, setting it, and the emails' table (inbound_emails): words only from a
// known casual, one row per Message-ID, and a casual's export, erasure and the retention purge
// taking theirs. On the real database; the look-up and the reads as the app role. Made-up people
// and addresses (example.com, example.test) only.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const fresh = (what = "staffing") =>
  `${what}-${randomBytes(4).toString("hex")}@inbound.example.test`;
const messageId = () => `<${randomBytes(8).toString("hex")}@mail.example.test>`;

async function inboxFirm() {
  const f = await bookingFirm(su, withFirm);
  const { rows } = await su.query<{ slug: string; name: string }>(
    "select slug, name from firms where id = $1",
    [f.firmId],
  );
  return { f, slug: rows[0]?.slug ?? "", name: rows[0]?.name ?? "" };
}

async function email(
  firmId: string,
  o: { workerId?: string | null; from: string; body?: string | null; daysAgo?: number },
) {
  const { rows } = await su.query<{ id: string }>(
    `insert into inbound_emails (firm_id, provider_message_id, worker_id, from_address, to_address,
                                 subject, body, created_at)
     values ($1, $2, $3, $4, 'staffing@inbound.example.test', $5, $5,
             now() - make_interval(days => $6))
     returning id::text as id`,
    [firmId, messageId(), o.workerId ?? null, o.from, o.body ?? null, o.daysAgo ?? 0],
  );
  return rows[0]?.id ?? "";
}

const emailIds = async (firmId: string) =>
  (
    await su.query<{ id: string }>(
      "select id::text as id from inbound_emails where firm_id = $1 order by created_at, id",
      [firmId],
    )
  ).rows.map((r) => r.id);

describe("an email address as the inbox keeps it", () => {
  it("trimmed and lower case, a display name read for its address, anything else none", () => {
    expect(emailAddress("  Staffing@Inbound.Example.TEST ")).toBe("staffing@inbound.example.test");
    expect(emailAddress("Ann Example <Ann.Example@example.com>")).toBe("ann.example@example.com");
    for (const bad of ["", "not an address", "ann@", "@example.com", "ann@example", null]) {
      expect(emailAddress(bad)).toBeNull();
    }
    expect(emailAddress(`${"a".repeat(65)}@example.com`)).toBeNull();
  });
});

describe("the firm's inbox", () => {
  it("is a lower-case address, and one address belongs to one firm", async () => {
    const a = await inboxFirm();
    const b = await inboxFirm();
    const address = fresh();
    await su.query("update firms set inbox_address = $2 where id = $1", [a.f.firmId, address]);
    await expect(
      su.query("update firms set inbox_address = $2 where id = $1", [b.f.firmId, address]),
    ).rejects.toThrow(/firms_inbox_address_unique/);
    await expect(
      su.query("update firms set inbox_address = $2 where id = $1", [
        b.f.firmId,
        address.toUpperCase(),
      ]),
    ).rejects.toThrow(/firms_inbox_address_format/);
  });

  it("finds the firm for an incoming email's address, and only that one", async () => {
    const t = await inboxFirm();
    const address = fresh();
    await su.query("update firms set inbox_address = $2 where id = $1", [t.f.firmId, address]);
    const find = createInboxDirectory(app);
    expect(await find(address)).toMatchObject({ id: t.f.firmId, slug: t.slug, name: t.name });
    expect(await find(fresh())).toBeNull();
    // The caller passes it checked and lower case: anything else isn't asked.
    expect(await find(address.toUpperCase())).toBeNull();
    expect(await find("not an address")).toBeNull();
  });

  it("is set, replaced and cleared only by the owner's command, each logged without the address", async () => {
    const t = await inboxFirm();
    const other = await inboxFirm();
    const first = fresh();
    const second = fresh();
    expect(await setInbox(urls.admin, t.slug, ` ${first.toUpperCase()} `)).toEqual({
      status: "set",
      address: first,
      before: null,
    });
    expect(await setInbox(urls.admin, t.slug, first)).toEqual({ status: "unchanged" });
    expect(await setInbox(urls.admin, t.slug, second)).toEqual({
      status: "has_other",
      before: first,
    });
    expect(await setInbox(urls.admin, t.slug, second, { replace: true })).toEqual({
      status: "set",
      address: second,
      before: first,
    });
    expect(await setInbox(urls.admin, other.slug, second)).toEqual({ status: "taken" });
    expect(await setInbox(urls.admin, other.slug, "not an address")).toEqual({
      status: "bad_address",
    });
    expect(await setInbox(urls.admin, "no-such-firm-zz", fresh())).toEqual({ status: "no_firm" });
    expect(await setInbox(urls.admin, t.slug, null)).toEqual({ status: "cleared", before: second });
    const { rows } = await su.query<{ action: string; data: Record<string, unknown> }>(
      "select action, data from events where firm_id = $1 and entity_type = 'firm' order by id",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      { action: "firm.settings_changed", data: { keys: ["inbox_address"], change: "set" } },
      { action: "firm.settings_changed", data: { keys: ["inbox_address"], change: "replaced" } },
      { action: "firm.settings_changed", data: { keys: ["inbox_address"], change: "cleared" } },
    ]);
    // Nothing logged for the refused ones, at the other firm either.
    const { rows: theirs } = await su.query(
      "select count(*)::int as n from events where firm_id = $1 and entity_type = 'firm'",
      [other.f.firmId],
    );
    expect(theirs[0]?.n).toBe(0);
  });
});

describe("the inbox's emails", () => {
  it("keep words only from a known casual, and one row per Message-ID in a firm", async () => {
    const t = await inboxFirm();
    const other = await inboxFirm();
    await expect(
      su.query(
        `insert into inbound_emails (firm_id, provider_message_id, from_address, to_address, body)
         values ($1, $2, 'stranger@example.com', 'staffing@inbound.example.test', 'Hello')`,
        [t.f.firmId, messageId()],
      ),
    ).rejects.toThrow(/inbound_emails_words_known_only/);
    const id = messageId();
    const insert = (firmId: string) =>
      su.query(
        `insert into inbound_emails (firm_id, provider_message_id, from_address, to_address)
         values ($1, $2, 'stranger@example.com', 'staffing@inbound.example.test')`,
        [firmId, id],
      );
    await insert(t.f.firmId);
    await expect(insert(t.f.firmId)).rejects.toThrow(
      /inbound_emails_firm_id_provider_message_id_key/,
    );
    // Another firm's mailbox may forward the same email: its own row.
    await insert(other.f.firmId);
  });

  it("a casual's export and erasure take theirs: set to them, and from their address before it was known", async () => {
    const t = await inboxFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const ben = await t.f.worker({ first: "Ben" });
    await su.query("update workers set email = 'ann.example@example.com' where id = $1", [ann]);
    await su.query("update workers set email = 'ben.example@example.com' where id = $1", [ben]);
    const known = await email(t.f.firmId, {
      workerId: ann,
      from: "ann.example@example.com",
      body: "Can I swap Saturday?",
    });
    const before = await email(t.f.firmId, { from: "ann.example@example.com" });
    const bens = await email(t.f.firmId, { workerId: ben, from: "ben.example@example.com" });
    const stranger = await email(t.f.firmId, { from: "stranger@example.com" });

    const data = await withFirm(t.f.firmId, (tx) => collectWorkerData(tx, ann, NOW));
    const emails = (data?.sections.emails ?? []) as { id: string; body: string | null }[];
    expect(emails.map((e) => e.id).sort()).toEqual([known, before].sort());
    expect(emails.find((e) => e.id === known)?.body).toBe("Can I swap Saturday?");

    await withFirm(t.f.firmId, (tx) => tx.execute(sql`select app_erase_worker(${ann})`));
    expect((await emailIds(t.f.firmId)).sort()).toEqual([bens, stranger].sort());
  });

  it("go at the firm's message retention age, with its messages", async () => {
    const t = await inboxFirm();
    const old = await email(t.f.firmId, { from: "stranger@example.com", daysAgo: 91 });
    const recent = await email(t.f.firmId, { from: "stranger@example.com", daysAgo: 89 });
    expect(old).not.toBe("");
    await withFirm(t.f.firmId, (tx) => tx.execute(sql`select app_purge_old_messages()`));
    expect(await emailIds(t.f.firmId)).toEqual([recent]);
  });
});
