import Link from "next/link";
import { CHOOSER_COPY } from "@/lib/demo/start-copy";
import { quietLink } from "../ui/classes";
import { Icon } from "../ui/icons";
import { PageHeader } from "../ui/page-header";
import { CasualViewButton } from "./casual-view-button";
import { ClientViewButton } from "./client-view-button";

// The three big cards (Phase 31.2; the client view, 36.5) and the guide's link. Each card is one
// tap target (the whole card), at least 44px tall many times over, glass as the office's dashboard
// cards. One column on a phone, two side by side from 768px, three from 1024px. Hook-free; the
// casual and client cards' buttons are the client parts.
export const choiceCard =
  "press glass group flex h-full w-full flex-col items-start gap-3 rounded-card p-6 text-left hover:bg-button-hover focus-visible:outline-offset-4";

export function ChooserView({ name }: { name: string }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader title={CHOOSER_COPY.title}>
        <p className="text-ink-muted">{CHOOSER_COPY.intro}</p>
        <p className="text-sm text-ink-muted">{CHOOSER_COPY.loggedInAs(name)}</p>
      </PageHeader>
      <ul role="list" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
        <li>
          <ClientViewButton className={choiceCard}>
            <CardHead icon="requests" title={CHOOSER_COPY.client.title} />
            <span className="text-ink-muted">{CHOOSER_COPY.client.body}</span>
          </ClientViewButton>
        </li>
      </ul>
      <Link href="/start/guide" className={`${quietLink} mt-6 text-base`}>
        <Icon name="guide" />
        {CHOOSER_COPY.guide}
      </Link>
    </main>
  );
}

function CardHead({ icon, title }: { icon: "dashboard" | "phone" | "requests"; title: string }) {
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
