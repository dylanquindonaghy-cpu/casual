import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { officeTeam } from "@/lib/auth/office-login";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { MemberActions } from "./member-actions";

// Who has office access, their roles, and changing them (docs/screens.md `/office/team`). Admins
// only (checked here, in officeTeam() and again in every change). Nobody changes their own access
// here: another admin does.
export default async function OfficeTeamPage() {
  const { firm, officeUser } = await requireOfficeArea("team");
  const team = await officeTeam({ firm }, (await readSessionToken("office")) ?? "");
  if (!team) notFound();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Office team</h1>
      <p className="mt-2">
        Everyone who can log in to the office. Someone leaving: turn off their access. A lost laptop
        or phone: log them out on every device, and turn off their access too if their email is on
        it, until it&apos;s secure.
      </p>
      <ul className="mt-6 flex flex-col gap-4">
        {team.map((m) => (
          <li key={m.id} className="rounded-lg border border-slate-300 p-4">
            <h2 className="text-xl font-semibold">
              {m.name}
              {m.id === officeUser.id ? " (you)" : ""}
            </h2>
            <p className="break-all">{m.email}</p>
            <p>
              {ROLE_LABELS[m.role]} · {m.status === "active" ? "Can log in" : "Access off"}
            </p>
            {m.id === officeUser.id ? (
              <p className="mt-2 text-slate-600">To change your own access, ask another admin.</p>
            ) : (
              <MemberActions
                officeUserId={m.id}
                name={m.name}
                role={m.role}
                active={m.status === "active"}
              />
            )}
          </li>
        ))}
      </ul>
      <Link href="/office" className="mt-8 inline-block underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
