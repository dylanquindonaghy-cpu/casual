import type { ReactNode } from "react";

// A reference or an ID ("0695DD8C") in Geist Mono (round 8, sys-6), so 0 and O, 1 and l differ
// when someone reads it out on the phone. Words and figures stay in Geist. Hook-free: safe in
// server and client components.
export function Ref({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>;
}
