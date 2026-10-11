import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { card, h2, headingGap, meta, muted, page, sectionGap, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { integrationsPage } from "@/lib/office/integrations";
import {
  keyCreatedText,
  keyHintText,
  keyLastUsedText,
  PLANNER_GUIDE_HREF,
  plannerLine,
} from "@/lib/office/integrations-copy";
import { roleLabel } from "@/lib/portal/format";
import { ApiKeyTable, CreateKeyForm } from "./key-forms";

export const metadata: Metadata = { title: "Integrations" };

// Integrations (docs/office-v2.md 5.3.4; docs/screens.md `/office/settings/integrations`; 12J.1).
// Admins only (others: not found; checked here, in the loader and again in every change). How the
// planner is connected, its API keys (a new key is shown once, in the create answer: never on this
// page) and the codes it may send. The webhook section comes with 12J.2.
export default async function IntegrationsPage() {
  const { firm, officeUser } = await requireOfficeArea("integrations");
  const data = await integrationsPage({ firm, officeUserId: officeUser.id });
  if (!data) notFound();
  const tz = firm.timezone;
  return (
    <main className={page.office}>
      <PageHeader eyebrow={`${firm.name} office`} title="Integrations">
        <p>Connect your planner, so it can send its sessions to ShiftDesk.</p>
      </PageHeader>

      <section aria-labelledby="planner">
        <h2 id="planner" className={h2}>
          Your planner
        </h2>
        <p className={`${card} ${headingGap} max-w-2xl`}>
          {plannerLine(data.planner, data.now, tz)}
          {data.planner.kind === "none" && (
            <>
              {" "}
              <Link href={PLANNER_GUIDE_HREF} className={`font-semibold ${textLink}`}>
                How to connect your planner
              </Link>
            </>
          )}
        </p>
      </section>

      <section className={sectionGap.office} aria-labelledby="keys">
        <h2 id="keys" className={h2}>
          API keys
        </h2>
        <p className={`${muted} mt-1 max-w-prose`}>
          A key lets your planner send sessions and read bookings and cancellations. Keep it secret,
          like a password.
        </p>
        <div className={`${card} ${headingGap} max-w-2xl`}>
          <CreateKeyForm />
        </div>
        <div className="mt-6">
          <ApiKeyTable
            keys={data.keys.map((k) => ({
              id: k.id,
              label: k.label,
              key: keyHintText(k.hint),
              created: keyCreatedText(k, tz),
              lastUsed: keyLastUsedText(k, data.now, tz),
            }))}
          />
        </div>
      </section>

      <section className={sectionGap.office} aria-labelledby="codes">
        <h2 id="codes" className={h2}>
          Codes your planner can use
        </h2>
        <p className={`${muted} mt-1 max-w-prose`}>
          Send a role code as a session&apos;s role, and qualification codes as its requirements.
        </p>
        <div className={`${headingGap} flex max-w-2xl flex-col gap-3`}>
          <details className={card}>
            <summary className="cursor-pointer font-semibold">
              Role codes ({data.roles.length})
            </summary>
            {data.roles.length === 0 ? (
              <p className={`${meta} mt-2`}>No roles yet.</p>
            ) : (
              <ul role="list" className="mt-2 flex flex-col gap-1">
                {data.roles.map((role) => (
                  <li key={role} className="break-words">
                    <code className="font-mono">{role}</code>{" "}
                    <span className={meta}>{roleLabel(role)}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <details className={card}>
            <summary className="cursor-pointer font-semibold">
              Qualification codes ({data.qualifications.length})
            </summary>
            {data.qualifications.length === 0 ? (
              <p className={`${meta} mt-2`}>No qualifications yet.</p>
            ) : (
              <ul role="list" className="mt-2 flex flex-col gap-1">
                {data.qualifications.map((q) => (
                  <li key={q.code} className="break-words">
                    <code className="font-mono">{q.code}</code>{" "}
                    <span className={meta}>{q.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      </section>
    </main>
  );
}
