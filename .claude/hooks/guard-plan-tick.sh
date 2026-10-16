#!/usr/bin/env bash
# Blocks any Edit/Write/MultiEdit that would tick a task in PLAN.md unless scripts/verify.sh
# passed, browser tests included, on the CURRENT working tree. A tick is a task's box going from
# "[ ]" to "[x]" or "[X]", a tick moved from one task to another, or a line added already ticked
# (plan-ticks.mjs; audit L3). Other PLAN.md edits pass through. Shell commands that tick are
# caught by plan-bash-snapshot.sh and plan-bash-check.sh (audit L1).
input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')
case "$file" in *PLAN.md) ;; *) exit 0 ;; esac

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}
root=$(git rev-parse --show-toplevel 2>/dev/null) || deny "Not a git repo; cannot verify. Do not tick tasks."
ticked=$(echo "$input" | node "$root/.claude/hooks/plan-ticks.mjs" edit) ||
  deny "Cannot tell whether this edit ticks a task (plan-ticks.mjs failed), so it is refused."
[ -z "$ticked" ] && exit 0
why=$("$root/.claude/hooks/stamp-check.sh") && exit 0
deny "Cannot tick a task ($(echo "$ticked" | head -n 1)): $why. Run /close-task."
