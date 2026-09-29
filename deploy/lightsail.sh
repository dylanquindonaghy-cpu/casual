#!/usr/bin/env bash
# Creates ShiftDesk's servers in AWS Lightsail, London (docs/architecture.md "Deployment";
# docs/runbooks.md "Set up AWS (once)"). Run once, on your own computer (or AWS CloudShell in
# London), with the AWS CLI logged in to your account; safe to run again (it skips what already
# exists). It creates, in eu-west-2:
#   - the app server: Ubuntu 24.04, 2 CPUs and 4 GB (the cheapest such plan), with
#     deploy/cloud-init.sh as its first-boot script;
#   - its firewall, straight away: 80 and 443 open to everyone and nothing else; SSH (22) only from
#     Lightsail's own browser console, never the internet. Then it reads the firewall back and
#     stops if anything else is open;
#   - a static IP attached to it (the address the DNS records point at);
#   - managed Postgres 16 (the cheapest standard plan), not publicly accessible (only Lightsail
#     machines in London reach it), backups each night, master user shiftdesk_owner with a password
#     AWS generates; read back and checked too.
# It shows the monthly prices and asks before creating anything. No password or key is written
# anywhere by this script.
#
# Running it again resets the firewall to exactly the rules above: a rule added by hand (or by a
# deploy set-up) goes. The deploy task must fit these rules (PLAN.md Parking lot, "Connect AWS").
#
#   bash deploy/lightsail.sh
#   SHIFTDESK_NAME=shiftdesk-test bash deploy/lightsail.sh   # a second, separate set
set -euo pipefail

REGION="eu-west-2"
ZONE="eu-west-2a"
NAME="${SHIFTDESK_NAME:-shiftdesk}"
INSTANCE="${NAME}-app"
STATIC_IP="${NAME}-ip"
DATABASE="${NAME}-db"
HERE="$(cd "$(dirname "$0")" && pwd)"

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
aws_ls() { aws lightsail --region "$REGION" "$@"; }
# One value from a JMESPath query; fails when there's none ("None" is the CLI's empty answer).
pick() {
  local value
  value="$(aws_ls "$@" --output text)"
  [[ -n "$value" && "$value" != "None" ]] || fail "AWS had no match for: $*"
  printf '%s' "$value"
}

command -v aws >/dev/null || fail "install the AWS CLI first (docs/runbooks.md, 'Set up AWS (once)')."
aws sts get-caller-identity --region "$REGION" --query Account --output text >/dev/null \
  || fail "the AWS CLI isn't logged in: run 'aws configure' (docs/runbooks.md)."

say "Choosing the plans (looked up: Lightsail renames them now and then)"
BLUEPRINT="$(pick get-blueprints \
  --query "blueprints[?platform=='LINUX_UNIX' && starts_with(blueprintId, 'ubuntu_24_04')].blueprintId | [0]")"
# The cheapest active Linux plan with 2 CPUs and 4 GB (not an IPv6-only one).
BUNDLE_QUERY="sort_by(bundles[?isActive && ramSizeInGb==\`4\` && cpuCount==\`2\` && contains(supportedPlatforms, 'LINUX_UNIX') && !contains(bundleId, 'ipv6')], &price)[0]"
BUNDLE="$(pick get-bundles --query "${BUNDLE_QUERY}.bundleId")"
BUNDLE_PRICE="$(pick get-bundles --query "${BUNDLE_QUERY}.price")"
DB_BLUEPRINT="$(pick get-relational-database-blueprints \
  --query "blueprints[?engine=='postgres' && starts_with(engineVersion, '16.')].blueprintId | [0]")"
# The cheapest active standard (not high-availability) database plan.
DB_QUERY="sort_by(bundles[?isActive && !contains(bundleId, 'ha')], &price)[0]"
DB_BUNDLE="$(pick get-relational-database-bundles --query "${DB_QUERY}.bundleId")"
DB_PRICE="$(pick get-relational-database-bundles --query "${DB_QUERY}.price")"
cat <<PLANS
Server:   $BLUEPRINT on $BUNDLE, \$$BUNDLE_PRICE a month
Database: $DB_BLUEPRINT on $DB_BUNDLE, \$$DB_PRICE a month
(The static IP is free while it's attached. Prices are AWS's, before tax.)
PLANS
read -r -p "Create these in London (anything already there is kept)? Type yes: " answer
[[ "$answer" == "yes" ]] || fail "nothing was created."

say "The app server ($INSTANCE)"
if aws_ls get-instance --instance-name "$INSTANCE" >/dev/null 2>&1; then
  echo "Already there."
else
  aws_ls create-instances \
    --instance-names "$INSTANCE" \
    --availability-zone "$ZONE" \
    --blueprint-id "$BLUEPRINT" \
    --bundle-id "$BUNDLE" \
    --user-data "file://$HERE/cloud-init.sh" \
    --tags key=app,value=shiftdesk >/dev/null
  echo "Created."
fi
for _ in $(seq 1 60); do
  state="$(aws_ls get-instance-state --instance-name "$INSTANCE" --query state.name --output text)"
  [[ "$state" == "running" ]] && break
  sleep 10
