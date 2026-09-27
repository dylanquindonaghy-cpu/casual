import { redirect } from "next/navigation";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ out?: string }>;
}) {
  const firm = await getCurrentFirm();
  if (await getWorkerSession()) redirect("/");
  const { out } = await searchParams;
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">Log in to {firm.name}</h1>
      {out === "1" && (
        <p role="status" className="mt-4 rounded-xl bg-slate-100 p-4">
          You&apos;re logged out.
        </p>
      )}
      <LoginForm firmName={firm.name} signOff={firm.signOff} />
    </main>
  );
}
