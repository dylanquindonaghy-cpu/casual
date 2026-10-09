import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { FirmDirectoryEntry } from "../db/directory";
import { getCurrentFirm } from "../tenancy/current-firm";
import { currentOfficeUser, type OfficeSession } from "./office-login";
import { canAccess, type OfficeArea } from "./roles";
import { readSessionToken } from "./session-cookie";

// The logged-in office user for this request, looked up inside this host's firm.
export const getOfficeSession = cache(
  async (): Promise<(OfficeSession & { firm: FirmDirectoryEntry }) | null> => {
    const firm = await getCurrentFirm();
    const token = await readSessionToken("office");
    if (!token) return null;
    const found = await currentOfficeUser({ firm }, token);
    return found ? { ...found, firm } : null;
  },
);

// For pages only (they redirect; server actions must return a result instead).
export async function requireOfficeArea(
  area: OfficeArea,
): Promise<OfficeSession & { firm: FirmDirectoryEntry }> {
  const session = await getOfficeSession();
  if (!session) redirect("/office/login");
  // A role without access sees "not found", not a hint that the page exists.
  if (!canAccess(session.officeUser.role, area)) notFound();
  return session;
}
