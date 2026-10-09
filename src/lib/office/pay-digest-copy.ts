import type { SendDigestNowResult, DigestStatus } from "../pay/digest";
import { scheduleWords, type DigestSchedule } from "../pay/digest-schedule";
import { timeOnDay } from "../portal/format";

// The payroll digest on payroll's page, in plain words (docs/screens.md `/office/pay-queries`).

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

const queries = (n: number) => (n === 1 ? "1 query" : `${n} queries`);
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

export function sendNowText(result: SendDigestNowResult | Common): string {
  switch (result.status) {
    case "queued":
      return `Sending the digest now: ${result.queries === 1 ? "1 new query" : `${result.queries} new queries`} to ${people(result.recipients)}. It should arrive in a minute or two.`;
    case "nothing_new":
      return "No new pay queries to send. Queries already in a digest aren't sent again.";
    case "no_recipients":
      return "There's no one in payroll with an email address to send it to.";
    case "just_asked":
      return "A digest was asked for less than a minute ago. Wait a minute, then try again.";
    case "logged_out":
      return "Your session has ended. Log in again.";
    case "not_allowed":
      return "You can't send the pay digest.";
    case "error":
      return "Something went wrong. Try again.";
  }
}

// The schedule line, then the last digest and anything since that didn't go.
export function digestLines(
  schedule: DigestSchedule,
  status: DigestStatus,
  timeZone: string,
): string[] {
  const when = scheduleWords(schedule);
  const lines = [
    when
      ? `The digest goes to payroll by email ${when}: the new queries, grouped, with the list attached.`
      : "No digest is scheduled. You can send one now.",
    status.lastSent
      ? `Last digest: ${timeOnDay(status.lastSent.at, timeZone)}, ${queries(status.lastSent.queries)} to ${people(status.lastSent.recipients)}${status.lastSent.failed > 0 ? ` (${status.lastSent.failed === 1 ? "1 address" : `${status.lastSent.failed} addresses`} failed)` : ""}.`
      : "No digest sent yet.",
  ];
  if (status.problem) {
    const at = timeOnDay(status.problem.at, timeZone);
    lines.push(
      status.problem.reason === "failed"
        ? `The digest at ${at} didn't go: the email couldn't be sent. Its queries will be in the next one.`
        : status.problem.reason === "unfinished"
          ? `The digest at ${at} may not have gone: it stopped part way. Its queries show as in a digest below.`
          : `The digest at ${at} didn't go: there's no one in payroll with an email address to send it to.`,
    );
  }
  if (status.sendingSince) {
    lines.push(`A digest is being sent now (started ${timeOnDay(status.sendingSince, timeZone)}).`);
  }
  return lines;
}
