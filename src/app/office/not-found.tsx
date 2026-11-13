import type { Metadata } from "next";
import Link from "next/link";
import { btn, page } from "../ui/classes";
import { PageHeader } from "../ui/page-header";

// An office page that isn't there, or isn't for this role (requireOfficeArea answers "not found"
// rather than hinting a page exists). It keeps the office menu, and leads back to the office, not
// to the staff app. Plain words instead of "404". Since Phase 37.6 every /office address that
// matches no page comes here too (src/app/office/[...missing]), and the tab reads "Page not found"
// (a refused page's own title gives way to it: src/app/office/area-metadata.ts). It isn't live
// data, so it says no "Updated" time.
export const metadata: Metadata = { title: "Page not found" };

export default function OfficeNotFound() {
  return (
    <main className={page.officeForm}>
      <PageHeader title="We can't find that page." stamp={false}>
        <p>The link may be old or mistyped.</p>
      </PageHeader>
      <Link href="/office" className={btn.primary}>
        Back to the office
      </Link>
    </main>
  );
}
