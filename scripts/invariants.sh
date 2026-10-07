#!/usr/bin/env bash
# Project invariants, run by scripts/verify.sh after the tests. Exit non-zero on any failure.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
fail=0

# 1. No focused or skipped tests (they silently shrink the suite).
if hits=$(grep -rnE '\b(it|test|describe)\.(only|skip|todo|fails|skipIf|runIf)\(|\bx(it|describe)\(|\bf(it|describe)\(|\bctx\.skip\(|\bcontext\.skip\(' tests src 2>/dev/null); then
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

# 5. Only withFirm sets the firm. Nothing else in src may touch app.current_firm_id, except the
#    seed's owner-only firm provisioning (RLS is forced on the owner too, so creating a firm
#    means setting it; ESLint keeps app code from importing src/lib/db/admin).
if hits=$(grep -rnF "app.current_firm_id" src | grep -v -e "^src/lib/db/scoped.ts:" -e "^src/lib/db/admin/seed.ts:"); then
  echo "FAIL: app.current_firm_id used outside src/lib/db/scoped.ts:"; echo "$hits"; fail=1
else echo "ok: only withFirm (and the seed's firm provisioning) set the firm"; fi

# 6. Tests never reach a real outside service (CLAUDE.md conventions): the Vitest setup and the
#    browser tests' servers (serverEnv(), the walkthrough's too) pin every real sender off, since
#    both load .env. A pin only counts on a line that isn't commented out. The settings also refuse
#    each real sender under NODE_ENV=test.
pins_missing=""
has_pin() { grep -F -- "$2" "$1" | grep -qvE '^[[:space:]]*(//|#|\*)'; }
for pin in 'process.env.EMAIL_TRANSPORT = "console";' 'process.env.SMTP_USER = "";' \
           'process.env.SMTP_PASS = "";'; do
  has_pin tests/setup/env.ts "$pin" || pins_missing="$pins_missing tests/setup/env.ts:'$pin'"
done
for pin in 'MESSAGING_TRANSPORT: "console",' 'EMAIL_TRANSPORT: "console",' 'SMTP_USER: "",' \
           'SMTP_PASS: "",'; do
  has_pin playwright.config.ts "$pin" || pins_missing="$pins_missing playwright.config.ts:'$pin'"
done
if [ -n "$pins_missing" ]; then
  echo "FAIL: a test setup no longer keeps a real sender off:$pins_missing"; fail=1
else echo "ok: the test setups keep every real sender off"; fi

exit $fail
