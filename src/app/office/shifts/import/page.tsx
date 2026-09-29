import Link from "next/link";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { ImportForm } from "./import-form";

// "Import from a file" (docs/screens.md `/office/shifts`). Admins and resourcers; the import
// checks the office user again inside its transaction.
export default async function ImportPage() {
  const { firm } = await requireOfficeArea("shifts");
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Import shifts from a file</h1>
      <p className="mt-3">
        A spreadsheet with one shift per row. Columns: Date, Start, End and Role (needed), and Site,
        Needed (places), Instructions and Shift ID if you have them.
      </p>
      <p className="mt-2">
        We check the file first and nothing is saved until you import it. Importing the same file
        again updates those shifts instead of adding them twice. Shifts that have started, and new
        times, roles or sites for shifts people are booked on, are left alone.
      </p>
      <ImportForm />
      <Link href="/office/shifts" className="mt-8 inline-block underline">
        Back to shifts
      </Link>
    </main>
  );
}
