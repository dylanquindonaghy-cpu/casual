"use client";

import { loadPageAgain } from "./error-body";
import "./globals.css";

// Shown when even the page's frame fails (the root layout), in place of the browser's technical
// message. It replaces the whole page, so it brings its own <html> and <body>. "Try again" loads
// the page again (loadPageAgain), working before the page's scripts have loaded too.
export default function GlobalError() {
  return (
    <html lang="en-GB">
      <body className="bg-white text-lg text-slate-900 antialiased">
        <main className="mx-auto max-w-md p-6">
          <h1 className="text-3xl font-bold">Something went wrong</h1>
          <p className="mt-2">It&apos;s not you. Try again in a moment.</p>
          <p className="mt-2">If it keeps happening, contact the office.</p>
          <form onSubmit={loadPageAgain}>
            <button
              type="submit"
              className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white"
            >
              Try again
            </button>
          </form>
        </main>
      </body>
    </html>
  );
}
