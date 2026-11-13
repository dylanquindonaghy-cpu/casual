import { redirect } from "next/navigation";
import { cache } from "react";
import { readSessionToken } from "../auth/session-cookie";
import type { FirmDirectoryEntry } from "../db/directory";
import { getCurrentFirm } from "../tenancy/current-firm";
import { currentClient, type ClientSession } from "./login";

// The logged-in client contact for this request (Phase 36.3), looked up inside this host's firm
// from the client cookie (__Host-sd_client). Pages use requireClient(); server actions use
// getClientSession() and return a result (only pages redirect). The contract always comes from
// the session, never from the request: every client read and request takes it from here.
export const CLIENT_LOGIN_PAGE = "/client/login";

export const getClientSession = cache(
  async (): Promise<(ClientSession & { firm: FirmDirectoryEntry }) | null> => {
    const firm = await getCurrentFirm();
    const token = await readSessionToken("client");
    if (!token) return null;
    const found = await currentClient({ firm }, token);
    return found ? { ...found, firm } : null;
  },
);

// For pages only: the session, or off to the client login.
export async function requireClient(): Promise<ClientSession & { firm: FirmDirectoryEntry }> {
  const session = await getClientSession();
  if (!session) redirect(CLIENT_LOGIN_PAGE);
  return session;
}
