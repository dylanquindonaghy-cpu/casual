import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withFirm } from "@/lib/db/scoped";
import { recordEvent } from "@/lib/events/record";
import { eventMark } from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// The action log is kept for a year and shown to firms, so recordEvent refuses any data the log
// masker would change: phone numbers, email addresses, and fields named like secrets or
// personal data. Nothing is written when it refuses.

let su: Pool;
let T: Tenant;
beforeAll(async () => {
  su = superuserPool();
  T = await createTenant(su);
});
afterAll(async () => {
  await su.end();
});

const write = (data: Record<string, unknown>) =>
  withFirm(T.firmId, (tx) =>
    recordEvent(tx, { actorType: "system", action: "test.guard", entityType: "test", data }),
  );

async function rowsSince(mark: number) {
  const { rows } = await su.query<{ data: Record<string, unknown> }>(
    "select data from events where firm_id = $1 and id > $2 and action = 'test.guard' order by id",
    [T.firmId, mark],
  );
  return rows.map((r) => r.data);
}

describe("recordEvent refuses personal and secret data", () => {
  it.each([
    ["an E.164 number", { note: "+447700900123" }],
    ["a number as typed", { note: "07700 900123" }],
    ["a number with brackets", { note: "+44 (0)7700 900123" }],
    ["a number with 00 and hyphens", { note: "0044-7700-900123" }],
    ["a number glued to text", { note: "Mob07700900123" }],
    ["a number nested in an array", { changes: [{ from: "x", to: "07700900123" }] }],
    ["an email address", { note: "someone@example.com" }],
    ["an email address in a nested object", { who: { contact: "a.b@mail.firm.example" } }],
    ["an ip field", { ip: "203.0.113.9" }],
    ["a clientIp field", { clientIp: "10.0.0.1" }],
    ["a token field", { token: "abc" }],
    ["a sessionToken field", { sessionToken: "abc" }],
    ["a 6-digit code field", { code: "123456" }],
    ["an otp field", { otp: "1" }],
    ["a mobile field, whatever its value", { mobile: "n/a" }],
    ["a name field", { name: "Priya" }],
  ])("%s", async (_label, data) => {
    const mark = await eventMark(su);
    await expect(write(data)).rejects.toThrow(/holds personal or secret data/);
    expect(await rowsSince(mark)).toEqual([]);
  });

  it("control: ids, reasons, flags, counts and limit names are written as given", async () => {
    const data = {
      kind: "worker",
      reason: "used",
      matched: false,
      magicLinkId: randomUUID(),
      attemptsLeft: 4,
      limit: "login:ip",
      purpose: "worker_login",
      channel: "whatsapp",
      providerMessageId: "capture-1",
      code: "23505", // a Postgres error code is not an OTP
      at: "2026-10-01T09:00:00.000Z",
    };
    const mark = await eventMark(su);
    await write(data);
    expect(await rowsSince(mark)).toEqual([data]);
  });
});
