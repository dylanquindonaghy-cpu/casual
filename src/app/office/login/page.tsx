import { redirect } from "next/navigation";
import { getOfficeSession } from "@/lib/auth/current-office";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { OfficeLoginForm } from "./office-login-form";

export default async function OfficeLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ out?: string }>;
}) {
  const firm = await getCurrentFirm();
  if (await getOfficeSession()) redirect("/office");
  const { out } = await searchParams;
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">Office login for {firm.name}</h1>
      {out === "1" && (
        <p role="status" className="mt-4 rounded-xl bg-slate-100 p-4">
          You&apos;re logged out.
        </p>
      )}
      <OfficeLoginForm firmName={firm.name} signOff={firm.signOff} />
    </main>
  );
}
