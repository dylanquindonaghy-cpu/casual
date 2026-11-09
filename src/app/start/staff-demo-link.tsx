import Link from "next/link";
import { LOGIN_COPY } from "@/lib/demo/start-copy";
import { btn } from "../ui/classes";

// "Demo: log in with the staffing account" (Phase 31.1): on a demo server only, on the Demo phone
// and the office login page. The pages decide whether to show it (src/app/start/gate.ts
// showsStaffDemo). Hook-free.
export function StaffDemoLink({ className }: { className?: string }) {
  return (
    <p className={className}>
      <Link href="/start/login" className={btn.link}>
        {LOGIN_COPY.linkLine}
      </Link>
    </p>
  );
}
