import { scanLogText, withoutConsoleMessages, type LogFinding } from "../../scripts/logs-scan";

// What the e2e teardown (tests/e2e/teardown.ts) checks in one server's output for the whole run:
// - no phone number or email address (a firm's own shifts line may be allowed: a business number);
// - no login token or session cookie outside the console transport's own prints (they show each
//   message whole, login links included, on purpose), and none of the tokens the run sent;
// - no server error (a JSON log line at error level), except the ones expected (the error-screen
//   tests' failures on purpose).
export interface OutputCheck {
  findings: LogFinding[];
  errors: string[];
}

export function checkServerOutput(
  text: string,
  opts: { allowNumbers: string[]; sentTokens: string[]; expectedErrors: Set<string> },
): OutputCheck {
  const elsewhere = withoutConsoleMessages(text);
  const findings: LogFinding[] = [
    ...scanLogText(text, { allowNumbers: opts.allowNumbers }).filter((f) => f.kind !== "token"),
    ...scanLogText(elsewhere).filter((f) => f.kind === "token"),
  ];
  elsewhere.split("\n").forEach((line, i) => {
    if (opts.sentTokens.some((token) => token.length > 0 && line.includes(token))) {
      findings.push({ line: i + 1, kind: "token", masked: "(a token this run sent)" });
    }
  });
  const errors = text.split("\n").filter((line) => unexpectedError(line, opts.expectedErrors));
  return { findings, errors };
}

function unexpectedError(line: string, expected: Set<string>): boolean {
  if (!line.includes('"level":"error"')) return false;
  try {
    const entry = JSON.parse(line) as { level?: string; error?: { message?: string } };
    return entry.level === "error" && !expected.has(entry.error?.message ?? "");
  } catch {
    return true; // not our JSON, but says error: counted
  }
}
