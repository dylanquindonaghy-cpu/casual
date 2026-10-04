import { notFound } from "next/navigation";
import { firstTime, isTestId, PAGE_FAILS_ON_PURPOSE, testPagesOn } from "@/lib/e2e/fails-once";

// A page for the browser tests only (src/lib/e2e/fails-once.ts): "not found" unless
// E2E_TEST_PAGES=on. The first time it's opened with a given ?id= it fails, as a page does when the
// database times out; after that it works. tests/e2e/error-page.spec.ts opens it, sees the error
// page, taps "Try again" and gets the page: proof that "Try again" fetches the page again
// (src/app/error.tsx) rather than redrawing the failure the browser already has.
export default async function FailsOnce({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  if (!testPagesOn()) notFound();
  const { id } = await searchParams;
  if (!isTestId(id)) notFound();
  if (firstTime(`page:${id}`)) throw new Error(PAGE_FAILS_ON_PURPOSE);
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">It worked this time</h1>
    </main>
  );
}
