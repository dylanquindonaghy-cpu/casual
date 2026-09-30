#!/usr/bin/env bash
# The monthly restore drill (docs/runbooks.md "Restore drill (monthly)"): proves the database's
# backups can actually be restored, without touching the real database. Restores the latest backup
# (point in time) to a separate, private database, <name>-db-drill; you check it, then delete it.
# On your own computer with the AWS CLI logged in. The drill database costs money while it exists
# (about the same as the real one, by the hour): delete it the same day.
#
# Never restore a real incident under a *-db-drill name, and never point the app at a drill
# database: this script deletes drill databases.
#
#   bash deploy/restore-drill.sh            restore to <name>-db-drill and print its address
#   bash deploy/restore-drill.sh --delete   delete <name>-db-drill (asks you to type its name)
set -euo pipefail

REGION="eu-west-2"
NAME="${SHIFTDESK_NAME:-shiftdesk}"
DATABASE="${NAME}-db"
DRILL="${NAME}-db-drill"
REUSE_HOURS=3

fail() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
aws_ls() { aws lightsail --region "$REGION" "$@"; }
# Is there a database by this name? 0 yes, 1 no. Any other error (a logged-out or deactivated key,
# no network) stops everything: it must never look like "not there".
db_exists() {
  local err
  if err="$(aws_ls get-relational-database --relational-database-name "$1" 2>&1 >/dev/null)"; then
    return 0
  fi
  [[ "$err" == *NotFoundException* ]] && return 1
  fail "AWS answered with an error (is the CLI key active?): $err"
}
created_at() {
  aws_ls get-relational-database --relational-database-name "$1" \
    --query relationalDatabase.createdAt --output text
}

command -v aws >/dev/null || fail "install the AWS CLI first (docs/runbooks.md, 'Set up AWS (once)')."
aws sts get-caller-identity --region "$REGION" --query Account --output text >/dev/null \
  || fail "the AWS CLI isn't logged in (or its key is deactivated): see docs/runbooks.md 'Set up AWS (once)' step 9."

if [[ "${1:-}" == "--delete" ]]; then
  db_exists "$DRILL" || fail "there's no $DRILL to delete."
  echo "$DRILL was created at $(created_at "$DRILL"). Check nothing uses it (the app must never)."
  read -r -p "Type its name to delete it for good ($DRILL): " typed
  [[ "$typed" == "$DRILL" ]] || fail "not deleted."
  aws_ls delete-relational-database --relational-database-name "$DRILL" --skip-final-snapshot >/dev/null
  echo "Deleting $DRILL (a few minutes: Lightsail -> Databases shows it). $DATABASE is untouched."
  exit 0
fi
[[ -z "${1:-}" ]] || fail "unknown option '$1' (use --delete to remove the drill database)."

db_exists "$DATABASE" || fail "there's no $DATABASE in London: run deploy/lightsail.sh first."
if db_exists "$DRILL"; then
  # Only a restore from the last few hours (this drill, run again after a wait) is reused: an older
  # one would test an old backup, and may be in use by mistake.
  created="$(created_at "$DRILL")"
  created_s="$(date -d "$created" +%s 2>/dev/null)" || fail "can't read $DRILL's creation time ($created)."
  if (( $(date +%s) - created_s > REUSE_HOURS * 3600 )); then
    fail "an old drill database from $created exists. Check nothing uses it, then: bash deploy/restore-drill.sh --delete"
  fi
  echo "$DRILL was restored at $created (this drill): using it."
else
  echo "== Restoring the latest backup of $DATABASE to $DRILL (10 to 20 minutes)"
  aws_ls create-relational-database-from-snapshot \
    --relational-database-name "$DRILL" \
    --source-relational-database-name "$DATABASE" \
    --use-latest-restorable-time \
    --no-publicly-accessible \
    --tags key=app,value=shiftdesk key=purpose,value=restore-drill >/dev/null
fi
for _ in $(seq 1 180); do
  state="$(aws_ls get-relational-database --relational-database-name "$DRILL" \
    --query relationalDatabase.state --output text)"
  [[ "$state" == "available" ]] && break
  sleep 10
done
[[ "$state" == "available" ]] || fail "$DRILL isn't ready after 30 minutes (it's '$state'); run this again soon."
host="$(aws_ls get-relational-database --relational-database-name "$DRILL" \
  --query relationalDatabase.masterEndpoint.address --output text)"
cat <<NEXT

$DRILL is ready at $host (private: only the server reaches it). Check it (docs/runbooks.md
"Restore drill (monthly)"), then delete it today:
  bash deploy/restore-drill.sh --delete
NEXT
