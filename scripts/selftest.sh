#!/usr/bin/env bash
# Proves the safety net works on THIS machine before you trust it.
# Run from the project folder: ./scripts/selftest.sh
# It never touches your code. It writes and removes a temporary file under .claude/state/.
set -u
cd "$(dirname "$0")/.." || exit 2
fail=0
pass() { printf 'PASS  %s\n' "$1"; }
failf() { printf 'FAIL  %s\n      %s\n' "$1" "$2"; fail=1; }
warn() { printf 'WARN  %s\n      %s\n' "$1" "$2"; }

# 1. Tools the hooks need
for t in git jq sha256sum grep sed; do
  if command -v "$t" >/dev/null 2>&1; then pass "$t installed"
  else failf "$t missing" "Install it (Ubuntu/WSL: sudo apt install $t   Mac: brew install $t)"; fi
done
# Tools Phase 0 needs (warn only)
for t in node npm docker; do
  command -v "$t" >/dev/null 2>&1 && pass "$t installed" || warn "$t not found" "Needed from Phase 0 onwards, not for the hooks."
done

# 2. Git repo
if git rev-parse --show-toplevel >/dev/null 2>&1; then pass "inside a git repository"
else failf "not a git repository" "Run: git init && git add -A && git commit -m 'starter pack'"; fi

