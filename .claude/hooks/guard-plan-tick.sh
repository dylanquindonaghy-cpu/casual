#!/usr/bin/env bash
# Blocks any Edit/Write that adds a new "[x]" to PLAN.md unless scripts/verify.sh passed on the
# CURRENT working tree. Other PLAN.md edits (parking lot, hours log, notes) pass through.
input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')
case "$file" in *PLAN.md) ;; *) exit 0 ;; esac

old=$(echo "$input" | jq -r '.tool_input.old_string // ""')
new=$(echo "$input" | jq -r '.tool_input.new_string // .tool_input.content // ""')
# MultiEdit: concatenate all edits
if echo "$input" | jq -e '.tool_input.edits' >/dev/null 2>&1; then
  old=$(echo "$input" | jq -r '[.tool_input.edits[].old_string] | join("\n")')
  new=$(echo "$input" | jq -r '[.tool_input.edits[].new_string] | join("\n")')
fi
count() { printf '%s' "$1" | grep -o '\[x\]' | wc -l | tr -d ' '; }
before=$(count "$old"); after=$(count "$new")
# Full-file Write: compare against the file on disk
if [ -z "$old" ] && [ -f "$file" ]; then before=$(grep -o '\[x\]' "$file" | wc -l | tr -d ' '); fi
[ "$after" -le "$before" ] && exit 0

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}
root=$(git rev-parse --show-toplevel 2>/dev/null) || deny "Not a git repo; cannot verify. Do not tick tasks."
state="$root/.claude/state/verified.json"
[ -f "$state" ] || deny "Cannot tick a task: scripts/verify.sh has never run. Run /close-task."
[ "$(jq -r '.ok' "$state")" = "true" ] || deny "Cannot tick a task: the last verify run FAILED. Fix the failures and run /close-task."
[ "$(jq -r '.tree' "$state")" = "$("$root/.claude/hooks/tree-hash.sh")" ] || deny "Cannot tick a task: files changed since the last passing verify. Run /close-task again."
exit 0
