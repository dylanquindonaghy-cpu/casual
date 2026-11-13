import type { Metadata } from "next";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess, type OfficeArea } from "@/lib/auth/roles";

// A gated office page's tab title (Phase 37.6, w1-08). A page this role can't open shows the
// office's not-found (requireOfficeArea), and its tab must not give the page away: it reads
// "Page not found", never the page's own name. Display only: it never throws, redirects or changes
// the status (access is still decided by requireOfficeArea in the page). With no session, or when
// the session can't be read, the page keeps its own title (the page itself then sends you to log
// in, or shows the error page). getOfficeSession is cached for the request, so the page's own
// check reads nothing more.
export const PAGE_NOT_FOUND_TITLE = "Page not found";

export async function areaMetadata(area: OfficeArea, metadata: Metadata): Promise<Metadata> {
  try {
    const session = await getOfficeSession();
    if (session && !canAccess(session.officeUser.role, area)) {
      return { title: PAGE_NOT_FOUND_TITLE };
    }
  } catch {
    // Display only: the page's own check decides what happens.
  }
  return metadata;
}
