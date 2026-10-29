#!/usr/bin/env bash
# The finished phases' archive is frozen (PLAN.md P1.1): its sha256 is pinned here, so any change
# to it fails verify (scripts/invariants.sh runs this) and blocks every tick until it's undone.
# Phases finished later go to a new archive file with a pin of its own, never into this one.
#   scripts/archive-check.sh [file]   (default: docs/archive/plan-done.md; scripts/selftest.sh
#   passes a changed copy to prove a change is caught)
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
ARCHIVE_SHA256=f0e3870287b1bc245e4d37922402c85d662d67674388e527fa6b071adae0bd2c
file=${1:-docs/archive/plan-done.md}
[ -f "$file" ] || { echo "FAIL: $file is missing: it's the frozen archive of finished phases"; exit 1; }
if [ "$(sha256sum "$file" | cut -c1-64)" = "$ARCHIVE_SHA256" ]; then
  echo "ok: the finished phases' archive is unchanged"
else
  echo "FAIL: $file changed: it's frozen (its sha256 is pinned in scripts/archive-check.sh), so undo the change"
  exit 1
fi
