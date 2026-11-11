import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { meta, page } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { ANSWERS_TITLE, lastEditedText, usesText } from "@/lib/office/answers-copy";
import { officeAnswer } from "@/lib/office/answers-page";
import { AnswerForm } from "../answer-form";

export const metadata: Metadata = { title: "Edit an answer" };

// Edit an answer (Phase 35.3; docs/screens.md "## Phase 35", "Add and Edit"). Admins only (others,
// and an answer that isn't this firm's: not found). Whether it's on, its uses and its last edit
// under the name; the form keeps it on or off as it is, or changes that.
export default async function EditAnswerPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, officeUser } = await requireOfficeArea("answers");
  const { id } = await params;
  const data = await officeAnswer({ firm, officeUserId: officeUser.id }, id);
  if (!data?.answer) notFound();
  const a = data.answer;
  return (
    <main className={page.officeForm}>
      <PageHeader back={{ href: "/office/settings/answers", label: ANSWERS_TITLE }} title={a.name}>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusChip tone={a.isOn ? "done" : "quiet"}>{a.isOn ? "On" : "Off"}</StatusChip>
          <span className={meta}>{usesText(a.usesLast7Days)}</span>
          <span className={meta}>{lastEditedText(a, data.timeZone)}</span>
        </p>
      </PageHeader>
      <AnswerForm
        answer={{ id: a.id, name: a.name, examples: a.examples, body: a.body, isOn: a.isOn }}
        example={null}
        signOff={data.signOff}
      />
    </main>
  );
}
