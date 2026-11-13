import type { Metadata } from "next";
import Link from "next/link";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { PHONE_COPY } from "@/lib/demo/start-copy";
import { btn } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { staffDemoOffice } from "../gate";
import { PhoneOnly } from "./phone-only";

export const metadata: Metadata = { title: PHONE_COPY.title };

// The casual app in a phone-sized frame (Phase 31.2): on a laptop, the app (`/`) at a phone's size,
// 390 by 844, centred, with "Open full screen" and the way back. On a phone (below 640px) the
// browser goes straight to the app instead (PhoneOnly), and the frame isn't loaded (it's hidden
// there, and loads lazily). Same address, so the frame shares this browser's login. Caddy sends
// `frame-ancestors 'self'` on every answer (deploy/Caddyfile, Phase 37.7), which lets this
// same-address frame in and keeps every other site out. It must never become DENY.
export default async function PhoneFramePage() {
  await staffDemoOffice();
  const casual = await getWorkerSession();
  const name = casual ? casual.worker.firstName : "the casual";
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PhoneOnly />
      <PageHeader
        title={PHONE_COPY.title}
        actions={
          <>
            <Link href="/start" className={btn.secondary}>
              <Icon name="chevron" className="rotate-180" />
              {PHONE_COPY.back}
            </Link>
            <Link href="/" className={btn.primary}>
              {PHONE_COPY.fullScreen}
            </Link>
          </>
        }
      >
        <p className="text-ink-muted">{PHONE_COPY.intro(name)}</p>
      </PageHeader>
      <div className="hidden justify-center sm:flex">
        <div className="glass rounded-card p-3">
          <iframe
            src="/"
            title={PHONE_COPY.frameTitle}
            loading="lazy"
            width={390}
            height={844}
            className="block h-[844px] w-[390px] max-w-full rounded-inner"
          />
        </div>
      </div>
    </main>
  );
}
