import type { Metadata } from "next";
import Link from "next/link";
import { btn, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { PayImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import pay records" };

// "Import pay records" (docs/screens.md `/office/pay/import`). Payroll and admins; the import checks
// the office user again inside its transaction. The header says what the file needs; the form is
// one card: choose the file, check it, then import it.
export default async function PayImportPage() {
  await requireOfficeArea("pay");
  return (
    <main className={page.officeForm}>
      <PageHeader title="Import pay records">
        <p>
          A spreadsheet from your payroll with one line per person, pay period and rate. Columns:
          Staff ID (or Mobile), Period start, Period end, Hours and Rate (needed), and Gross pay and
          Pay date if you have them.
        </p>
        <p>
          We check the file first and nothing is saved until you import it. Importing the same file
          again updates those lines instead of adding them twice. Each worker sees their own lines
          on their pay page, behind their pay code.
        </p>
      </PageHeader>
      <PayImportForm />
      <p className={sectionGap.office}>
        <Link href="/office/pay-queries" className={btn.link}>
          Back to pay queries
        </Link>
      </p>
    </main>
  );
}
