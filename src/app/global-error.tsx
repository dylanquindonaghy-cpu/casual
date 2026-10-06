"use client";

import { loadPageAgain } from "./error-body";
import { page, staffBtn } from "./ui/classes";
import "./globals.css";

// Shown when even the page's frame fails (the root layout), in place of the browser's technical
// message. It replaces the whole page, so it brings its own <html> and <body>. "Try again" loads
// the page again (loadPageAgain), working before the page's scripts have loaded too.
export default function GlobalError() {
  return (
    <html lang="en-GB">
      <body className="bg-white text-lg text-slate-900 antialiased">
        <main className={page.staff}>
          <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
            Something went wrong
          </h1>
          <p className="mt-2">It&apos;s not you. Try again in a moment.</p>
          <p className="mt-2">If it keeps happening, contact the office.</p>
          <form onSubmit={loadPageAgain}>
            <button type="submit" className={`${staffBtn.primary} mt-6`}>
              Try again
            </button>
          </form>
        </main>
      </body>
    </html>
  );
}
