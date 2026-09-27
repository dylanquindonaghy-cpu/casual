#!/usr/bin/env bash
# Project invariants, run by scripts/verify.sh. Exit non-zero on any failure.
# Phase 1 adds: RLS enabled with a policy on every firm-scoped table.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
fail=0

# 1. No focused or skipped tests (they silently shrink the suite).
if hits=$(grep -rnE '\b(it|test|describe)\.(only|skip)\(|\bx(it|describe)\(|\bf(it|describe)\(' tests src 2>/dev/null); then
  echo "FAIL: focused/skipped tests found:"; echo "$hits"; fail=1
else echo "ok: no .only/.skip in tests"; fi

# 2. No env files tracked or staged, other than .env.example.
if hits=$( { git ls-files; git ls-files --others --exclude-standard; } | grep -E '(^|/)\.env' | grep -v '^\.env\.example$'); then
  echo "FAIL: env files would be committed:"; echo "$hits"; fail=1
else echo "ok: no .env files tracked"; fi

exit $fail
