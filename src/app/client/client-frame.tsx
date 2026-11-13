import Link from "next/link";
import type { ReactNode } from "react";
import { CLIENT_FRAME_WORDS } from "@/lib/client/page-copy";
import { LogoutButton } from "../logout-button";
import { ThemeButton } from "../office/theme-button";
import { SessionKeeper } from "../session-keeper";
import type { Theme } from "../theme";
import { Icon } from "../ui/icons";
import { refreshClientSessionAction } from "./actions";
import { ClientNav } from "./client-nav";

// The firm's initial on its mark (as the office's rail: its first letter or digit).
const initialOf = (name: string) => name.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "";

// The frame around a logged-in client's pages (Phase 36.3; the approved mock-up's client side): a
// white bar across the top with the firm's mark and "Acme Events · Client", the two pages (Your
// events, Your requests), and on the right who's logged in (name over contract), the light or dark
// button and Log out (the route every login uses, kind "client"; then "You're logged out." on the
// login page). It names the firm itself, so the firm's own bar steps aside (data-own-bar). The
// session's token is renewed once a day while they use it (SessionKeeper). Nothing here is about
// casuals.

export const navLink =
  "press inline-flex min-h-11 items-center rounded-full px-3 text-base font-semibold text-ink-muted hover:bg-button-hover hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink";

export function ClientFrame({
  firmName,
  contactName,
  contractName,
  theme,
  rotationDue,
  children,
}: {
  firmName: string;
  contactName: string;
  contractName: string;
  theme: Theme | undefined;
  rotationDue: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <SessionKeeper rotationDue={rotationDue} refresh={refreshClientSessionAction} />
      <header
        data-own-bar=""
        className="glass sticky top-0 z-20 border-b border-line"
        aria-label="Your client account"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          <Link href="/client" className="press flex min-h-11 min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-row bg-brand-bar text-base font-extrabold text-on-brand-bar"
            >
              {initialOf(firmName)}
            </span>
            <b className="truncate font-bold text-ink">{CLIENT_FRAME_WORDS(firmName)}</b>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <p className="min-w-0 text-right text-sm leading-tight text-ink-muted">
              <span className="block truncate font-semibold text-ink">{contactName}</span>
              <span className="block truncate">{contractName}</span>
            </p>
            <ThemeButton initial={theme} look="square" fallback="light" />
          </div>
          <div className="flex w-full flex-wrap items-center gap-1 pb-1">
            <ClientNav />
            <span className="ml-auto">
              <LogoutButton
                kind="client"
                after="/client/login?out=1"
                className={`${navLink} gap-2`}
                icon={<Icon name="logout" size={18} />}
              />
            </span>
          </div>
        </div>
      </header>
      <div id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </div>
    </>
  );
}
