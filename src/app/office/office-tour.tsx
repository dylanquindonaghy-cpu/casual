"use client";

import { usePathname } from "next/navigation";
import { useCallback, type Ref } from "react";
import { OFFICE_TOUR_STEPS, OFFICE_WELCOME } from "@/lib/tour/office-copy";
import type { TourOutcome } from "@/lib/tour/seen";
import { TourHost, type TourApi } from "../tour/tour";
import { TourWelcome } from "../tour/welcome";

// The office's first-login tour (Phase 33.2; docs/screens.md "## Phase 33"): in the office frame,
// so "Take the tour again" in the account menu opens it from any page and the walkthrough goes to
// the dashboard, where its eight steps are. It opens by itself on the dashboard until the person
// finishes or skips it (office_users.tour_seen_at, read with the session).

export const OFFICE_TOUR_VIDEO = {
  src: "/tour/office.mp4",
  poster: "/tour/office.jpg",
  captions: "/tour/office.en.vtt",
} as const;

export interface OfficeTourProps {
  seen: boolean;
  laterKey: string; // this login's: "Not now" lasts until the next login
  markSeen: (outcome: TourOutcome) => Promise<unknown>;
}

export function OfficeTour({
  firmName,
  tour,
  apiRef,
}: {
  firmName: string;
  tour: OfficeTourProps;
  apiRef: Ref<TourApi>;
}) {
  const pathname = usePathname();
  // The office's welcome window: its video and words, with the firm's name.
  const Welcome = useCallback(
    ({ onStart, onNotNow }: { onStart: () => void; onNotNow: () => void }) => (
      <TourWelcome
        copy={{ ...OFFICE_WELCOME, title: OFFICE_WELCOME.title(firmName) }}
        video={OFFICE_TOUR_VIDEO}
        onStart={onStart}
        onNotNow={onNotNow}
      />
    ),
    [firmName],
  );
  return (
    <TourHost
      id="office"
      steps={OFFICE_TOUR_STEPS}
      autoOpen={!tour.seen && pathname === "/office"}
      laterKey={tour.laterKey}
      onEnd={tour.markSeen}
      apiRef={apiRef}
      Welcome={Welcome}
    />
  );
}
