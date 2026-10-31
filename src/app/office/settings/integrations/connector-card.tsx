import Link from "next/link";
import { meta, notice, textLink } from "@/app/ui/classes";
import type { PlannerLink } from "@/lib/office/integrations";
import {
  CONNECTOR_CADENCE,
  CONNECTOR_HIDDEN,
  CONNECTOR_HIDDEN_LINK,
  connectorFailingText,
  connectorLines,
} from "@/lib/office/integrations-copy";

// The firm's portal as its planner (P5's card; Phase 25.4): when each read last worked, why the
// last failed while reads are failing, how often it reads, and that its new sessions come in hidden.
export function ConnectorCard({
  planner,
  now,
  timeZone,
}: {
  planner: Extract<PlannerLink, { kind: "connector" }>;
  now: Date;
  timeZone: string;
}) {
  const failing = connectorFailingText(planner);
  return (
    <>
      <ul role="list" className="mt-3 flex flex-col gap-1 tabular-nums">
        {connectorLines(planner, now, timeZone).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {failing && (
        <p role="status" className={`${notice} mt-3`}>
          {failing}
        </p>
      )}
      <p className={`${meta} mt-3`}>{CONNECTOR_CADENCE}</p>
      <p className="mt-3">
        {CONNECTOR_HIDDEN}{" "}
        <Link href={CONNECTOR_HIDDEN_LINK.href} className={`font-semibold ${textLink}`}>
          {CONNECTOR_HIDDEN_LINK.text}
        </Link>
      </p>
    </>
  );
}
