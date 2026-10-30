#!/usr/bin/env bash
# The single source of truth for "done". Runs every check; only if ALL pass does it write a
# stamp tied to the exact working-tree state. Hooks refuse to let a task be ticked in PLAN.md
# unless the stamp exists, passed, includes the browser tests (RUN_E2E=1) and matches the current
# files. The files' fingerprint is taken when the run starts; if they change during it, there is
# no stamp (audit L4).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
mkdir -p .claude/state
STATE=.claude/state/verified.json
tree_hash() { "$(git rev-parse --show-toplevel)/.claude/hooks/tree-hash.sh"; }
h_start=$(tree_hash)

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
# The production build, as the image builds it (Dockerfile: the same placeholder settings, which
# the app's settings check accepts at build time; the server's .env gives the real ones). A client
# component importing server code passes every other check but breaks this (How the build is run 1).
run build env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APP_BASE_DOMAIN=build.invalid \
  DATABASE_URL="postgres://shiftdesk_app:build-only@build.invalid:5432/build?sslmode=verify-full&sslrootcert=/app/db-ca.pem" \
  SESSION_SECRET=build-only-placeholder-never-used-at-run-time npm run --silent build || ok=false
# Verbose names every test in test.log (the auditor greps it); the JSON lets invariants.sh
# reject skipped or todo tests, which Vitest itself reports as a pass.
rm -f .claude/state/vitest.json
run test      npm test --silent -- --reporter=verbose --reporter=json \
                --outputFile.json=.claude/state/vitest.json || ok=false
e2e=false
# The browser tests' own results (scripts/e2e.mjs), so invariants.sh can refuse skipped ones,
# which Playwright reports as a pass (audit L62).
rm -f .claude/state/e2e-main.json .claude/state/e2e-no-texts.json .claude/state/e2e-walkthrough.json
if [ -f playwright.config.ts ] && [ "${RUN_E2E:-0}" = "1" ]; then
  if E2E_JSON_DIR=.claude/state run e2e npm run --silent e2e; then e2e=true; else ok=false; fi
fi
# The project's invariants (RLS on every table, no secrets, etc.). Never skipped (audit L61).
if [ -x scripts/invariants.sh ]; then
  VERIFY_E2E="$e2e" run invariants scripts/invariants.sh || ok=false
else
  echo "== invariants ... FAILED"; echo "   scripts/invariants.sh is missing or not executable"; ok=false
fi

h=$(tree_hash)
if [ "$h" != "$h_start" ]; then
  echo "== files changed while the checks ran (fingerprint $h_start at the start, $h at the end)"
  echo "   so the results can't be tied to one set of files. Run it again without editing."
  ok=false
fi
if $ok; then
  printf '{"ok":true,"tree":"%s","e2e":%s,"at":"%s"}\n' "$h" "$e2e" "$(date -u +%FT%TZ)" > "$STATE"
  echo "VERIFIED tree=$h e2e=$e2e"
else
  printf '{"ok":false,"tree":"%s","e2e":%s,"at":"%s"}\n' "$h" "$e2e" "$(date -u +%FT%TZ)" > "$STATE"
  echo "NOT VERIFIED"; exit 1
fi
