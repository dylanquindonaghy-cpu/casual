#!/usr/bin/env bash
# If the final message claims completion but verify.sh hasn't passed on the current tree,
# refuse to stop and say why. Guards against "all done" with no evidence.
input=$(cat)
[ "$(echo "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0   # never loop
transcript=$(echo "$input" | jq -r '.transcript_path // empty')
[ -f "$transcript" ] || exit 0
last=$(grep '"role":"assistant"' "$transcript" | tail -n 1 | jq -r '[.message.content[]? | select(.type=="text") | .text] | join(" ")' 2>/dev/null)
echo "$last" | grep -Eiq 'task (is )?(now )?complete|implementation (is )?complete|all (tests|checks) (are )?pass|everything (passes|is green)|marked (it |the task |this )?(as )?done|ready to (merge|ship|deploy)|✅' || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
state="$root/.claude/state/verified.json"
if [ -f "$state" ] && [ "$(jq -r .ok "$state")" = "true" ] && [ "$(jq -r .tree "$state")" = "$("$root/.claude/hooks/tree-hash.sh")" ]; then exit 0; fi
jq -n '{decision:"block",reason:"You claimed completion, but scripts/verify.sh has not passed on the current files. Either run /close-task now, or reword your message to state plainly what is NOT yet verified."}'
