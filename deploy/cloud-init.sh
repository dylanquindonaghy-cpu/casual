#!/bin/sh
# First boot of the ShiftDesk app server (pasted into the host's "user data" or "cloud-init" box
# when the server is created: docs/runbooks.md "Set up the server (once)"). Runs once, as root,
# before anyone logs in. Plain POSIX sh on purpose: some hosts put their own sh script in front of
# it, so it can run under dash, which on Ubuntu 24.04 has no "pipefail" (so no pipes here).
#   - security updates now, and automatically from then on (unattended-upgrades), with a reboot at
#     02:30 UTC when one needs it (the app's containers restart on their own: the deploy task);
#   - Docker and its compose plugin, from Docker's own repository;
#   - /opt/shiftdesk, readable by root only, for the compose file and the .env with the secrets
#     (the deploy task puts them there; nothing secret is in this file).
# Check it finished: sudo cloud-init status --long (says "done"); the log is
# /var/log/cloud-init-output.log.
set -eu
export DEBIAN_FRONTEND=noninteractive
# apt waits up to 10 minutes for the dpkg lock (first boot's own updates often hold it).
APT="apt-get -y -o DPkg::Lock::Timeout=600"

$APT update
$APT upgrade
$APT install ca-certificates curl unattended-upgrades

# Security updates every day, on their own.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat >/etc/apt/apt.conf.d/52shiftdesk-upgrades <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "02:30";
CONF

# Docker, from Docker's own apt repository (docs.docker.com/engine/install/ubuntu).
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  >/etc/apt/sources.list.d/docker.list
$APT update
$APT install docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

# Where the app lives: root only.
install -d -m 0700 -o root -g root /opt/shiftdesk
