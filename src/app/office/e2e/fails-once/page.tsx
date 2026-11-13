import { notFound } from "next/navigation";
import { firstTime, isTestId, PAGE_FAILS_ON_PURPOSE, testPagesOn } from "@/lib/e2e/fails-once";

// The office's twin of src/app/e2e/fails-once (browser tests only; Phase 37.6): "not found" unless
// E2E_TEST_PAGES=on. The first time it's opened with a given ?id= it fails, inside the office
// layout, so the boundary under test is src/app/office/error.tsx (the frame stays); after that it
// works. tests/e2e/error-page.spec.ts opens it, sees the office's error page, taps "Try again" and
// gets the page.
export default async function OfficeFailsOnce({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  if (!testPagesOn()) notFound();
  const { id } = await searchParams;
  if (!isTestId(id)) notFound();
  if (firstTime(`office-page:${id}`)) throw new Error(PAGE_FAILS_ON_PURPOSE);
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">It worked this time</h1>
    </main>
  );
}
