#!/usr/bin/env bash
# Disposable Fedora: real RPM dependencies, user permissions and installed UI.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${GITHUB_REPOSITORY:-}" = AiW520/tuzi-switch
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test -f /base/tuzi-assistant-linux-x64.rpm
test -f /target/tuzi-assistant-linux-x64.rpm
dnf install -y python3 xorg-x11-server-Xvfb webkit2gtk4.1 '*/WebKitWebDriver' \
  gtk3 libappindicator-gtk3 librsvg2 openssl sudo shadow-utils dbus-x11 \
  ImageMagick iptables-nft google-noto-sans-cjk-fonts desktop-file-utils procps-ng
# Resolve and install genuine package dependencies; never use --nodeps.
dnf install -y /base/tuzi-assistant-linux-x64.rpm
useradd --create-home --shell /bin/bash tuziupgrade
install -d -m 0755 /lab/evidence
install -d -m 0700 -o tuziupgrade -g tuziupgrade /lab/runtime
cat /etc/os-release > /lab/evidence/runtime-os-release.txt
iptables -I OUTPUT 1 -m owner --uid-owner tuziupgrade ! -d 127.0.0.0/8 -j REJECT
ip6tables -I OUTPUT 1 -m owner --uid-owner tuziupgrade ! -d ::1 -j REJECT
! command -v zenity
! command -v kdialog
python3 scripts/signed-linux-upgrade.py /base /target /lab/evidence rpm
