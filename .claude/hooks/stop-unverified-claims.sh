#!/usr/bin/env bash
# If the final message claims completion but no passing verify (browser tests included) matches
# the current files, refuse to stop and say why (audit L2). A message that says plainly what
# isn't verified passes. A repeated claim is blocked again on the next stop too, up to 3 blocks in
# a row, then let through so a session can never loop.
input=$(cat)
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
state="$root/.claude/state"
mkdir -p "$state"
session=$(echo "$input" | jq -r '.session_id // "session"' | tr -cd 'A-Za-z0-9_-')
count_file="$state/stop-blocks-$session"
active=$(echo "$input" | jq -r '.stop_hook_active // false')
[ "$active" = "true" ] || rm -f "$count_file"

last=$(echo "$input" | jq -r '.last_assistant_message // empty' 2>/dev/null)
if [ -z "$last" ]; then
  transcript=$(echo "$input" | jq -r '.transcript_path // empty')
  [ -f "$transcript" ] || exit 0
  last=$(grep '"role":"assistant"' "$transcript" | tail -n 1 | jq -r '[.message.content[]? | select(.type=="text") | .text] | join(" ")' 2>/dev/null)
fi

claims='task (is )?(now )?complete|implementation (is )?complete|all (the )?([0-9][0-9,]* )?(tests|checks) (are |now )?pass|everything (passes|is green)|marked (it |the task |this )?(as )?done|ready to (merge|ship|deploy)|✅'
claims="$claims|(^|[^[:alnum:]])(is|are|now|all|it'?s|that'?s|everything'?s) (fully |now |all )?(done|complete|completed|finished)([^[:alnum:]]|$)"
claims="$claims|(^|[.!?][[:space:]]+)(done|complete|finished)[.!]"
claims="$claims|(tests|checks) (all )?(now )?(pass|passed|are passing)([^[:alnum:]]|$)"
echo "$last" | grep -Eiq "$claims" || exit 0
# Saying plainly what isn't verified is what the rule asks for.
echo "$last" | grep -Eiq "not (yet )?(been )?verified|unverified|(isn'?t|is not|aren'?t|are not|hasn'?t been|has not been) (yet )?verified" && exit 0

"$root/.claude/hooks/stamp-check.sh" >/dev/null 2>&1 && exit 0

n=$(cat "$count_file" 2>/dev/null || echo 0)
if [ "$n" -ge 3 ]; then rm -f "$count_file"; exit 0; fi
echo $((n + 1)) > "$count_file"
why=$("$root/.claude/hooks/stamp-check.sh")
jq -n --arg why "$why" '{decision:"block",reason:("You claimed completion, but there is no passing verify for the current files (" + $why + "). Either run /close-task now, or reword your message to state plainly what is NOT yet verified.")}'
