import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { page } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { ANSWERS_TITLE } from "@/lib/office/answers-copy";
import { officeNewAnswer } from "@/lib/office/answers-page";
import { AnswerForm } from "../answer-form";

export const metadata: Metadata = { title: "Add an answer" };

// Add an answer (Phase 35.3; docs/screens.md "## Phase 35", "Add and Edit"). Admins only (others:
// not found). From "Make this an answer" (`?from=` a message's or an email's id, on "No answer yet"
// and Enquiries), the ways casuals ask it start with that casual's question, read inside the firm
// (src/lib/office/answers-page.ts officeNewAnswer).
export default async function NewAnswerPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("answers");
  const { from } = await searchParams;
  const data = await officeNewAnswer(
    { firm, officeUserId: officeUser.id },
    typeof from === "string" ? from : null,
  );
  if (!data) notFound();
  return (
    <main className={page.officeForm}>
      <PageHeader
        back={{ href: "/office/settings/answers", label: ANSWERS_TITLE }}
        title="Add an answer"
      />
      <AnswerForm answer={null} example={data.example} signOff={data.signOff} />
    </main>
  );
}
