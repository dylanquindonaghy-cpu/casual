import type { Metadata } from "next";
import Link from "next/link";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { PHONE_COPY } from "@/lib/demo/start-copy";
import { btn } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { staffDemoOffice } from "../gate";
import { PhoneOnly } from "./phone-only";

export const metadata: Metadata = { title: PHONE_COPY.title };

// The casual app in a phone-sized frame (Phase 31.2): on a laptop, the app (`/`) at a phone's size,
// 390 by 844, centred, with "Open full screen" and the way back. On a phone (below 640px) the
// browser goes straight to the app instead (PhoneOnly), and the frame isn't loaded (it's hidden
// there, and loads lazily). Same address, so the frame shares this browser's login; the app sends
// no header that stops it being framed, and nothing here lets another site frame it.
export default async function PhoneFramePage() {
  await staffDemoOffice();
  const casual = await getWorkerSession();
  const name = casual ? casual.worker.firstName : "the casual";
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PhoneOnly />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title text-balance text-ink">{PHONE_COPY.title}</h1>
          <p className="mt-2 text-ink-muted">{PHONE_COPY.intro(name)}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/start" className={btn.secondary}>
            <Icon name="chevron" className="rotate-180" />
            {PHONE_COPY.back}
          </Link>
          <Link href="/" className={btn.primary}>
            {PHONE_COPY.fullScreen}
          </Link>
        </div>
      </div>
      <div className="mt-6 hidden justify-center sm:flex">
        <div className="glass rounded-[3rem] p-3">
          <iframe
            src="/"
            title={PHONE_COPY.frameTitle}
            loading="lazy"
            width={390}
            height={844}
            className="block h-[844px] w-[390px] max-w-full rounded-[2.25rem] bg-canvas"
          />
        </div>
      </div>
    </main>
  );
}
