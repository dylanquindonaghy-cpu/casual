#!/usr/bin/env bash
# Project invariants, run by scripts/verify.sh after the tests. Exit non-zero on any failure.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
fail=0

# 1. No focused or skipped tests (they silently shrink the suite). Playwright's fixme, fail and
#    run-time skips too (audit L62); a browser test turned off at run time is caught in 3 as well.
if hits=$(grep -rnE '\b(it|test|describe)\.(only|skip|todo|fails|fail|fixme|skipIf|runIf)\(|\bx(it|describe)\(|\bf(it|describe)\(|\bctx\.skip\(|\bcontext\.skip\(|\btestInfo\.(skip|fixme|fail)\(|\btest\.info\(\)\.(skip|fixme|fail)\(' tests src 2>/dev/null); then
  echo "FAIL: focused/skipped tests found:"; echo "$hits"; fail=1
else echo "ok: no .only/.skip/.todo in tests"; fi

# 2. No env files tracked or staged, other than .env.example.
if hits=$( { git ls-files; git ls-files --others --exclude-standard; } | grep -E '(^|/)\.env' | grep -v '^\.env\.example$'); then
  echo "FAIL: env files would be committed:"; echo "$hits"; fail=1
else echo "ok: no .env files tracked"; fi

# 3. The test run itself: Vitest exits 0 even when tests are skipped at runtime, so read the
#    JSON results verify.sh just wrote and require every test to have run and passed.
results=.claude/state/vitest.json
if [ ! -f "$results" ]; then
  echo "FAIL: $results missing (run ./scripts/verify.sh)"; fail=1
elif ! node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const bad = r.numPendingTests + r.numTodoTests + r.numFailedTests;
  console.log(`   ${r.numTotalTests} tests: ${r.numPassedTests} passed, ${r.numFailedTests} failed, ${r.numPendingTests} skipped, ${r.numTodoTests} todo`);
  process.exit(r.numTotalTests > 0 && bad === 0 ? 0 : 1);
' "$results"; then
  echo "FAIL: some tests were skipped, todo or failed"; fail=1
else echo "ok: every test ran and passed"; fi
#    And the browser tests, when this verify run included them (VERIFY_E2E=true): Playwright exits
#    0 with tests skipped or marked to fail, so read its JSON reports (scripts/e2e.mjs; audit L62).
if [ "${VERIFY_E2E:-false}" = "true" ]; then
  if node scripts/check-e2e-report.mjs .claude/state/e2e-main.json .claude/state/e2e-no-texts.json \
    .claude/state/e2e-walkthrough.json; then
    echo "ok: every browser test ran and passed"
  else echo "FAIL: some browser tests were skipped, marked to fail, flaky or failed"; fail=1; fi
fi

# 4. Schema and migrations in sync: generating into a copy of drizzle/ must produce nothing.
#    (drizzle-kit exits 0 even when it stops at an interactive prompt, so check the output.)
drift=.claude/state/drift
rm -rf "$drift" && mkdir -p "$drift" && cp -r drizzle "$drift/"
out=$(npx drizzle-kit generate --dialect postgresql --schema ./src/lib/db/schema/index.ts --out "$drift/drizzle" 2>&1)
if echo "$out" | grep -q "No schema changes" && [ "$(ls "$drift/drizzle" | wc -l)" = "$(ls drizzle | wc -l)" ]; then
  echo "ok: schema and migrations in sync"
else
  echo "FAIL: src/lib/db/schema has changes with no migration. Run: npm run db:generate"
  echo "$out" | tail -5; fail=1
fi

# 5. Only withFirm sets the firm. Nothing else in src or scripts may touch app.current_firm_id,
#    except the seed's owner-only firm provisioning (RLS is forced on the owner too, so creating a
#    firm means setting it; ESLint keeps app code from importing src/lib/db/admin) and the
#    owner-run admin commands, each named here (audit L65; integration-tested: onboarding,
#    custom-domain, brand, shifts-line and the others).
owner_scripts='^scripts/(firm-agreement-owner|firm-brand-owner|firm-connector-owner|firm-create-owner|firm-domain-owner|firm-names-owner|firm-secret-owner|firm-settings-owner|firm-sheet-owner|inbox-owner|shifts-line-owner)\.ts:'
if hits=$(grep -rnF "app.current_firm_id" src scripts | grep -v -e "^src/lib/db/scoped.ts:" -e "^src/lib/db/admin/seed.ts:" -e "^scripts/invariants.sh:" | grep -vE "$owner_scripts"); then
  echo "FAIL: app.current_firm_id used outside src/lib/db/scoped.ts and the named owner commands:"; echo "$hits"; fail=1
else echo "ok: only withFirm (and the seed's and the owner commands' firm provisioning) set the firm"; fi

