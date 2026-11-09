import Link from "next/link";
import { cookies } from "next/headers";
import { barPillsFor, myBarRole } from "@/lib/portal/casual-bar";
import type { CountPill } from "@/lib/portal/home-board";
import { COUNTS_LABEL } from "@/lib/portal/home-copy";
import { tabCountsNow } from "@/lib/portal/request-cached";
import type { TabCounts } from "@/lib/portal/tab-counts";
import { BELL_HREF, barInitials, bellNumber, bellWords } from "@/lib/portal/top-bar-copy";
import { getCurrentBrand } from "@/lib/tenancy/current-brand";
import { ThemeButton } from "./office/theme-button";
import { THEME_COOKIE, themeFromCookie, type Theme } from "./theme";
import { countChip, countChipNumber } from "./ui/classes";
import { Icon } from "./ui/icons";

// The casual app's top bar (Phase 32, 32.1; docs/screens.md "## Phase 32"; Dylan's approved
// mock-up, "the casual app in the office's look"), the office's frame (src/app/office/
// office-frame.tsx) on every page a logged-in casual uses, in place of the firm's bar (which hides
// itself while this is on the page: brand-bar.tsx). Below 1024px: the firm's lime mark (or its
// logo) and name, the bell and her initials. From 1024px, right of the rail (which has the mark
// there): her count pills (the office's chips, as Home's: Booked, Open to you, Urgent, To do,
// Messages, each a link 44px tall to the page it counts), the bell, the light or dark switch (the
// office's own, ./office/theme-button.tsx: the casual app has a light look, so it switches here
// too), and her initials, name and role. The bell ("Answers from the office") opens My requests,
// with the office's answers to her requests she hasn't seen as its number (the tab bar's own count: tabCounts().answers).
// Nothing new she can see or do: every number is one the app already showed her. In the copy kept
// for no signal the numbers that go stale leave (data-online-only) and "Offline" shows, as on the
// firm's bar. It stays at the top once the page runs, with the firm's bar's frosted edge
// (ChromeWatch, mounted by the firm's bar). Server-rendered; only the light or dark switch runs.

export function CasualTopBar({
  firmName,
  logoUrl = null,
  firstName,
  lastName,
  role,
  pills,
  answers,
  theme,
  railOnly = false,
}: {
  firmName: string;
  logoUrl?: string | null;
  firstName: string;
  lastName: string;
  role: string | null;
  pills: CountPill[];
  answers: number; // the office's answers to her requests she hasn't seen (the bell's number)
  theme: Theme | undefined;
  railOnly?: boolean; // a shift's own page: its own bar on a phone, this one from 1024px only
}) {
  const initial = firmName.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "";
  const name = `${firstName} ${lastName}`.trim();
  return (
    <header
      data-casual-top=""
      data-rail-only={railOnly ? "" : undefined}
      className={`scroll-edge relative z-20 text-ink [html[data-js]_&]:sticky [html[data-js]_&]:top-0 ${railOnly ? "max-lg:hidden" : ""}`}
    >
      <div className="mx-auto flex min-h-16 max-w-md items-center gap-2 px-4 py-2 sm:px-6 lg:max-w-none lg:px-6 lg:pt-4 lg:pb-2">
        {/* The firm, below 1024px (the rail has its mark from there). */}
        <p className="flex min-w-0 flex-1 items-center gap-3 lg:hidden">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a firm's own https logo, from any host (next/image would need each host listed)
            <img
              src={logoUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-10 w-auto max-w-32 object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              data-testid="top-mark"
              className="flex size-10 shrink-0 items-center justify-center rounded-row bg-brand-bar text-lg font-bold text-on-brand-bar"
            >
              {initial}
            </span>
          )}
          <span className="min-w-0 truncate text-base font-semibold">{firmName}</span>
        </p>
        {/* Her counts, from 1024px. */}
        <ul
          role="list"
          aria-label={COUNTS_LABEL}
          data-bar-counts=""
          data-tour="counts"
          className="scrollbar-none fade-x hidden min-w-0 shrink items-center gap-2 overflow-x-auto lg:flex"
        >
          {pills.map((p) => (
            <li key={p.key} {...(p.onlineOnly ? { "data-online-only": "" } : {})} className="flex">
              <Link href={p.href} data-count={p.key} className={countChip}>
                {p.label} <b className={countChipNumber[p.tone]}>{p.count}</b>
              </Link>
            </li>
          ))}
        </ul>
        <span aria-hidden="true" className="hidden min-w-0 flex-1 lg:block" />
        <span
          data-offline-only=""
          className="rounded-full bg-ink px-2.5 text-sm leading-6 font-semibold text-on-ink"
        >
          Offline
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={BELL_HREF}
            aria-label={bellWords(answers)}
            data-bell=""
            className="press-glass glass-button relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
          >
            <Icon name="bell" />
            {answers > 0 && (
              <span
                aria-hidden="true"
                data-online-only=""
                className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-urgent-fill outline-2 outline-canvas px-1 text-xs font-semibold text-on-urgent tabular-nums"
              >
                {bellNumber(answers)}
              </span>
            )}
          </Link>
          <span className="hidden lg:flex">
            <ThemeButton initial={theme} look="square" />
          </span>
          <p data-you="" className="flex items-center gap-2.5 lg:pr-2 lg:pl-1">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-hivis text-sm font-semibold text-on-hivis"
            >
              {barInitials(firstName, lastName)}
            </span>
            {/* Her name and role from 1024px (read out at every width). */}
            <span className="sr-only leading-tight lg:not-sr-only">
              <span className="block max-w-40 truncate text-base font-semibold text-ink">
                {name}
              </span>
              {role && (
                <span className="block text-sm text-ink-muted">
                  <span className="sr-only">, </span>
                  {role}
                </span>
              )}
            </span>
          </p>
        </div>
      </div>
    </header>
  );
}

// The bar with its numbers, for a casual page (put it just before the page's <main>). Home passes
// the pills and counts it has already read; every other page lets it read them.
export async function CasualTop({
  firm,
  worker,
  counts,
  pills,
  railOnly = false,
}: {
  firm: { id: string; name: string; timezone: string };
  worker: { id: string; firstName: string; lastName: string };
  counts?: TabCounts;
  pills?: CountPill[];
  railOnly?: boolean;
}) {
  const ctx = { firm };
  const [brand, jar, role, tabs] = await Promise.all([
    getCurrentBrand(),
    cookies(),
    myBarRole(ctx, worker.id),
    // The tab bar's own counts, read once per request (src/lib/portal/request-cached.ts).
    counts ? Promise.resolve(counts) : tabCountsNow(firm.id, worker.id),
  ]);
  const shown = pills ?? (await barPillsFor(ctx, worker.id, tabs));
  return (
    <CasualTopBar
      firmName={brand?.name ?? firm.name}
      logoUrl={brand?.logoUrl ?? null}
      firstName={worker.firstName}
      lastName={worker.lastName}
      role={role}
      pills={shown}
      answers={tabs.answers}
      theme={themeFromCookie(jar.get(THEME_COOKIE)?.value)}
      railOnly={railOnly}
    />
  );
}
