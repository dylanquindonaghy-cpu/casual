import { page, staffBtn } from "./ui/classes";

// What the error page says (src/app/error.tsx decides whether the browser is online).
// "Try again" is Next's retry(): it fetches the page from the server again, then draws it (reset()
// would only redraw the failure the browser already has). "Go to my shifts" is a plain link, a
// full page load, so it recovers on My shifts itself too (a Next <Link> to the page you're already
// on keeps the error).
// "Try again" stays disabled until React has taken over the page (`ready`, useHydrated: before
// that a tap would do nothing), and while the phone says it has no signal: a fetch would fail and
// put the browser's own offline page in place of this one. It comes back on with the signal.
export function ErrorBody({
  online,
  ready,
  retry,
}: {
  online: boolean;
  ready: boolean;
  retry: () => void;
}) {
  return (
    <main className={page.staff}>
      <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
        {online ? "Something went wrong" : "No signal"}
      </h1>
      {online ? (
        <>
          <p className="mt-2">It&apos;s not you. Try again in a moment.</p>
          <p className="mt-2">If it keeps happening, contact the office.</p>
        </>
      ) : (
        <p className="mt-2">Check your signal and try again.</p>
      )}
      <button
        type="button"
        onClick={retry}
        disabled={!ready || !online}
        className={`${staffBtn.primary} mt-6`}
      >
        Try again
      </button>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose */}
      <a href="/" className={`${staffBtn.secondary} mt-3`}>
        Go to my shifts
      </a>
    </main>
  );
}

// "Try again" when the page's frame itself failed (src/app/global-error.tsx): load the page again,
// as Next's own whole-page error does. Its button submits a form, so even before (or without) the
// page's scripts the browser loads the page again (the address without its ?query); with them,
// this loads the whole address. A plain load, never a resent form (a reload after a form sent
// without scripts, like a login, would ask to send it again).
export function loadPageAgain(event: { preventDefault(): void }): void {
  event.preventDefault();
  window.location.replace(window.location.pathname + window.location.search);
}
