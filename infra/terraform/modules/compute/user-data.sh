#!/bin/bash
# The host's first boot: docker, the compose plugin and a swap file, nothing else. The app arrives through the deploy
# document (apply-release.sh), never from here.
set -euo pipefail

dnf install -y docker
systemctl enable --now docker

# Amazon Linux does not package the compose plugin: the release binary, checked against its pinned checksum.
plugin=/usr/libexec/docker/cli-plugins/docker-compose
mkdir -p "$(dirname "$plugin")"
curl -fsSL -o "$plugin" "https://github.com/docker/compose/releases/download/${compose_version}/docker-compose-linux-aarch64"
echo "${compose_sha256}  $plugin" | sha256sum -c -
chmod 755 "$plugin"

# 2 GB of swap: the 1 GB host bends under a memory spike instead of killing a container.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  echo '/swapfile none swap defaults 0 0' >>/etc/fstab
fi
swapon -a
