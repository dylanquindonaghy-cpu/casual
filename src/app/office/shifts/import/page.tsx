import type { Metadata } from "next";
import Link from "next/link";
import { btn, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import shifts from a file" };

// "Import from a file" (docs/screens.md `/office/shifts`). Admins and resourcers; the import
// checks the office user again inside its transaction.
export default async function ImportPage() {
  const { firm } = await requireOfficeArea("shifts");
  return (
    <main className={page.officeForm}>
      <PageHeader eyebrow={`${firm.name} office`} title="Import shifts from a file">
        <p>
          A spreadsheet with one shift per row. Columns: Date, Start, End and Role (needed), and
          Site, Needed (places), Instructions and Shift ID if you have them.
        </p>
        <p>
          We check the file first and nothing is saved until you import it. Importing the same file
          again updates those shifts instead of adding them twice. Shifts that have started, and new
          times, roles or sites for shifts people are booked on, are left alone.
        </p>
      </PageHeader>
      <ImportForm />
      <p className={sectionGap.office}>
        <Link href="/office/shifts" className={btn.link}>
          Back to shifts
        </Link>
      </p>
    </main>
  );
}
