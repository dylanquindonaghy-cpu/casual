import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { card, h2, headingGap, muted, page, rows, row, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { siteLocationText, strikesEmailStatus } from "@/lib/office/settings-copy";
import { officeSettingsPage } from "@/lib/office/settings-page";
import { firmShiftsLine, shiftsLineText } from "@/lib/tenancy/shifts-line";
import { SitePostcodeForm } from "./site-postcode-form";
import { StrikesEmailForm } from "./strikes-email-form";

export const metadata: Metadata = { title: "Settings" };

// Settings (docs/office-v2.md 3.10; docs/screens.md `/office/settings`; 12B.7). Admins only
// (checked here, in the loader and again in every change). The strikes team's email, the firm's
// shifts line (its number, to read: Phase 24) and the sites' postcodes. Everything else the firm
// agreed stays with the owner (`firm:settings`).
export default async function SettingsPage() {
  const { firm } = await requireOfficeArea("settings");
  const [data, line] = await Promise.all([
    officeSettingsPage({ firm }, (await readSessionToken("office")) ?? ""),
    firmShiftsLine({ firm }),
  ]);
  if (!data) notFound();
  const s = data.strikesEmail;
  return (
    <main className={page.officeForm}>
      <PageHeader title="Settings" />

      <section aria-labelledby="strikes-email">
        <h2 id="strikes-email" className={h2}>
          Strikes team email
        </h2>
        <p className={`${muted} mt-1`}>
          Where records of late cancellations go. We send a link to confirm the address first:
          nothing goes there until someone opens it.
        </p>
        <div className={`${card} ${headingGap} flex flex-col gap-4`}>
          {/* Not confirmed: waiting on someone at that address to open the link (blue, Phase 23). */}
          <p className="flex flex-wrap items-center gap-2">
            <StatusChip tone={s.confirmedAt ? "done" : s.address ? "wait" : "quiet"}>
              {s.confirmedAt ? "Confirmed" : s.address ? "Not confirmed" : "Not set"}
            </StatusChip>
            <span>{strikesEmailStatus(s, firm.timezone)}</span>
          </p>
          <StrikesEmailForm address={s.address} confirmed={s.confirmedAt !== null} />
        </div>
      </section>

      {/* The firm's own number for WhatsApp, texts and calls (Phase 24: it left the top bar). */}
      <section className={sectionGap.office} aria-labelledby="shifts-line">
        <h2 id="shifts-line" className={h2}>
          Shifts line
        </h2>
        <p className={`${card} ${headingGap} tabular-nums`}>{shiftsLineText(line)}</p>
      </section>

      <section className={sectionGap.office} aria-labelledby="sites">
        <h2 id="sites" className={h2}>
          Sites
        </h2>
        <p className={`${muted} mt-1`}>
          A site&apos;s postcode can&apos;t change while people are booked on sessions there that
          are still to come.
        </p>
        {data.sites.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>No sites yet.</p>
        ) : (
          <ul role="list" className={`${rows} ${headingGap}`}>
            {data.sites.map((site) => (
              <li key={site.siteId} className={`${row} flex flex-col gap-2`}>
                <h3 className="font-semibold">{site.name}</h3>
                {site.bookedSessions > 0 && (
                  <p className="text-sm text-ink-muted">
                    {site.bookedSessions === 1
                      ? "1 booked session to come."
                      : `${site.bookedSessions} booked sessions to come.`}
                  </p>
                )}
                <p className="text-sm text-ink-muted">{siteLocationText(site)}</p>
                <SitePostcodeForm siteId={site.siteId} name={site.name} postcode={site.postcode} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
