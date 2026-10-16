#!/usr/bin/env bash
# After each shell command (audit L1): did it tick a task in PLAN.md without a passing verify
# stamp (browser tests included) for the files as they were before it? Then record the tasks in
# .claude/state/unverified-tick (plan-bash-snapshot.sh refuses `git commit` and `git push` until
# they're unticked or verified) and tell Claude. Nothing is rewritten here: undoing is Claude's
# job, so a stash, merge or reset can never lose work. Ticks that came in with commits already on
# a remote branch (a pull, or a merge of main) were verified where they were made, and pass.
input=$(cat)
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
state="$root/.claude/state"
id=$(echo "$input" | jq -r '.tool_use_id // "last"' | tr -cd 'A-Za-z0-9_-')
snap="$state/plan-snap/$id"
[ -f "$snap.md" ] || exit 0
cleanup() { rm -f "$snap.md" "$snap.head" "$snap.stamp"; }
trap cleanup EXIT
[ -f "$root/PLAN.md" ] || exit 0

ticked=$(node "$root/.claude/hooks/plan-ticks.mjs" compare "$snap.md" "$root/PLAN.md") || exit 0
[ -z "$ticked" ] && exit 0
[ "$(cat "$snap.stamp" 2>/dev/null)" = "valid" ] && exit 0

head_now=$(git -C "$root" rev-parse HEAD 2>/dev/null)
if [ "$head_now" != "$(cat "$snap.head" 2>/dev/null)" ] &&
   git -C "$root" diff --quiet HEAD -- PLAN.md 2>/dev/null &&
   [ -n "$(git -C "$root" branch -r --contains HEAD 2>/dev/null)" ]; then
  exit 0
fi

printf '%s\n' "$ticked" > "$state/unverified-tick"
jq -n --arg r "That command ticked a task in PLAN.md ($(echo "$ticked" | head -n 1)) without a passing verify (browser tests included) on the files as they were. Untick it now. Ticks go through /close-task: RUN_E2E=1 ./scripts/verify.sh, the claims-auditor, then the Edit tool. git commit and git push are refused until it's unticked or verified." \
  '{decision:"block",reason:$r}'
