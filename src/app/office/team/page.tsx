import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, muted, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { officeTeam } from "@/lib/auth/office-login";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { MemberActions } from "./member-actions";

export const metadata: Metadata = { title: "Office team" };

// Who has office access, their roles, and changing them (docs/screens.md `/office/team`). Admins
// only (checked here, in officeTeam() and again in every change). Nobody changes their own access
// here: another admin does.
// Layout: one card per person: their name and email, then "{Role} · Can log in" (or "Access off")
// with the access as a chip (the line's words stay together in one element), then the actions.
export default async function OfficeTeamPage() {
  const { firm, officeUser } = await requireOfficeArea("team");
  const team = await officeTeam({ firm }, (await readSessionToken("office")) ?? "");
  if (!team) notFound();
  return (
    <main className={page.officeForm}>
      <PageHeader eyebrow={`${firm.name} office`} title="Office team">
        <p>
          Everyone who can log in to the office. Someone leaving: turn off their access. A lost
          laptop or phone: log them out on every device, and turn off their access too if their
          email is on it, until it&apos;s secure.
        </p>
      </PageHeader>
      <ul role="list" className="flex flex-col gap-4">
        {team.map((m) => (
          <li key={m.id} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-ink">
                  {m.name}
                  {m.id === officeUser.id ? " (you)" : ""}
                </h2>
                <p className={`break-all ${muted}`}>{m.email}</p>
              </div>
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold">{ROLE_LABELS[m.role]}</span> ·{" "}
                {m.status === "active" ? (
                  <StatusChip tone="done">Can log in</StatusChip>
                ) : (
                  <StatusChip tone="quiet">Access off</StatusChip>
                )}
              </p>
            </div>
            {m.id === officeUser.id ? (
              <p className={`mt-4 border-t border-line pt-4 ${muted}`}>
                To change your own access, ask another admin.
              </p>
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
      <p className={sectionGap.office}>
        <Link href="/office" className={btn.link}>
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}
