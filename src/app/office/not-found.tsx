import Link from "next/link";
import { btn, page } from "../ui/classes";
import { PageHeader } from "../ui/page-header";

// An office page that isn't there, or isn't for this role (requireOfficeArea answers "not found"
// rather than hinting a page exists). It keeps the office menu, and leads back to the office, not
// to the staff app. Plain words instead of "404". Addresses that match no page at all still get
// the site-wide page (src/app/not-found.tsx).
export default function OfficeNotFound() {
  return (
    <main className={page.officeForm}>
      <PageHeader title="We can't find that page.">
        <p>The link may be old or mistyped.</p>
      </PageHeader>
      <Link href="/office" className={btn.primary}>
        Back to the office
      </Link>
    </main>
  );
}
