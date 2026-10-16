#!/usr/bin/env bash
# Before each shell command (audit L1): keep a copy of PLAN.md and whether a passing verify stamp
# (browser tests included) matched the files, for plan-bash-check.sh to compare after it. And
# while a tick made from the shell without verifying is outstanding (.claude/state/unverified-tick),
# refuse `git commit` and `git push`. The marker clears itself once those tasks are unticked again
# or verify has passed on the files as they are.
input=$(cat)
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/PLAN.md" ] || exit 0
state="$root/.claude/state"
mkdir -p "$state/plan-snap"
marker="$state/unverified-tick"

if [ -f "$marker" ]; then
  still=""
  while IFS= read -r task; do
    [ -z "$task" ] && continue
    grep -Fq -- "$task" <(grep -E '^\s*([-*+]|[0-9]+[.)])\s+\[[xX]\]' "$root/PLAN.md") && still="$still$task"$'\n'
  done < "$marker"
  if [ -z "$still" ] || "$root/.claude/hooks/stamp-check.sh" >/dev/null 2>&1; then
    rm -f "$marker"
  else
    cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
    if echo "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(commit|push)\b'; then
      jq -n --arg r "PLAN.md has a task ticked from the shell without a passing verify (browser tests included): $(head -n 1 "$marker"). Untick it, or run RUN_E2E=1 ./scripts/verify.sh, before committing or pushing." \
        '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
      exit 0
    fi
  fi
fi

id=$(echo "$input" | jq -r '.tool_use_id // "last"' | tr -cd 'A-Za-z0-9_-')
cp "$root/PLAN.md" "$state/plan-snap/$id.md"
git -C "$root" rev-parse HEAD > "$state/plan-snap/$id.head" 2>/dev/null
if "$root/.claude/hooks/stamp-check.sh" >/dev/null 2>&1; then echo valid; else echo invalid; fi > "$state/plan-snap/$id.stamp"
exit 0
