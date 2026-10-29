import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInboxDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveEmail } from "@/lib/email/receive";
import { handleEmailWebhook } from "@/lib/email/webhook";
import { signedHeaders } from "@/lib/integrations/sign";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The staffing inbox's emails stored (P7.2, P7.3; src/lib/email/receive.ts), through the webhook,
// on the real database as the app role: one row per Message-ID, a known casual's own words with the
// quoted history off, nobody else's words at all, no job queued yet (P7.4). Made-up people,
// addresses and secrets only.

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

const KEY = Buffer.from("made-up-inbound-signing-key-0123456789");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

async function inboxFirm() {
  const f = await bookingFirm(su, withFirm);
  const inbox = `staffing-${randomBytes(4).toString("hex")}@inbound.example.test`;
  await su.query("update firms set inbox_address = $2 where id = $1", [f.firmId, inbox]);
  const casual = async (first: string, address: string, status = "active") => {
    const id = await f.worker({ first, status: status as "active" | "inactive" });
    await su.query("update workers set email = $2 where id = $1", [id, address]);
    return id;
  };
  let n = 0;
  const post = (o: Record<string, unknown>) => {
    n += 1;
    const body = JSON.stringify({
      message_id: `<${n}-${randomBytes(4).toString("hex")}@mail.example.test>`,
      to: [inbox],
      ...o,
    });
    return handleEmailWebhook(
      new Request("https://shiftdesk.example/api/webhooks/email", {
        method: "POST",
        headers: { ...signedHeaders(KEY, `msg_${n}`, nowSeconds, body) },
        body,
      }),
      {
        secret: `whsec_${KEY.toString("base64")}`,
        resolveFirmByInbox: createInboxDirectory(app),
        receive: (firmId, email) => receiveEmail(firmId, email, { run: withFirm }),
        now: () => NOW,
      },
    );
  };
  const rows = async () =>
    (
      await su.query(
        `select provider_message_id, worker_id::text as worker_id, from_address, to_address,
                subject, body, attachments, handled_at
           from inbound_emails where firm_id = $1 order by created_at, id`,
        [f.firmId],
      )
    ).rows;
  return { f, inbox, casual, post, rows };
}

describe("emails to the staffing inbox", () => {
  it("a known casual's: their own words kept, the quoted history and signature off, only how many attachments", async () => {
    const t = await inboxFirm();
    const ann = await t.casual("Ann", "ann.example@example.com");
    const r = await t.post({
      from: "Ann Example <Ann.Example@example.com>",
      authenticated: true,
      subject: "Re: Saturday",
      text: [
        "Yes I can do Saturday.",
        "-- ",
        "Ann",
        "",
        "On Mon, 2 Nov 2026 at 09:00, Acme Shift Team <shifts@acme.example.com> wrote:",
        "> Can you do Saturday?",
      ].join("\n"),
      attachments: [{ filename: "fit-note.pdf" }],
    });
    expect(r.status).toBe(200);
    expect(await t.rows()).toMatchObject([
      {
        worker_id: ann,
        from_address: "ann.example@example.com",
        to_address: t.inbox,
        subject: "Re: Saturday",
        body: "Yes I can do Saturday.",
        attachments: 1,
        handled_at: null,
      },
    ]);
  });

  it("anyone else's: who wrote only, never the subject or words; an inactive casual's, an address two casuals share, or one the provider couldn't vouch for, the same", async () => {
    const t = await inboxFirm();
    await t.casual("Cal", "cal.example@example.com", "inactive");
    await t.casual("Dee", "shared@example.com");
    await t.casual("Eve", "shared@example.com");
    await t.casual("Fay", "fay.example@example.com");
    for (const from of ["venue@example.com", "cal.example@example.com", "shared@example.com"]) {
      await t.post({
        from,
        authenticated: true,
        subject: "Invoice 42",
        text: "Please pay our invoice.",
      });
    }
    // A casual's address, but the provider couldn't say it was theirs (anyone can put it in).
    await t.post({
      from: "fay.example@example.com",
      subject: "Invoice 42",
      text: "Pay our invoice.",
    });
    const stored = await t.rows();
    expect(stored.map((r) => [r.from_address, r.worker_id, r.subject, r.body])).toEqual([
      ["venue@example.com", null, null, null],
      ["cal.example@example.com", null, null, null],
      ["shared@example.com", null, null, null],
      ["fay.example@example.com", null, null, null],
    ]);
    const { rows } = await su.query(
      "select count(*)::int as n from inbound_emails where firm_id = $1 and body like '%invoice%'",
      [t.f.firmId],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("the same email sent twice is stored once; to an address no firm has, nothing; no job queued yet", async () => {
    const t = await inboxFirm();
    const jobs = async () =>
      Number(
        (
          await su.query("select count(*)::int as n from pgboss.job where data ->> 'firmId' = $1", [
            t.f.firmId,
          ])
        ).rows[0]?.n,
      );
    const before = await jobs();
    const body = { message_id: "<same@mail.example.test>", from: "venue@example.com", text: "Hi" };
    await t.post(body);
    await t.post(body);
    expect((await t.rows()).length).toBe(1);
    await t.post({ from: "venue@example.com", to: "nobody@inbound.example.test", text: "Hi" });
    expect((await t.rows()).length).toBe(1);
    expect(await jobs()).toBe(before);
  });
});
