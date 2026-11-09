import Link from "next/link";
import { CHOOSER_COPY } from "@/lib/demo/start-copy";
import { quietLink } from "../ui/classes";
import { Icon } from "../ui/icons";
import { CasualViewButton } from "./casual-view-button";

// The two big cards and the guide's link (Phase 31.2). Each card is one tap target (the whole card),
// at least 44px tall many times over, glass as the office's dashboard cards. One column on a phone,
// two side by side from 768px. Hook-free; the casual card's button is the one client part.
export const choiceCard =
  "press glass group flex h-full w-full flex-col items-start gap-3 rounded-card p-6 text-left hover:bg-button-hover focus-visible:outline-offset-4";

export function ChooserView({ name }: { name: string }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-title text-balance text-ink">{CHOOSER_COPY.title}</h1>
      <p className="mt-2 max-w-prose text-ink-muted">{CHOOSER_COPY.intro}</p>
      <p className="mt-1 text-sm text-ink-muted">{CHOOSER_COPY.loggedInAs(name)}</p>
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        <li>
          <Link href={CHOOSER_COPY.office.href} className={choiceCard}>
            <CardHead icon="dashboard" title={CHOOSER_COPY.office.title} />
            <span className="text-ink-muted">{CHOOSER_COPY.office.body}</span>
          </Link>
        </li>
        <li>
          <CasualViewButton className={choiceCard}>
            <CardHead icon="phone" title={CHOOSER_COPY.casual.title} />
            <span className="text-ink-muted">{CHOOSER_COPY.casual.body}</span>
          </CasualViewButton>
        </li>
      </ul>
      <Link href="/start/guide" className={`${quietLink} mt-6 text-base`}>
        <Icon name="guide" />
        {CHOOSER_COPY.guide}
      </Link>
    </main>
  );
}

function CardHead({ icon, title }: { icon: "dashboard" | "phone"; title: string }) {
  return (
    <span className="flex w-full items-center gap-3">
      <span
        aria-hidden="true"
        className="glass-button flex size-12 shrink-0 items-center justify-center rounded-full text-ink"
      >
        <Icon name={icon} size={24} />
      </span>
      <span className="flex-1 text-lg font-bold text-ink">{title}</span>
      <Icon name="chevron" className="text-ink-muted group-hover:text-ink" />
    </span>
  );
}
