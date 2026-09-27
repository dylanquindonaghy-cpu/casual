import { PgBoss } from "pg-boss";

export function createBoss(connectionString: string): PgBoss {
  const boss = new PgBoss({ connectionString });
  boss.on("error", (err) => console.error("[worker] pg-boss error", err));
  return boss;
}
