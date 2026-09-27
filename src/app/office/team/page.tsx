import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { officeTeam } from "@/lib/auth/office-login";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";

// Who has office access, and their roles. Admins only (checked here and in officeTeam()).
export default async function OfficeTeamPage() {
  const { firm } = await requireOfficeArea("team");
  const team = await officeTeam({ firm }, (await readSessionToken("office")) ?? "");
  if (!team) notFound();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Office team</h1>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.email} className="border-t">
                <td className="py-2 pr-4">{m.name}</td>
                <td className="py-2 pr-4">{m.email}</td>
                <td className="py-2 pr-4">{ROLE_LABELS[m.role]}</td>
                <td className="py-2">{m.status === "active" ? "Active" : "Disabled"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link href="/office" className="mt-8 inline-block underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