done
[[ "$state" == "running" ]] || fail "the server didn't start within 10 minutes (it's '$state')."

say "Its firewall: 80 and 443 for everyone; SSH only from Lightsail's browser console"
# Straight after it starts (Lightsail opens 22 to everyone by default). Replaces every rule.
aws_ls put-instance-public-ports --instance-name "$INSTANCE" --port-infos '[
  {"fromPort": 80, "toPort": 80, "protocol": "tcp", "cidrs": ["0.0.0.0/0"], "ipv6Cidrs": ["::/0"]},
  {"fromPort": 443, "toPort": 443, "protocol": "tcp", "cidrs": ["0.0.0.0/0"], "ipv6Cidrs": ["::/0"]},
  {"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrListAliases": ["lightsail-connect"]}
]' >/dev/null
# Read back what AWS applied: nothing but 80 and 443 may be open to the whole internet.
exposed="$(aws_ls get-instance-port-states --instance-name "$INSTANCE" --output text \
  --query "portStates[?state=='open' && (contains(cidrs || \`[]\`, '0.0.0.0/0') || contains(ipv6Cidrs || \`[]\`, '::/0')) && !(fromPort==\`80\` && toPort==\`80\`) && !(fromPort==\`443\` && toPort==\`443\`)].fromPort")"
[[ -z "$exposed" || "$exposed" == "None" ]] \
  || fail "ports other than 80 and 443 are open to the internet ($exposed). Check the Networking tab."
echo "Done, and checked."

say "Its static IP ($STATIC_IP)"
if ! aws_ls get-static-ip --static-ip-name "$STATIC_IP" >/dev/null 2>&1; then
  aws_ls allocate-static-ip --static-ip-name "$STATIC_IP" >/dev/null
fi
attached="$(aws_ls get-static-ip --static-ip-name "$STATIC_IP" --query staticIp.attachedTo --output text)"
if [[ "$attached" != "$INSTANCE" ]]; then
  aws_ls attach-static-ip --static-ip-name "$STATIC_IP" --instance-name "$INSTANCE" >/dev/null
fi
IP="$(pick get-static-ip --static-ip-name "$STATIC_IP" --query staticIp.ipAddress)"
echo "$IP"

say "The database ($DATABASE): Postgres 16, not public"
if aws_ls get-relational-database --relational-database-name "$DATABASE" >/dev/null 2>&1; then
  echo "Already there."
else
  # Backups at 01:00-01:30 UTC (02:00 UK summer time); upkeep early on Tuesday morning, away from
  # event nights (Friday, Saturday) and event mornings.
  aws_ls create-relational-database \
    --relational-database-name "$DATABASE" \
    --availability-zone "$ZONE" \
    --relational-database-blueprint-id "$DB_BLUEPRINT" \
    --relational-database-bundle-id "$DB_BUNDLE" \
    --master-database-name shiftdesk \
    --master-username shiftdesk_owner \
    --no-publicly-accessible \
    --preferred-backup-window 01:00-01:30 \
    --preferred-maintenance-window Tue:02:00-Tue:02:30 \
    --tags key=app,value=shiftdesk >/dev/null
  echo "Created (it takes 10 to 20 minutes to be ready)."
fi
for _ in $(seq 1 180); do
  db_state="$(aws_ls get-relational-database --relational-database-name "$DATABASE" \
    --query relationalDatabase.state --output text)"
  [[ "$db_state" == "available" ]] && break
  sleep 10
done
[[ "$db_state" == "available" ]] || fail "the database isn't ready after 30 minutes (it's '$db_state'); run this again later."
# Not public and backed up, now (not at the next upkeep), whatever was set by hand before.
aws_ls update-relational-database --relational-database-name "$DATABASE" \
  --enable-backup-retention --no-publicly-accessible --apply-immediately >/dev/null
for _ in $(seq 1 60); do
  settings="$(aws_ls get-relational-database --relational-database-name "$DATABASE" --output text \
    --query "relationalDatabase.[publiclyAccessible, backupRetentionEnabled]")"
  [[ "$settings" == $'False\tTrue' ]] && break
  sleep 10
done
[[ "$settings" == $'False\tTrue' ]] \
  || fail "the database isn't yet private with backups on (public, backups: $settings); run this again in a few minutes."
DB_HOST="$(pick get-relational-database --relational-database-name "$DATABASE" \
  --query relationalDatabase.masterEndpoint.address)"
echo "$DB_HOST (private, backed up: checked)"

say "All there. Next (docs/runbooks.md, 'Set up AWS (once)'):"
cat <<NEXT
1. At your domain's DNS provider, add two A records pointing to $IP:
     your domain itself (e.g. shiftdesk.co.uk)      A  $IP
     every firm under it (*.shiftdesk.co.uk)        A  $IP
2. The database's address is $DB_HOST (only reachable from the server).
   Its password (keep it out of the repo; it goes in the server's .env, see the runbook):
     aws lightsail get-relational-database-master-user-password --region $REGION \\
       --relational-database-name $DATABASE --query masterUserPassword --output text
3. Open the server's browser console: Lightsail -> Instances -> $INSTANCE -> Connect using SSH,
   and check the first boot finished: sudo cloud-init status --long (says "done"), docker --version.
NEXT
