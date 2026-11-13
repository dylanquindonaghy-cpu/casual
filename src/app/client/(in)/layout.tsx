import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { requireClient } from "@/lib/client/current-client";
import { THEME_COOKIE, themeFromCookie } from "../../theme";
import { ClientFrame } from "../client-frame";

// A logged-in client's pages (Phase 36.3): their frame (./client-frame.tsx) round each, or off to
// the client login with no live session. Each page checks the session again for itself.
export default async function ClientPagesLayout({ children }: { children: ReactNode }) {
  const s = await requireClient();
  const jar = await cookies();
  return (
    <ClientFrame
      firmName={s.firm.name}
      contactName={s.contact.name}
      contractName={s.contact.contractName}
      theme={themeFromCookie(jar.get(THEME_COOKIE)?.value)}
      rotationDue={s.session.rotationDue}
    >
      {children}
    </ClientFrame>
  );
}