# 6. Tests never reach a real outside service (CLAUDE.md conventions): the Vitest setup and the
#    browser tests' servers (serverEnv(), the walkthrough's and the no-text run's too) pin every
#    real sender off, since
#    both load .env. A pin only counts on a line that isn't commented out. The settings also refuse
#    each real sender under NODE_ENV=test.
pins_missing=""
has_pin() { grep -F -- "$2" "$1" | grep -qvE '^[[:space:]]*(//|#|\*)'; }
for pin in 'process.env.EMAIL_TRANSPORT = "console";' 'process.env.MESSAGING_TRANSPORT = "console";' \
           'process.env.SMTP_USER = "";' \
           'process.env.SMTP_PASS = "";' 'process.env.AI_TRANSPORT = "none";' \
           'process.env.ANTHROPIC_API_KEY = "";'; do
  has_pin tests/setup/env.ts "$pin" || pins_missing="$pins_missing tests/setup/env.ts:'$pin'"
done
for pin in 'MESSAGING_TRANSPORT: "console",' 'EMAIL_TRANSPORT: "console",' 'SMTP_USER: "",' \
           'SMTP_PASS: "",' 'AI_TRANSPORT: "none",' 'ANTHROPIC_API_KEY: "",'; do
  has_pin playwright.config.ts "$pin" || pins_missing="$pins_missing playwright.config.ts:'$pin'"
done
# And a made-up planner integration secret (12J.1), never the one .env may hold.
has_pin tests/setup/env.ts 'process.env.INTEGRATIONS_SECRET = "test-only-integrations-secret-not-for-any-real-use";' ||
  pins_missing="$pins_missing tests/setup/env.ts:INTEGRATIONS_SECRET"
has_pin playwright.config.ts 'INTEGRATIONS_SECRET: "e2e-only-integrations-secret-not-for-any-real-use",' ||
  pins_missing="$pins_missing playwright.config.ts:INTEGRATIONS_SECRET"
# And never a real webhook address (12J.2): the console transport for the planner's webhooks.
has_pin tests/setup/env.ts 'process.env.WEBHOOK_TRANSPORT = "console";' ||
  pins_missing="$pins_missing tests/setup/env.ts:WEBHOOK_TRANSPORT"
has_pin playwright.config.ts 'WEBHOOK_TRANSPORT: "console",' ||
  pins_missing="$pins_missing playwright.config.ts:WEBHOOK_TRANSPORT"
# And never a real push service (13.3): the console push sender, and no private VAPID key.
for pin in 'process.env.PUSH_TRANSPORT = "console";' 'process.env.VAPID_PRIVATE_KEY = "";'; do
  has_pin tests/setup/env.ts "$pin" || pins_missing="$pins_missing tests/setup/env.ts:'$pin'"
done
for pin in 'PUSH_TRANSPORT: "console",' 'VAPID_PRIVATE_KEY: "",'; do
  has_pin playwright.config.ts "$pin" || pins_missing="$pins_missing playwright.config.ts:'$pin'"
done
# And demo mode off (16.1; ADR-025): the main runs are a real server's, whatever .env says (only the
# walkthrough's run turns it on, in its own config).
has_pin tests/setup/env.ts 'process.env.DEMO_MODE = "";' ||
  pins_missing="$pins_missing tests/setup/env.ts:DEMO_MODE"
has_pin playwright.config.ts 'DEMO_MODE: "",' ||
  pins_missing="$pins_missing playwright.config.ts:DEMO_MODE"
if [ -n "$pins_missing" ]; then
  echo "FAIL: a test setup no longer keeps a real sender off:$pins_missing"; fail=1
else echo "ok: the test setups keep every real sender off"; fi

# 7. No test reaches Twilio itself: nothing under tests/ imports its SDK (the fake phone and the
#    console transport stand in; How the build is run 3).
if hits=$(grep -rnE "from ['\"]twilio(/[^'\"]*)?['\"]|require\(['\"]twilio(/[^'\"]*)?['\"]\)|import\(['\"]twilio" tests 2>/dev/null); then
  echo "FAIL: a test imports the Twilio SDK:"; echo "$hits"; fail=1
else echo "ok: no test imports the Twilio SDK"; fi

# 8. No code or test file git ignores: an ignore rule meant for something else (secrets/, say)
#    would keep a file out of every commit while this checkout still builds and passes (P5.1).
if hits=$(git ls-files --others --ignored --exclude-standard -- src tests scripts drizzle public); then
  if [ -n "$hits" ]; then
    echo "FAIL: files under src, tests, scripts, drizzle or public that git ignores:"; echo "$hits"; fail=1
  else echo "ok: no code or test file is git-ignored"; fi
else echo "FAIL: couldn't list the git-ignored files"; fail=1; fi

# 9. The finished phases' archive is frozen: its sha256 is pinned (PLAN.md P1.1).
scripts/archive-check.sh || fail=1

exit $fail
