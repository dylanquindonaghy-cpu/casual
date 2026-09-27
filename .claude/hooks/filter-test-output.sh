#!/usr/bin/env bash
# When Claude runs the test suite directly, show only failures. Full logs live in .claude/state/.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')
if echo "$cmd" | grep -Eq '^(npm test|npx vitest|npm run test)( |$)'; then
  f="$cmd 2>&1 | grep -E -A 8 '(FAIL|✗|×|Error:|error TS|failed|Tests:)' | head -150; echo '(filtered to failures; full output via scripts/verify.sh logs)'"
  echo "$input" | jq --arg f "$f" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:(.tool_input + {command:$f})}}'
else
  echo "{}"
fi
