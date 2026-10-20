import type { ListFirmIds } from "../db/directory";
import { isDemoFirm } from "./firms";

// Demo mode prints every message into the outbox instead of sending it (ADR-025): fine for the
// made-up demo firms and their made-up people, never for a real firm or a real person, who would
// then get nothing (and whose messages would be shown on the Demo phone). So with DEMO_MODE=on the
// worker checks, before it starts any job, that every firm in the database is a demo firm and
// that everyone in them has a made-up number and email (src/lib/demo/made-up.ts), and again every
// minute while it runs: a firm added later (e.g. by `firm:create`) or a visitor's import of real
// staff stops it. A check that can't run three times in a row stops it too: it never runs
// unchecked. Nobody is named here: counts only.
export class NotADemoServer extends Error {
  constructor(reason: string) {
    super(
      `demo mode refuses to run: ${reason} (DEMO_MODE=on is only for a demo server of made-up firms and people)`,
    );
    this.name = "NotADemoServer";
  }
}

export interface DemoServerChecks {
  listFirmIds: ListFirmIds;
  // How many people in this firm have a number or email that isn't made up.
  realPeople: (firmId: string) => Promise<number>;
}

export async function assertDemoServer(checks: DemoServerChecks): Promise<void> {
  const ids = await checks.listFirmIds();
  const others = ids.filter((id) => !isDemoFirm(id)).length;
  if (others > 0) {
    throw new NotADemoServer(
      `${others} firm${others === 1 ? " isn't" : "s aren't"} one of the made-up demo firms`,
    );
  }
  let real = 0;
  for (const id of ids) real += await checks.realPeople(id);
  if (real > 0) {
    throw new NotADemoServer(
      `${real} ${real === 1 ? "person" : "people"} in the demo firms ${real === 1 ? "has" : "have"} a number or email that isn't made up`,
    );
  }
}

// The check every minute. A failed check calls `stop`; one that couldn't run (the database away
// for a moment) calls `missed` and tries again next time, and the third in a row calls `stop`.
// Returns the function that ends the watch.
export function watchDemoServer(
  checks: DemoServerChecks,
  on: { stop: (err: NotADemoServer) => void; missed: (err: unknown) => void },
  everyMs = 60_000,
  maxMissed = 3,
): () => void {
  let missedInARow = 0;
  const timer = setInterval(() => {
    assertDemoServer(checks).then(
      () => {
        missedInARow = 0;
      },
      (err: unknown) => {
        if (err instanceof NotADemoServer) return on.stop(err);
        missedInARow += 1;
        on.missed(err);
        if (missedInARow >= maxMissed) {
          on.stop(new NotADemoServer(`its checks couldn't run ${maxMissed} times in a row`));
        }
      },
    );
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
