import { AsyncLocalStorage } from "node:async_hooks";

// Which firm the job running now is for. Every firm job and firm task runs inside runAsFirm
// (src/lib/jobs/firm-job.ts), so code deep inside it can say which firm it's working for without
// each caller passing it down: the console transport stamps each line of the demo's outbox with
// it, and each firm's Demo phone shows only lines stamped with its own id (16.1; ADR-025). A
// number can belong to a casual in two firms, so who a message went to can't say which firm sent
// it. Outside a job (nothing sends there) there is no firm.
const current = new AsyncLocalStorage<string>();

export const runAsFirm = <T>(firmId: string, fn: () => Promise<T>): Promise<T> =>
  current.run(firmId, fn);

export const jobFirmId = (): string | undefined => current.getStore();
