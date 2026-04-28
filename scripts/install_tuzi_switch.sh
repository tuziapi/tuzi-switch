#!/usr/bin/env bash

set -euo pipefail

REPO="${TUZI_SWITCH_GITHUB_REPO:-tuziapi/tuzi-switch}"
TAG="${TUZI_SWITCH_TAG:-}"
DRY_RUN=0
NO_OPEN=0
PREFER_APPIMAGE=0

usage() {
  cat <<'EOF'
Usage: install_tuzi_switch.sh [options]

  --dry-run          Print the download URL and install steps without executing
  --no-open          Do not auto-open the app after installation
  --repo OWNER/REPO  Override GitHub repository (default: tuziapi/tuzi-switch)
  --tag VERSION      Install a specific release tag such as v3.12.17
  --appimage         Prefer AppImage instead of .deb on Linux
  -h, --help         Show this help

Environment variables:
  TUZI_SWITCH_GITHUB_REPO
  TUZI_SWITCH_TAG
  GITHUB_TOKEN
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --no-open) NO_OPEN=1; shift ;;
    --repo)
      REPO="${2:?missing value for --repo}"
      shift 2
      ;;
    --tag)
      TAG="${2:?missing value for --tag}"
      shift 2
      ;;
    --appimage)
      PREFER_APPIMAGE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

command -v curl >/dev/null 2>&1 || {
  echo "curl is required" >&2
  exit 1
}
command -v python3 >/dev/null 2>&1 || {
  echo "python3 is required" >&2
  exit 1
}

if [[ -n "${TAG}" ]]; then
  TAG_NORM="${TAG#v}"
  TAG_NORM="v${TAG_NORM}"
  API_URL="https://api.github.com/repos/${REPO}/releases/tags/${TAG_NORM}"
  RELEASE_MODE="tag"
else
  API_URL="https://api.github.com/repos/${REPO}/releases?per_page=20"
  RELEASE_MODE="list"
fi

CURL_HEADERS=(-H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  CURL_HEADERS+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

log() {
  printf '%s\n' "$*"
}

fetch_release_json() {
  curl -fsSL "${CURL_HEADERS[@]}" "$API_URL"
}

OS=$(uname -s)
ARCH=$(uname -m)
case "${OS}-${ARCH}" in
  Darwin-arm64 | Darwin-aarch64) PLATFORM="darwin-arm64" ;;
  Darwin-x86_64) PLATFORM="darwin-x64" ;;
  Linux-x86_64 | Linux-amd64) PLATFORM="linux-amd64" ;;
  MINGW*-* | MSYS*-* | CYGWIN*-*)
    echo "This shell installer does not support Windows/Git Bash." >&2
    echo "Please download the latest Windows installer from:" >&2
    echo "https://github.com/${REPO}/releases" >&2
    exit 1
    ;;
  *)
    echo "Unsupported platform: ${OS} ${ARCH}" >&2
    echo "Download installers from: https://github.com/${REPO}/releases" >&2
    exit 1
    ;;
esac

RELEASE_JSON=$(fetch_release_json)
TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

REL_JSON="${TMP}/release.json"
printf '%s' "$RELEASE_JSON" > "${REL_JSON}"

DOWNLOAD_URL=$(
  python3 - "${REL_JSON}" "${PLATFORM}" "${PREFER_APPIMAGE}" "${RELEASE_MODE}" <<'PY'
import json
import sys

path, platform, prefer, release_mode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
prefer_appimage = prefer == "1"

with open(path, encoding="utf-8") as f:
    payload = json.load(f)

if release_mode == "tag":
    data = payload
else:
    if not isinstance(payload, list):
        print("Error: unexpected GitHub releases response.", file=sys.stderr)
        sys.exit(1)
    stable = None
    prerelease = None
    for item in payload:
        if item.get("draft"):
            continue
        if item.get("prerelease"):
            if prerelease is None:
                prerelease = item
            continue
        stable = item
        break
    data = stable or prerelease
    if data is None:
        print("Error: no published release found.", file=sys.stderr)
        sys.exit(1)

if data.get("draft"):
    print("Error: release is still a draft.", file=sys.stderr)
    sys.exit(1)

assets = data.get("assets") or []
pairs = [(a["name"], a["browser_download_url"]) for a in assets if a.get("browser_download_url")]

def first(pred):
    for name, url in pairs:
        if pred(name):
            return url
    return None

def pick_darwin_arm64():
    for suffix in (
        "-macOS-unsigned.dmg",
        "-macOS-unsigned.zip",
        "-macOS.dmg",
        "-macOS.zip",
        "_universal.dmg",
        "_aarch64.dmg",
    ):
        url = first(lambda n, s=suffix: n.endswith(s))
        if url:
            return url
    return None

def pick_darwin_x64():
    for suffix in (
        "-macOS-unsigned.dmg",
        "-macOS-unsigned.zip",
        "-macOS.dmg",
        "-macOS.zip",
        "_universal.dmg",
        "_x64.dmg",
        "_x86_64.dmg",
        "_amd64.dmg",
    ):
        url = first(lambda n, s=suffix: n.endswith(s))
        if url:
            return url
    return None

def pick_linux_amd64():
    if not prefer_appimage:
        url = first(lambda n: "x86_64" in n and n.endswith(".deb"))
        if url:
            return url
        url = first(lambda n: "amd64" in n and n.endswith(".deb"))
        if url:
            return url
    for suffix in (".AppImage", ".deb", ".rpm"):
        url = first(lambda n, s=suffix: ("x86_64" in n or "amd64" in n) and n.endswith(s))
        if url:
            return url
    return None

if platform == "darwin-arm64":
    url = pick_darwin_arm64()
elif platform == "darwin-x64":
    url = pick_darwin_x64()
elif platform == "linux-amd64":
    url = pick_linux_amd64()
else:
    url = None

if not url:
    print("Error: no compatible installer found in this release.", file=sys.stderr)
    sys.exit(1)

print(url)
PY
)

