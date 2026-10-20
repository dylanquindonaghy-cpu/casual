#!/usr/bin/env bash
# Loads the made-up demo afresh on a demo server (16.2; docs/runbooks.md "A demo server"): run by
# hand the first time (it also starts everything), then every night by shiftdesk-demo-reset.timer,
# so the demo's dates stay current (the seed dates its shifts from today) and what visitors did is
# cleared. From /opt/shiftdesk:
#   - refuses on a server without docker-compose.demo.yml in COMPOSE_FILE (not a demo server);
#   - never while a deploy runs (deploy.sh's lock; it waits up to 15 minutes for one to end);
#   - stops the web app and the worker, runs the demo-reset step (scripts/demo-reset.ts: it refuses
#     unless demo mode, a database on this server and only the made-up demo firms), then starts
#     everything again and waits until it's healthy, whether or not the reset worked (a refused
#     reset leaves the demo as it was).
set -euo pipefail
cd "$(dirname "$0")"

exec 9>"${SHIFTDESK_LOCK:-/run/lock/shiftdesk-deploy.lock}"
flock -w 900 9 || { echo "A deploy has been running for 15 minutes: the demo wasn't reset." >&2; exit 1; }

compose=(docker compose)
if ! services="$("${compose[@]}" --profile demo-reset config --services)"; then
  echo "Docker Compose couldn't read the settings (see above): a value missing in .env?" >&2
  exit 1
fi
if ! grep -qx demo-reset <<<"$services"; then
  echo "Not a demo server: .env needs COMPOSE_FILE=docker-compose.yml:docker-compose.demo.yml (deploy/env.demo.example)." >&2
  exit 1
fi

"${compose[@]}" stop web worker
status=0
"${compose[@]}" run --rm demo-reset || status=$?
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 180 || status=$?
if [[ "$status" -ne 0 ]]; then
  echo "The demo reset didn't finish (see above)." >&2
  exit "$status"
fi
echo "The demo is loaded afresh."
