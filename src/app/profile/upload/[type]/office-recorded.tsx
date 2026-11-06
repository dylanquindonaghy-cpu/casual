import Link from "next/link";
import { staffBtn } from "@/app/ui/classes";
import { MESSAGES_PATH } from "@/lib/portal/qualification-copy";

// One the office records itself (CSAS, right to work, health or criminal record details: no
// upload), on its upload page (28.11; docs/screens.md "### 28.11"): what to do instead, and the way
// there as the page's main button, never a dead end. Hook-free.
export function OfficeRecordedNote({ name }: { name: string }) {
  return (
    <>
      <p className="mt-4">
        The office records your {name} itself. When you have a new one, message the office.
      </p>
      <Link href={MESSAGES_PATH} className={`${staffBtn.primary} mt-4`}>
        Message the office
      </Link>
    </>
  );
}