FILENAME=$(basename "${DOWNLOAD_URL%%\?*}")
DEST="${TMP}/${FILENAME}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "[dry-run] API: ${API_URL}"
  log "[dry-run] Download: ${DOWNLOAD_URL}"
  log "[dry-run] Save as: ${DEST}"
  log "[dry-run] Platform: ${PLATFORM}"
  exit 0
fi

log "Downloading: ${FILENAME}"
curl -fL --progress-bar -o "${DEST}" "${DOWNLOAD_URL}"

copy_app_bundle() {
  local source="$1"
  local destination="$2"
  if command -v ditto >/dev/null 2>&1; then
    ditto "${source}" "${destination}"
  else
    cp -R "${source}" "${destination}"
  fi
}

install_macos_app_bundle() {
  local app_path="$1"
  local app_name
  app_name=$(basename "${app_path}")
  local target="/Applications/${app_name}"
  local staging="/Applications/.${app_name}.new.$$"
  local backup="/Applications/.${app_name}.backup.$$"

  rm -rf "${staging}" "${backup}"
  log "Preparing staged install for ${target}"
  copy_app_bundle "${app_path}" "${staging}"

  if [[ -e "${target}" ]]; then
    log "Backing up existing app"
    mv "${target}" "${backup}"
  fi

  if ! mv "${staging}" "${target}"; then
    rm -rf "${staging}"
    if [[ -e "${backup}" ]]; then
      mv "${backup}" "${target}" 2>/dev/null || true
    fi
    echo "Error: failed to replace ${target}" >&2
    exit 1
  fi

  rm -rf "${backup}"

  if command -v xattr >/dev/null 2>&1; then
    xattr -cr "${target}" 2>/dev/null || true
  fi

  log "Installed: ${target}"
  if [[ "$NO_OPEN" -eq 0 ]]; then
    open "${target}"
  fi
}

install_macos_dmg() {
  local dmg="$1"
  local mnt
  mnt=$(mktemp -d "${TMP}/mnt.XXXXXX")
  hdiutil attach -nobrowse -quiet -mountpoint "${mnt}" "${dmg}"
  trap 'hdiutil detach -quiet "${mnt}" 2>/dev/null || true; rm -rf "${TMP}"' EXIT

  local app_path
  app_path=$(find "${mnt}" -maxdepth 2 -name "*.app" -print | head -1)
  if [[ -z "${app_path}" ]]; then
    echo "Error: no .app found inside DMG" >&2
    exit 1
  fi

  install_macos_app_bundle "${app_path}"
  hdiutil detach -quiet "${mnt}"
  trap 'rm -rf "${TMP}"' EXIT
}

install_macos_zip() {
  local zip="$1"
  local extract_dir="${TMP}/zip-extract"
  mkdir -p "${extract_dir}"
  unzip -oq "${zip}" -d "${extract_dir}"

  local app_path
  app_path=$(find "${extract_dir}" -maxdepth 2 -name "*.app" -print | head -1)
  if [[ -z "${app_path}" ]]; then
    echo "Error: no .app found inside zip" >&2
    exit 1
  fi

  install_macos_app_bundle "${app_path}"
}

install_linux_deb() {
  local deb="$1"
  if [[ "$(id -u)" -eq 0 ]]; then
    dpkg -i "${deb}" || apt-get install -y -f
  else
    log "Installing .deb via sudo"
    sudo dpkg -i "${deb}" || sudo apt-get install -y -f
  fi
}

install_linux_appimage() {
  local ai="$1"
  chmod +x "${ai}"
  local bin_dir="${HOME}/.local/bin"
  mkdir -p "${bin_dir}"
  local target="${bin_dir}/tuzi-switch.AppImage"
  cp -f "${ai}" "${target}"
  log "Installed AppImage: ${target}"
  if [[ "$NO_OPEN" -eq 0 ]]; then
    if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
      nohup "${target}" >/dev/null 2>&1 &
      log "Launched in background."
    else
      log "No GUI session detected. Run manually: ${target}"
    fi
  fi
}

case "${FILENAME}" in
  *.dmg)
    install_macos_dmg "${DEST}"
    ;;
  *.zip)
    install_macos_zip "${DEST}"
    ;;
  *.deb)
    install_linux_deb "${DEST}"
    ;;
  *.AppImage)
    install_linux_appimage "${DEST}"
    ;;
  *)
    echo "Unsupported installer type: ${FILENAME}" >&2
    exit 1
    ;;
esac
