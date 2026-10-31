import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { firmLoginWay, workerLoginWay } from "@/lib/portal/login-way";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// How a firm's login links and one casual's pay code go, as the login, help and pay pages say it
// (P2.7): read inside the firm's own transaction as the app role, with no text sender by email
// only where the firm switched login_by_email on and, for the code, holds an address for them.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

// A text sender decides it without reading the database.
const noReads: WithFirm = () => {
  throw new Error("read the database with a text sender");
};

async function withEmail(workerId: string, email: string | null) {
  await su.query("update workers set email = $1 where id = $2", [email, workerId]);
  return workerId;
}

describe("firmLoginWay", () => {
  it("by message with a text sender, by email only with the setting on, else off", async () => {
    const on = await bookingFirm(su, withFirm, { settings: { login_by_email: true } });
    const off = await bookingFirm(su, withFirm);
    expect(await firmLoginWay(on.firmId, noReads, true)).toBe("message");
    expect(await firmLoginWay(on.firmId, withFirm, false)).toBe("email");
    expect(await firmLoginWay(off.firmId, withFirm, false)).toBe("off");
  });
});

describe("workerLoginWay", () => {
  it("by email only for a casual the firm holds an address for", async () => {
    const on = await bookingFirm(su, withFirm, { settings: { login_by_email: true } });
    const held = await withEmail(await on.worker(), "sam.booker@example.com");
    const none = await withEmail(await on.worker(), null);
    expect(await workerLoginWay(on.firmId, held, withFirm, false)).toBe("email");
    expect(await workerLoginWay(on.firmId, none, withFirm, false)).toBe("off");
    expect(await workerLoginWay(on.firmId, none, noReads, true)).toBe("message");
  });

  it("off when the firm hasn't switched it on, address or not", async () => {
    const off = await bookingFirm(su, withFirm);
    const held = await withEmail(await off.worker(), "sam.booker@example.com");
    expect(await workerLoginWay(off.firmId, held, withFirm, false)).toBe("off");
  });

  it("never reads another firm's casual (tenant isolation)", async () => {
    const mine = await bookingFirm(su, withFirm, { settings: { login_by_email: true } });
    const theirs = await bookingFirm(su, withFirm, { settings: { login_by_email: true } });
    const theirWorker = await withEmail(await theirs.worker(), "someone@example.com");
    expect(await workerLoginWay(theirs.firmId, theirWorker, withFirm, false)).toBe("email");
    // Asked inside my firm, their casual's address isn't seen.
    expect(await workerLoginWay(mine.firmId, theirWorker, withFirm, false)).toBe("off");
  });
});
