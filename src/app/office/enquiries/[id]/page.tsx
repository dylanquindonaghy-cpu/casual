import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { officeEnquiry } from "@/lib/office/enquiries";
import { EmailBody, EmailCasualLink, EmailFacts, emailTitle } from "../email-detail";
import {
  CasualPageLink,
  EnquiryBody,
  EnquiryFacts,
  enquiryTitle,
  MakeAnswerLink,
} from "../enquiry-detail";
import { areaMetadata } from "@/app/office/area-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return areaMetadata("enquiries", { title: "Enquiry" });
}

// One message on the shifts line, on its own page (docs/office-v2.md 3.6; docs/screens.md
// `/office/enquiries/[id]`; 12D.1): where a phone opens a message from Enquiries' list, and where
// links to one land. From 1024px, Enquiries shows the same beside its list (Phase 24, 24.4). Its
// parts are ../enquiry-detail.tsx's. Admins and resourcers.
export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, officeUser } = await requireOfficeArea("enquiries");
  const { id } = await params;
  const e = await officeEnquiry({ firm, officeUserId: officeUser.id }, id);
  if (!e) notFound();
  // Admins (the "answers" area, Phase 35.3): "Make this an answer" and an answer's Edit link.
  const admin = canAccess(officeUser.role, "answers");
  const makeAnswer = <MakeAnswerLink e={e} admin={admin} />;
  // An email to the staffing inbox (Phase 25.5): its own parts (../email-detail.tsx).
  if (e.channel === "email") {
    return (
      <main className={page.office}>
        <PageHeader
          back={{ href: "/office/enquiries", label: "Enquiries" }}
          title={emailTitle(e.who)}
          actions={
            e.who.kind === "casual" ? (
              <>
                {makeAnswer}
                <EmailCasualLink e={e} />
              </>
            ) : undefined
          }
        >
          <EmailFacts e={e} />
        </PageHeader>
        <EmailBody e={e} level={2} admin={admin} />
        <p className={sectionGap.office}>
          <Link href="/office/enquiries" className={btn.link}>
            Back to Enquiries
          </Link>
        </p>
      </main>
    );
  }
  const casual = <CasualPageLink e={e} />;
  return (
    <main className={page.office}>
      <PageHeader
        back={{ href: "/office/enquiries", label: "Enquiries" }}
        title={enquiryTitle(e)}
        actions={
          e.who.kind === "casual" ? (
            <>
              {makeAnswer}
              {casual}
            </>
          ) : undefined
        }
      >
        <EnquiryFacts e={e} />
      </PageHeader>
      <EnquiryBody e={e} level={2} admin={admin} />
      <p className={sectionGap.office}>
        <Link href="/office/enquiries" className={btn.link}>
          Back to Enquiries
        </Link>
      </p>
    </main>
  );
}
