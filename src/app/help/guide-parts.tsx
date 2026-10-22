import type { ReactNode } from "react";

// Small pieces shared by the two guides: the workers' help page (/help) and the office's how-to
// guide (/office/guide). Plain and hook-free, with no words of their own: safe on the server, in
// the client and in the copy tests.

// Numbered steps: an ordered list whose numbers sit in small circles. (role="list" keeps the list
// announced in Safari, which drops it once the bullets are styled away.)
export function Steps({ children }: { children: ReactNode }) {
  return (
    <ol role="list" className="mt-3 flex max-w-prose flex-col gap-3 [counter-reset:step]">
      {children}
    </ol>
  );
}

export function Step({ children }: { children: ReactNode }) {
  return (
    <li className="relative min-h-7 pl-10 office:pl-12 [counter-increment:step] before:absolute before:top-0 before:left-0 before:flex before:size-7 before:items-center before:justify-center before:rounded-full before:bg-ink before:text-sm before:leading-none before:font-bold before:text-on-ink before:tabular-nums before:content-[counter(step)]">
      {children}
    </li>
  );
}

// A short list of points (not steps): small square bullets in the muted colour.
export function Points({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-3 flex max-w-prose list-[square] flex-col gap-2 pl-6 marker:text-ink-muted">
      {children}
    </ul>
  );
}

// The name of a button, link, field or section, as it reads on screen.
export function Name({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}
