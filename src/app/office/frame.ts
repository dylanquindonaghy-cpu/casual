import { cache } from "react";
import { getOfficeSession } from "@/lib/auth/current-office";
import { loadOfficeFrame } from "@/lib/office/frame";

// The office frame for this request (Phase 25.3): the layout's counts, read once in one
// transaction (src/lib/office/frame.ts). React's cache keeps it for the rest of the request, so
// Needs attention's page uses the same reading rather than working it out again. Null when no one
// is logged in.
export const officeFrame = cache(async () => {
  const s = await getOfficeSession();
  if (!s) return null;
  return {
    session: s,
    frame: await loadOfficeFrame({ firm: s.firm, officeUserId: s.officeUser.id }),
  };
});
