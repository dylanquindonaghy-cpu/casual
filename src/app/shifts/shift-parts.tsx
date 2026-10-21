import type { ReactNode } from "react";
import { travelStrip, uniformItems, type UniformKind } from "@/lib/portal/home-copy";
import { payWords } from "@/lib/portal/format";
import { pounds } from "@/lib/portal/pay-format";
import { travelLineText, type TravelFacts } from "@/lib/travel/line-copy";
import { Icon, type IconName } from "../ui/icons";

// A shift's facts as the casual app's redesign shows them (Phase 18), on Home's pass and on the
// shift's own page: a labelled fact, getting there as three figures, what to bring and wear as
// tiles, and the pay in sign figures. Each keeps its full words for screen readers. Hook-free.

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-base text-ink-muted">{label}</p>
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
          className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line"
        >
          {strip.cells.map((c) => (
            <div key={c.words} className="px-3 py-2.5">
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

// The uniform as tiles, hi-vis first in sign yellow; words that don't split stay as words.
export function BringAndWear({ text }: { text: string }) {
  const items = uniformItems(text);
  if (!items) return <p className="text-lg font-semibold">{text}</p>;
  return (
    <ul role="list" className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <li
          key={item.words}
          className={`flex items-center gap-3 rounded-xl p-3 ${
            item.kind === "hivis"
              ? "col-span-2 bg-hivis text-on-hivis"
              : "border border-line text-ink"
          }`}
        >
          <Icon name={UNIFORM_ICON[item.kind]} size={26} />
          <span className="min-w-0 text-base leading-tight font-semibold">{item.words}</span>
          {item.note && <span className="ml-auto text-base">{item.note}</span>}
        </li>
      ))}
    </ul>
  );
}

// "£12.60 an hour, about £100.80", the rate in sign figures.
export function PayLine({
  ratePence,
  startsAt,
  endsAt,
}: {
  ratePence: number;
  startsAt: Date;
  endsAt: Date;
}) {
  const words = payWords(ratePence, startsAt, endsAt);
  const rate = pounds(ratePence);
  return (
    <Fact label="Pay">
      <p className="text-lg">
        <span className="sr-only">{words}</span>
        <span aria-hidden="true">
          <span className="font-sign text-2xl">{rate}</span>
          {words.slice(rate.length)}
        </span>
      </p>
    </Fact>
  );
}
