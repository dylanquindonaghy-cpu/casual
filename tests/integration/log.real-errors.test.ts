import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withFirm } from "@/lib/db/scoped";
import { createLogger } from "@/lib/log";
import { defineFirmJob, firmJobEnvelope, runFirmJob } from "@/lib/jobs/firm-job";
import { superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Real errors from Postgres and drizzle carry personal data in their detail and message (drizzle
// puts every query parameter in the message). Logging them must not leak it.

let su: Pool;
let A: Tenant;

beforeAll(async () => {
  su = superuserPool();
  A = await createTenant(su);
});
afterAll(async () => {
  await su.end();
});

function capture() {
  const raw: string[] = [];
  return { raw, logger: createLogger({ write: (line) => raw.push(line) }) };
}

describe("logging real database errors", () => {
  it("a Postgres unique violation seen by the superuser (detail shows the number) logs no number", async () => {
    const mobile = await su
      .query<{ m: string }>("select mobile_e164 as m from workers where id = $1", [A.workerId])
      .then((r) => r.rows[0]?.m ?? "");
    const err = await su
      .query(
        "insert into workers (firm_id, first_name, last_name, mobile_e164) values ($1, 'Dup', 'Licate', $2)",
        [A.firmId, mobile],
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(JSON.stringify(err)).toContain(mobile.slice(3)); // the raw error does leak it
    const { raw, logger } = capture();
    logger.error("insert failed", { error: err });
    expect(raw).toHaveLength(1);
    expect(raw[0]).not.toContain(mobile.slice(3));
    expect(raw[0]).toContain('"code":"23505"');
  });

  it("a drizzle query error (SQL and parameters in its message) logs neither", async () => {
    const err = await withFirm(A.firmId, (tx) =>
      tx.execute(
        sql`insert into workers (firm_id, first_name, last_name, mobile_e164)
            values (${A.firmId}, ${"Priya"}, ${"Secretname"}, ${"not-a-phone"})`,
      ),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String((err as Error).message)).toContain("Secretname"); // the raw error does leak it
    const { raw, logger } = capture();
    logger.error("insert failed", { error: err });
    expect(raw[0]).not.toContain("Secretname");
    expect(raw[0]).not.toContain("Priya");
    expect(raw[0]).toContain("Failed query (details withheld)");
    expect(raw[0]).toContain('"code":"23514"'); // the check constraint, from the cause
  });

  it("Postgres quoting bad input back (22P02) logs no input", async () => {
    const err = await withFirm(A.firmId, (tx) =>
      tx.execute(sql`select * from workers where id = ${"Priya Secretname"}`),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).toContain("Priya"); // raw leaks
    const { raw, logger } = capture();
    logger.error("lookup failed", { error: err });
    expect(raw[0]).toContain('"code":"22P02"');
    for (const leak of ["Priya", "Secretname"]) expect(raw[0]).not.toContain(leak);
  });

  it("a failing firm job logs its queue, job id, firm and code, and nothing personal", async () => {
    const failing = defineFirmJob({
      queue: "test-log-failure",
      schema: firmJobEnvelope,
      handler: (_payload, tx) =>
        tx.execute(
          sql`insert into workers (firm_id, first_name, last_name, mobile_e164)
              values (${A.firmId}, ${"Priya"}, ${"Secretname"}, ${"+447700900999"}),
                     (${A.firmId}, ${"Priya"}, ${"Secretname"}, ${"+447700900999"})`,
        ),
    });
    const { raw, logger } = capture();
    const result = await runFirmJob(
      failing,
      { id: "job-1", data: { firmId: A.firmId, idempotencyKey: "k" } },
      withFirm,
      logger,
    );
    expect(result.status).toBe("failed");
    expect(raw).toHaveLength(1);
    const line = JSON.parse(raw[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({
      level: "error",
      msg: "job failed",
      queue: "test-log-failure",
      jobId: "job-1",
      firmId: A.firmId,
      code: "23505",
    });
    for (const leak of ["Priya", "Secretname", "7700900"]) expect(raw[0]).not.toContain(leak);
  });
});
