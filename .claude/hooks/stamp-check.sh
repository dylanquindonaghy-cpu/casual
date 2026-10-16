#!/usr/bin/env bash
# Is there a passing verify stamp for the CURRENT files, browser tests included (audit L5, L61)?
# Exit 0 if so. Otherwise exit 1 and print why, in one line. Shared by the tick guards and the
# Stop hook.
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repository"; exit 1; }
state="$root/.claude/state/verified.json"
[ -f "$state" ] || { echo "scripts/verify.sh has never run"; exit 1; }
[ "$(jq -r '.ok' "$state" 2>/dev/null)" = "true" ] || { echo "the last verify run FAILED"; exit 1; }
[ "$(jq -r '.e2e' "$state" 2>/dev/null)" = "true" ] ||
  { echo "the last verify run skipped the browser tests (run RUN_E2E=1 ./scripts/verify.sh)"; exit 1; }
[ "$(jq -r '.tree' "$state" 2>/dev/null)" = "$("$root/.claude/hooks/tree-hash.sh")" ] ||
  { echo "files changed since the last passing verify"; exit 1; }
exit 0
