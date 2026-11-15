#!/usr/bin/env bash
# Disposable Fedora runtime for real rpm installation; no --nodeps or fake rpm.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${GITHUB_REPOSITORY:-}" = AiW520/tuzi-switch
test -n "${LAB_ROOT:-}"
test -f "$LAB_ROOT/app-0.0.1.rpm"
test -f "$LAB_ROOT/app-0.0.2.rpm"

if [[ "${1:-}" == --run ]]; then
  cat /etc/os-release > "$LAB_ROOT/runtime-os-release.txt"
  export DISPLAY=:99
  dbus-update-activation-environment DISPLAY
  Xvfb "$DISPLAY" -screen 0 1280x900x24 -nolisten tcp > "$LAB_ROOT/xvfb.log" 2>&1 &
  display_pid=$!
  trap 'kill "$display_pid" 2>/dev/null || true' EXIT
  python3 - <<'PY'
from pathlib import Path
import time
for _ in range(100):
    if Path('/tmp/.X11-unix/X99').exists():
        break
    time.sleep(0.1)
else:
    raise SystemExit('Virtual display failed to start')
PY
  python3 scripts/native-upgrade-lab.py --installer rpm --skip-build --output "$LAB_ROOT"
  exit
fi

dnf install -y python3 nodejs xorg-x11-server-Xvfb \
  webkit2gtk4.1 gtk3 libappindicator-gtk3 librsvg2 openssl sudo shadow-utils dbus-x11
# Keep the mounted evidence readable by its host runner even after failures.
lab_uid=$(stat -c '%u' "$LAB_ROOT")
test "$lab_uid" -ne 0
useradd --create-home --uid "$lab_uid" --non-unique qa
printf '%s\n' 'qa ALL=(root) NOPASSWD: /usr/bin/rpm' > /etc/sudoers.d/tuzi-updater-lab
chmod 0440 /etc/sudoers.d/tuzi-updater-lab
chown -R qa:qa "$LAB_ROOT"
# Package manager sees the real RPM dependency database in this Fedora system.
# Keep the application unprivileged, including during its genuine restart.
sudo --preserve-env=GITHUB_ACTIONS,GITHUB_REPOSITORY,LAB_ROOT -u qa \
  dbus-run-session -- bash scripts/native-upgrade-rpm-container.sh --run
