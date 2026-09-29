import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { FirmDirectoryEntry } from "../db/directory";
import { withFirm, type FirmTx } from "../db/scoped";
import { appEnv } from "../env";
import { firmForHost } from "./firm";

// The firm for the current request (ADR-012). Every page, server action and route handler that
// touches firm data goes through here (a check in a layout doesn't stop the page from
// rendering). Unknown or non-firm hosts get the 404 page. cache() makes it one lookup per page
// render; server actions don't share that cache, so call it once per action.
export const getCurrentFirm = cache(async (): Promise<FirmDirectoryEntry> => {
  const firm = await findCurrentFirm();
  if (!firm) notFound();
  return firm;
});

// The same, or null on a host that isn't a firm's (the platform's own address): for the root
// layout, which draws every page, a firm's or not.
export const findCurrentFirm = cache(async (): Promise<FirmDirectoryEntry | null> =>
  firmForHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN),
);

// The only way pages and actions reach firm data: the firm comes from this request's host, never
// from input. ESLint stops src/app from calling withFirm() with a firm id of its own choosing.
export async function withCurrentFirm<T>(
  fn: (tx: FirmTx, firm: FirmDirectoryEntry) => Promise<T>,
): Promise<T> {
  const firm = await getCurrentFirm();
  return withFirm(firm.id, (tx) => fn(tx, firm));
}
