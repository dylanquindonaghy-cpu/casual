#!/usr/bin/env bash
# Lightsail's alarms for ShiftDesk (docs/runbooks.md "Monitoring and alerts (once)"): emails you
# when something's wrong, and again when it's back to normal. They watch from outside the server,
# so "the server is down" still gets through. Run once after deploy/lightsail.sh, on your own
# computer with the AWS CLI logged in; safe to run again (alarms are replaced, the contact kept).
#   - the app server failing its status check (down or unreachable) for 10 minutes;
#   - the app server's CPU above 90% for 15 minutes;
#   - the app server's burst capacity under 20% for 15 minutes (Lightsail's plans are burstable:
#     once it runs out the server is slowed to its baseline, and CPU never reaches 90%);
#   - the database's free storage under 8 GB (a database can't be grown in place: time to plan);
#   - the database's CPU above 90% for 15 minutes.
#
#   bash deploy/alarms.sh you@example.com
# AWS sends that address a confirmation email first: click its link, or no alarm reaches you.
set -euo pipefail

REGION="eu-west-2"
NAME="${SHIFTDESK_NAME:-shiftdesk}"
INSTANCE="${NAME}-app"
DATABASE="${NAME}-db"
EMAIL="${1:-}"

fail() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
aws_ls() { aws lightsail --region "$REGION" "$@"; }
# Does it exist? 0 yes, 1 no; any other error (a deactivated key, no network) stops everything.
exists() {
  local err
  if err="$(aws_ls "$@" 2>&1 >/dev/null)"; then return 0; fi
  [[ "$err" == *NotFoundException* ]] && return 1
  fail "AWS answered with an error (is the CLI key active?): $err"
}

[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] \
  || fail "give the email address to alert: bash deploy/alarms.sh you@example.com"
command -v aws >/dev/null || fail "install the AWS CLI first (docs/runbooks.md, 'Set up AWS (once)')."
aws sts get-caller-identity --region "$REGION" --query Account --output text >/dev/null \
  || fail "the AWS CLI isn't logged in (or its key is deactivated): see docs/runbooks.md 'Set up AWS (once)' step 9."
exists get-instance --instance-name "$INSTANCE" \
  || fail "there's no $INSTANCE in London yet: run deploy/lightsail.sh first."
exists get-relational-database --relational-database-name "$DATABASE" \
  || fail "there's no $DATABASE in London yet: run deploy/lightsail.sh first."

echo "== The email contact ($EMAIL)"
current="$(aws_ls get-contact-methods --protocols Email --query 'contactMethods[0].contactEndpoint' --output text)"
if [[ "$current" != "$EMAIL" ]]; then
  if [[ "$current" != "None" && -n "$current" ]]; then
    aws_ls delete-contact-method --protocol Email >/dev/null
  fi
  aws_ls create-contact-method --protocol Email --contact-endpoint "$EMAIL" >/dev/null
  echo "Added. AWS has sent $EMAIL a confirmation email: click its link."
else
  status="$(aws_ls get-contact-methods --protocols Email --query 'contactMethods[0].status' --output text)"
  if [[ "$status" == "Valid" ]]; then
    echo "Already there, and confirmed."
  else
    # Not confirmed yet (the first email missed): send the link again.
    aws_ls send-contact-method-verification --protocol Email >/dev/null
    echo "Not confirmed yet: AWS has sent $EMAIL the confirmation link again. Click it."
  fi
fi

# One alarm: name, what it watches, the metric, the comparison and threshold, and over how many
# 5-minute periods (all of them must breach).
alarm() {
  local name="$1" resource="$2" metric="$3" comparison="$4" threshold="$5" periods="$6" missing="$7"
  aws_ls put-alarm \
    --alarm-name "$name" \
    --monitored-resource-name "$resource" \
    --metric-name "$metric" \
    --comparison-operator "$comparison" \
    --threshold "$threshold" \
    --evaluation-periods "$periods" \
    --datapoints-to-alarm "$periods" \
    --treat-missing-data "$missing" \
    --contact-protocols Email \
    --notification-triggers ALARM OK \
    --notification-enabled >/dev/null
  echo "$name"
}

echo "== The alarms"
# No data from a status check means the server isn't reporting: treat it as down.
alarm "${NAME}-app-down" "$INSTANCE" StatusCheckFailed GreaterThanOrEqualToThreshold 1 2 breaching
alarm "${NAME}-app-cpu" "$INSTANCE" CPUUtilization GreaterThanThreshold 90 3 notBreaching
alarm "${NAME}-app-burst" "$INSTANCE" BurstCapacityPercentage LessThanThreshold 20 3 notBreaching
alarm "${NAME}-db-storage" "$DATABASE" FreeStorageSpace LessThanThreshold 8589934592 1 notBreaching
alarm "${NAME}-db-cpu" "$DATABASE" CPUUtilization GreaterThanThreshold 90 3 notBreaching
echo "Done. Lightsail -> the server (or database) -> Metrics shows them."