# 3. Hooks executable
for h in scripts/verify.sh .claude/hooks/*.sh .claude/hooks/*.mjs; do
  [ -x "$h" ] && pass "$h is executable" || failf "$h not executable" "Run: chmod +x scripts/*.sh .claude/hooks/*.sh"
done

# 4. settings.json valid
if jq -e '.hooks.PreToolUse and .hooks.Stop' .claude/settings.json >/dev/null 2>&1; then pass ".claude/settings.json is valid and lists the hooks"
else failf ".claude/settings.json invalid" "Re-copy it from the zip."; fi

# Back up any real stamp so the tests below can't destroy it
mkdir -p .claude/state
STATE=.claude/state/verified.json
BACKUP=""
if [ -f "$STATE" ]; then BACKUP=$(mktemp); cp "$STATE" "$BACKUP"; fi
cleanup() { rm -f "$STATE"; [ -n "$BACKUP" ] && mv "$BACKUP" "$STATE"; rm -f "${TRANSCRIPT:-}"; }
trap cleanup EXIT
rm -f "$STATE"

payload() { # $1 old, $2 new
  jq -n --arg f "$PWD/PLAN.md" --arg o "$1" --arg n "$2" \
    '{tool_name:"Edit",tool_input:{file_path:$f,old_string:$o,new_string:$n}}'
}
decision() { # empty output from a hook means "allow"
  local out; out=$(cat)
  if [ -z "$out" ]; then echo allow; else echo "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null; fi
}

# 5. Tick guard: deny a new [x] with no stamp
d=$(payload "- [ ] Some task" "- [x] Some task" | CLAUDE_PROJECT_DIR=$PWD .claude/hooks/guard-plan-tick.sh | decision)
[ "$d" = "deny" ] && pass "tick guard blocks a tick with no verify stamp" || failf "tick guard did NOT block a tick" "Got: '$d'. Check jq works and the hook runs."

# 6. Tick guard: allow an ordinary PLAN.md edit
d=$(payload "## Parking lot" "## Parking lot
- idea: geofence check-in" | CLAUDE_PROJECT_DIR=$PWD .claude/hooks/guard-plan-tick.sh | decision)
[ "$d" = "allow" ] && pass "tick guard allows a normal PLAN.md edit" || failf "tick guard blocked a normal edit" "Got: '$d'"

# 7. Tick guard: deny when the stamp is for different files
printf '{"ok":true,"tree":"0000000000000000","at":"test"}\n' > "$STATE"
d=$(payload "- [ ] Some task" "- [x] Some task" | CLAUDE_PROJECT_DIR=$PWD .claude/hooks/guard-plan-tick.sh | decision)
[ "$d" = "deny" ] && pass "tick guard blocks a stale stamp (files changed since verify)" || failf "tick guard accepted a stale stamp" "Got: '$d'"

# 8. Tick guard: allow when the stamp matches the current tree
h=$(.claude/hooks/tree-hash.sh 2>/dev/null)
if printf '%s' "$h" | grep -Eq '^[0-9a-f]{16}$'; then pass "tree-hash.sh produces a fingerprint ($h)"
else failf "tree-hash.sh failed" "Got: '$h'. Needs git, sha256sum, sort and xargs."; fi
printf '{"ok":true,"tree":"%s","e2e":false,"at":"test"}\n' "$h" > "$STATE"
d=$(payload "- [ ] Some task" "- [x] Some task" | CLAUDE_PROJECT_DIR=$PWD .claude/hooks/guard-plan-tick.sh | decision)
[ "$d" = "deny" ] && pass "tick guard blocks a stamp without the browser tests" || failf "tick guard accepted a stamp without the browser tests" "Got: '$d'"
printf '{"ok":true,"tree":"%s","e2e":true,"at":"test"}\n' "$h" > "$STATE"
d=$(payload "- [ ] Some task" "- [x] Some task" | CLAUDE_PROJECT_DIR=$PWD .claude/hooks/guard-plan-tick.sh | decision)
[ "$d" = "allow" ] && pass "tick guard allows a tick when verify passed, with the browser tests, on these exact files" || failf "tick guard refused a valid stamp" "Got: '$d'. tree-hash.sh may be failing."
rm -f "$STATE"

# 8b. Tick guard: a tick moved from one task to another, or an uppercase [X]
d=$(payload "- [x] Task A
- [ ] Task B" "- [ ] Task A
- [x] Task B" | CLAUDE_PROJECT_DIR=$PWD .claude/hooks/guard-plan-tick.sh | decision)
[ "$d" = "deny" ] && pass "tick guard blocks a tick moved to another task" || failf "tick guard let a moved tick through" "Got: '$d'"
d=$(payload "- [ ] Some task" "- [X] Some task" | CLAUDE_PROJECT_DIR=$PWD .claude/hooks/guard-plan-tick.sh | decision)
[ "$d" = "deny" ] && pass "tick guard blocks an uppercase [X]" || failf "tick guard let an uppercase [X] through" "Got: '$d'"

# 9. Stop hook: block a "done" claim with no stamp
TRANSCRIPT=$(mktemp)
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"The task is now complete and all tests pass."}]}}' > "$TRANSCRIPT"
out=$(jq -n --arg t "$TRANSCRIPT" '{stop_hook_active:false,transcript_path:$t}' | .claude/hooks/stop-unverified-claims.sh)
[ "$(echo "$out" | jq -r '.decision // "allow"' 2>/dev/null)" = "block" ] && pass "stop hook blocks 'task is complete' with no stamp" || failf "stop hook did not block a false 'done' claim" "Got: '$out'"

# 10. Stop hook: allow an honest message
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Typecheck passes. Two tests still fail; not verified yet."}]}}' > "$TRANSCRIPT"
out=$(jq -n --arg t "$TRANSCRIPT" '{stop_hook_active:false,transcript_path:$t}' | .claude/hooks/stop-unverified-claims.sh)
[ -z "$out" ] && pass "stop hook allows an honest 'not verified yet' message" || failf "stop hook blocked an honest message" "Got: '$out'"

# 11. Stop hook: the short ways of saying it
out=$(jq -n '{stop_hook_active:false,session_id:"selftest",last_assistant_message:"Phase 0 is done."}' | .claude/hooks/stop-unverified-claims.sh)
[ "$(echo "$out" | jq -r '.decision // "allow"' 2>/dev/null)" = "block" ] && pass "stop hook blocks 'Phase 0 is done.' with no stamp" || failf "stop hook let 'Phase 0 is done.' through" "Got: '$out'"
rm -f .claude/state/stop-blocks-selftest

# 12. The reviewers and the auditor are read-only
d=$(jq -n '{agent_type:"claims-auditor",tool_name:"Bash",tool_input:{command:"rm -rf src"}}' | node .claude/hooks/readonly-agents.mjs | decision)
[ "$d" = "deny" ] && pass "the auditor can't run a command that writes" || failf "the auditor could run 'rm -rf src'" "Got: '$d'"
d=$(jq -n '{agent_type:"claims-auditor",tool_name:"Bash",tool_input:{command:"git diff HEAD~1 -- src"}}' | node .claude/hooks/readonly-agents.mjs | decision)
[ "$d" = "allow" ] && pass "the auditor can still read a diff" || failf "the auditor can't read a diff" "Got: '$d'"

echo
if [ "$fail" = 0 ]; then echo "SELFTEST PASSED. The safety net works on this machine."
else echo "SELFTEST FAILED. Fix the FAIL lines above before building."; exit 1; fi
