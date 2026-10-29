import type { ReactNode } from "react";
import { travelStrip, uniformItems, type UniformKind } from "@/lib/portal/home-copy";
import { payWords } from "@/lib/portal/format";
import { hoursText, pounds } from "@/lib/portal/pay-format";
import { travelLineText, type TravelFacts } from "@/lib/travel/line-copy";
import { Icon, type IconName } from "../ui/icons";

// A shift's facts as the casual app shows them (Phases 18 and 20), on Home's pass and on the
// shift's own page: a card of label and value rows (each answer under a small grey label, like a
// receipt), getting there as three figures set into the card, what to bring and wear as a list
// (what the firm gives marked in hi-vis yellow), and the pay large. Each keeps its full words for
// screen readers. Hook-free.

// The card the rows sit in: lifted off the page, one hairline.
export const factCard = "glass flex flex-col divide-y divide-line rounded-3xl px-4.5";

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3.5">
      <p className="text-sm text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

// "Getting there", from her home area, as three figures (the full line for screen readers).
export function TravelFigures({ travel, timeZone }: { travel: TravelFacts; timeZone: string }) {
  const strip = travelStrip(travel);
  return (
    <div data-travel-line="">
      <span className="sr-only">{travelLineText(travel, timeZone)}</span>
      {strip.kind === "words" ? (
        <p aria-hidden="true" className="text-base text-ink-muted">
          {strip.words}
        </p>
      ) : (
        <div
          aria-hidden="true"
          className={`mt-1 grid gap-2 ${strip.cells.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
        >
          {strip.cells.map((c) => (
            <div key={c.words} className="glass-tile flex flex-col gap-0.5 rounded-2xl px-3 py-3">
              <p className="font-sign text-2xl leading-tight">{c.figure}</p>
              <p className="text-base leading-snug text-ink-muted">{c.words}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const UNIFORM_ICON: Record<UniformKind, IconName> = {
  hivis: "tabard",
  trousers: "trousers",
  shoe: "shoe",
  garment: "garment",
};

// The uniform as a list, hi-vis first, each item's note ("We provide it") a hi-vis yellow chip;
// words that don't split stay as words.
export function BringAndWear({ text }: { text: string }) {
  const items = uniformItems(text);
  if (!items) return <p className="text-lg">{text}</p>;
  return (
    <ul role="list" className="mt-0.5 flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.words} className="flex min-h-7 items-center gap-2.5 text-lg">
          <Icon name={UNIFORM_ICON[item.kind]} size={22} className="text-ink-muted" />
          <span className="min-w-0 leading-snug">{item.words}</span>
          {item.note && (
            <span className="ml-auto shrink-0 rounded-full bg-hivis px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap text-on-hivis">
              {item.note}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// "£12.60 an hour", large, and "About £100.80 for the 8 hours" under it (the full words for screen
// readers): on a shift's page in its own card, under a "Pay" label on the pass's details.
export function PayFigures({
  ratePence,
  startsAt,
  endsAt,
}: {
  ratePence: number;
  startsAt: Date;
  endsAt: Date;
}) {
  const hours = Math.max(0, endsAt.getTime() - startsAt.getTime()) / 3_600_000;
  return (
    <div>
      <span className="sr-only">{payWords(ratePence, startsAt, endsAt)}</span>
      <p aria-hidden="true" className="font-sign text-2xl leading-tight">
        {pounds(ratePence)} an hour
      </p>
      <p aria-hidden="true" className="text-base text-ink-muted tabular-nums">
        About {pounds(Math.round(ratePence * hours))} for the {hoursText(hours)}
      </p>
    </div>
  );
}

export function PayLine(props: { ratePence: number; startsAt: Date; endsAt: Date }) {
  return (
    <Fact label="Pay">
      <PayFigures {...props} />
    </Fact>
  );
}
