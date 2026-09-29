import Link from "next/link";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { PayImportForm } from "./import-form";

// "Import pay records" (docs/screens.md `/office/pay/import`). Payroll and admins; the import checks
// the office user again inside its transaction.
export default async function PayImportPage() {
  const { firm } = await requireOfficeArea("pay");
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Import pay records</h1>
      <p className="mt-3">
        A spreadsheet from your payroll with one line per person, pay period and rate. Columns:
        Staff ID (or Mobile), Period start, Period end, Hours and Rate (needed), and Gross pay and
        Pay date if you have them.
      </p>
      <p className="mt-2">
        We check the file first and nothing is saved until you import it. Importing the same file
        again updates those lines instead of adding them twice. Each worker sees their own lines on
        their pay page, behind their pay code.
      </p>
      <PayImportForm />
      <Link href="/office/pay-queries" className="mt-8 inline-block underline">
        Back to pay queries
      </Link>
    </main>
  );
}
