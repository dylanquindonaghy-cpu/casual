#!/usr/bin/env bash
# The single source of truth for "done". Runs every check; only if ALL pass does it write a
# stamp tied to the exact working-tree state. Hooks refuse to let a task be ticked in PLAN.md
# unless the stamp exists, passed, and matches the current files.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
mkdir -p .claude/state
STATE=.claude/state/verified.json
tree_hash() { "$(git rev-parse --show-toplevel)/.claude/hooks/tree-hash.sh"; }

run() {  # run <name> <command...>
  local name="$1"; shift
  printf '== %s ... ' "$name"
  if "$@" > ".claude/state/$name.log" 2>&1; then
    echo "ok"; return 0
  else
    echo "FAILED"; echo "   last 40 lines of .claude/state/$name.log:"
    tail -n 40 ".claude/state/$name.log" | sed 's/^/   /'
    return 1
  fi
}

ok=true
run typecheck npm run --silent typecheck || ok=false
run lint      npm run --silent lint      || ok=false
# Verbose names every test in test.log (the auditor greps it); the JSON lets invariants.sh
# reject skipped or todo tests, which Vitest itself reports as a pass.
rm -f .claude/state/vitest.json
run test      npm test --silent -- --reporter=verbose --reporter=json \
                --outputFile.json=.claude/state/vitest.json || ok=false
e2e=false
if [ -f playwright.config.ts ] && [ "${RUN_E2E:-0}" = "1" ]; then
  if run e2e npm run --silent e2e; then e2e=true; else ok=false; fi
fi
# Optional project-specific invariants (RLS on every table, no secrets, etc.) if present.
[ -x scripts/invariants.sh ] && { run invariants scripts/invariants.sh || ok=false; }

h=$(tree_hash)
if $ok; then
  printf '{"ok":true,"tree":"%s","e2e":%s,"at":"%s"}\n' "$h" "$e2e" "$(date -u +%FT%TZ)" > "$STATE"
  echo "VERIFIED tree=$h e2e=$e2e"
else
  printf '{"ok":false,"tree":"%s","e2e":%s,"at":"%s"}\n' "$h" "$e2e" "$(date -u +%FT%TZ)" > "$STATE"
  echo "NOT VERIFIED"; exit 1
fi
