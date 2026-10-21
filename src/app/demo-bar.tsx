import Link from "next/link";

// The demo bar (docs/screens.md "Demo bar"; 16.1, ADR-025): on a demo server, the first thing on
// every page of a demo firm, staff and office alike, so nobody takes the made-up people for real
// ones or waits for a text that will never come. Its link opens the Demo phone. Hook-free.
export function DemoBar() {
  return (
    <aside aria-label="Demo" data-testid="demo-bar" className="bg-demo text-on-demo">
      <p className="mx-auto max-w-md px-4 py-2 text-sm sm:px-6 [body:has([data-shell=office])_&]:max-w-none [body:has([data-shell=office])_&]:text-center">
        A demo with made-up people. No real texts or emails go out: see them on the{" "}
        <Link
          href="/demo"
          className="font-bold underline underline-offset-4 focus-visible:outline-on-demo"
        >
          Demo phone
        </Link>
        .
      </p>
    </aside>
  );
}
