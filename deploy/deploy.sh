#!/usr/bin/env bash
# Deploys a new ShiftDesk image if there is one (Phase 8; docs/runbooks.md "Deploy"). Runs on the
# server every 2 minutes (deploy/shiftdesk-deploy.timer), from /opt/shiftdesk. Deploys pull rather
# than push: SSH is closed (or open only to the owner's own address), and GitHub Actions only
# builds the image and puts it in GitHub's registry (.github/workflows/deploy.yml). Each run:
#   - never deploys between 05:30 and 09:00 UK time (event mornings), unless run by hand with --now;
#   - pulls the app image for SHIFTDESK_TAG (in .env: "main", the latest, or a git SHA to pin one);
#   - deploys if the running containers aren't on that image (a new one, or a failed deploy to
#     retry): the migration step, then the new version, waiting until it's healthy. A failed
#     migration stops there, leaving the old version running; a new version that doesn't come up
#     healthy is reported as a failure (the unit fails; see journalctl -u shiftdesk-deploy);
#   - otherwise applies any change to .env or docker-compose.yml (Phase 10, audit M8): Docker
#     Compose recreates only the containers whose settings changed and starts a service newly turned
#     on (the worker, with COMPOSE_PROFILES=worker), and changes nothing when nothing changed;
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

# The compose files are .env's choice (COMPOSE_FILE): docker-compose.yml alone, or with
# docker-compose.demo.yml on a demo server (docs/runbooks.md "A demo server"). The app's image is
# every service's but Caddy's and, on a demo server, Postgres'.
compose=(docker compose)
image="$("${compose[@]}" config --images | grep -v -e '^caddy:' -e '^postgres:' | head -n 1)"
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
  # The same image: no migration (the database is already right). `up` below still applies any
  # change to .env or docker-compose.yml: Docker Compose recreates only the containers whose
  # settings changed and starts a service newly turned on (audit M8), and otherwise changes nothing.
  migrate=false
else
  echo "Deploying $image ($target)."
fi
if [[ "$migrate" == true ]]; then
  "${compose[@]}" run --rm migrate
fi
if ! output="$("${compose[@]}" up -d --remove-orphans --wait --wait-timeout 180 2>&1)"; then
  echo "$output" >&2
  if [[ "$up_to_date" == true ]]; then
    echo "No new image, but the app isn't running healthily (see above): a change in .env, or something else (the database?)." >&2
  else
    echo "The new version didn't come up healthy (see above)." >&2
  fi
  exit 1
fi
if [[ "$up_to_date" == true ]]; then
  # Said only when something changed: this runs every 2 minutes.
  if grep -qE 'Creat|Recreat|Start|Remov' <<<"$output"; then
    echo "$output"
    echo "Applied the settings in .env ($image, unchanged)."
  fi
  exit 0
fi
echo "$output"
docker image prune -f >/dev/null
# The commit the image was built from (its label: .github/workflows/deploy.yml), for the runbook's
# checks; "unknown" for an image built without it.
commit="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image" 2>/dev/null || true)"
[[ -n "$commit" && "$commit" != "<no value>" ]] || commit="unknown"
echo "Deployed $image (commit $commit)."
