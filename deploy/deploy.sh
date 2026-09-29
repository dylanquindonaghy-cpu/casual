#!/usr/bin/env bash
# Deploys a new ShiftDesk image if there is one (Phase 8; docs/runbooks.md "Deploy"). Runs on the
# server every 2 minutes (deploy/shiftdesk-deploy.timer), from /opt/shiftdesk. Deploys pull rather
# than push: SSH is closed to the internet, and GitHub Actions only builds the image and puts it in
# GitHub's registry (.github/workflows/deploy.yml). Each run:
#   - never deploys between 05:30 and 09:00 UK time (event mornings), unless run by hand with --now;
#   - pulls the app image for SHIFTDESK_TAG (in .env: "main", the latest, or a git SHA to pin one);
#   - deploys if the running containers aren't on that image (a new one, or a failed deploy to
#     retry): the migration step, then the new version, waiting until it's healthy. A failed
#     migration stops there, leaving the old version running; a new version that doesn't come up
#     healthy is reported as a failure (the unit fails; see journalctl -u shiftdesk-deploy);
#   - one run at a time.
#
#   ./deploy.sh                  the timer's run
#   ./deploy.sh --now            by hand, also between 05:30 and 09:00 (a fix on an event morning)
#   ./deploy.sh --now --no-migrate   rolling back to an older SHA: its migration step can't run
#                                    against a newer database, and doesn't need to
#   ./deploy.sh --dry-run        says whether it would deploy now, changes nothing
set -euo pipefail
cd "$(dirname "$0")"

dry_run=false
now_anyway=false
migrate=true
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --now) now_anyway=true ;;
    --no-migrate) migrate=false ;;
    *) echo "Unknown option: $arg (use --now, --no-migrate or --dry-run)." >&2; exit 2 ;;
  esac
done

exec 9>"${SHIFTDESK_LOCK:-/run/lock/shiftdesk-deploy.lock}"
flock -n 9 || { echo "Another deploy is running."; exit 0; }

# UK time, as HHMM (SHIFTDESK_NOW stands in for the clock in tests).
now="${SHIFTDESK_NOW:-$(TZ=Europe/London date +%H%M)}"
if [[ "$now_anyway" == false && "$now" > "0529" && "$now" < "0900" ]]; then
  echo "No deploys between 05:30 and 09:00 UK time (event mornings). Trying again after 09:00."
  echo "(A fix that can't wait: ./deploy.sh --now)"
  exit 0
fi
if [[ "$dry_run" == true ]]; then
  echo "Would deploy now if the running version isn't the chosen image."
  exit 0
fi

compose=(docker compose -f docker-compose.yml)
image="$("${compose[@]}" config --images | grep -v '^caddy' | head -n 1)"
"${compose[@]}" pull --quiet web
target="$(docker image inspect --format '{{.Id}}' "$image")"
# What the app's containers are actually running (none: not started, or a failed deploy).
running_ids="$("${compose[@]}" ps --status running --quiet web worker)"
up_to_date=true
[[ -n "$running_ids" ]] || up_to_date=false
for id in $running_ids; do
  [[ "$(docker inspect --format '{{.Image}}' "$id")" == "$target" ]] || up_to_date=false
done
if [[ "$up_to_date" == true ]]; then
  exit 0
fi

echo "Deploying $image ($target)."
if [[ "$migrate" == true ]]; then
  "${compose[@]}" run --rm migrate
fi
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 180
docker image prune -f >/dev/null
echo "Deployed $image."
