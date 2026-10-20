import { isDemoFirm } from "./firms";

// In demo mode (16.1; ADR-025) the app knows the made-up demo firms alone: the look-ups that turn a
// request into a firm (its address, its shifts line's number, a planner's key:
// src/lib/db/directory.ts) find no other firm, so on a demo server any other firm's pages, server
// actions, route handlers, webhooks and planner calls are all not found, the same way as an address
// nobody has. (A check in a layout couldn't do it: the page under it still runs.) Without demo mode
// a look-up is as it was.
export function onlyDemoFirms<A extends unknown[], T>(
  resolve: (...args: A) => Promise<T | null>,
  firmIdOf: (found: T) => string,
  demoMode: () => string | undefined,
): (...args: A) => Promise<T | null> {
  return async (...args) => {
    const found = await resolve(...args);
    if (found === null || demoMode() !== "on" || isDemoFirm(firmIdOf(found))) return found;
    return null;
  };
}
