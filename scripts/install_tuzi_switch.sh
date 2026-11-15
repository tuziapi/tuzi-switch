#!/usr/bin/env bash
# Compatibility entry point. Install only verified official release assets.
set -euo pipefail
umask 077
REPO="${TUZI_SWITCH_REPO:-tuziapi/tuzi-switch}"
TAG="${TUZI_SWITCH_TAG:-latest}"
[[ "$REPO" == tuziapi/tuzi-switch ]] || { echo 'Only tuziapi/tuzi-switch is supported.' >&2; exit 1; }
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
fetch() { curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL "$@"; }
case "$(uname -s)" in
  Darwin)
    fetch https://tuziapi.github.io/tuzi-switch/install.sh -o "$TMP_DIR/install.sh"
    if [[ "$TAG" == latest ]]; then
      # The official bootstrap selects its published version and checks hashes.
      env -u TUZI_SWITCH_TAG /bin/bash "$TMP_DIR/install.sh" "$@"
    else
      /bin/bash "$TMP_DIR/install.sh" --version "$TAG" "$@"
    fi
    ;;
  Linux)
    VERIFY_ONLY=false
    if [[ $# == 1 && "$1" == --verify-only ]]; then VERIFY_ONLY=true;
    elif [[ $# != 0 ]]; then echo 'Linux accepts only --verify-only.' >&2; exit 1; fi
    case "$(uname -m)" in x86_64|amd64) ;; *) echo 'Only Linux x86_64 is published.' >&2; exit 1 ;; esac
    if [[ "$TAG" == latest ]]; then
      RELEASE_URL=$(fetch -s -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")
      [[ "$RELEASE_URL" == "https://github.com/$REPO/releases/tag/"* ]] || exit 1
      TAG=${RELEASE_URL##*/}
    fi
    [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid release version.' >&2; exit 1; }
    FILE=tuzi-assistant-linux-x64.AppImage
    URL="https://github.com/$REPO/releases/download/$TAG"
    fetch "$URL/SHA256SUMS" -o "$TMP_DIR/SHA256SUMS"
    fetch "$URL/$FILE" -o "$TMP_DIR/$FILE"
    awk -v file="$FILE" '$2 == file && length($1) == 64 && $1 !~ /[^a-f0-9]/ {print; n++} END {if(n != 1) exit 1}' "$TMP_DIR/SHA256SUMS" > "$TMP_DIR/selected.sha256"
    (cd "$TMP_DIR" && sha256sum -c selected.sha256)
    if $VERIFY_ONLY; then printf 'Verified official %s %s\n' "$TAG" "$FILE"; exit 0; fi
    INSTALL_ROOT="$HOME/.local/share/tuzi-switch"
    BIN_ROOT="$HOME/.local/bin"
    mkdir -p "$INSTALL_ROOT" "$BIN_ROOT"
    STAGED=$(mktemp "$INSTALL_ROOT/.tuzi-download.XXXXXX")
    if ! install -m 755 "$TMP_DIR/$FILE" "$STAGED"; then rm -f "$STAGED"; exit 1; fi
    mv -f "$STAGED" "$INSTALL_ROOT/tuzi-switch.AppImage"
    ln -sfn "$INSTALL_ROOT/tuzi-switch.AppImage" "$BIN_ROOT/tuzi-switch"
    printf 'Installed official %s to %s\n' "$TAG" "$INSTALL_ROOT/tuzi-switch.AppImage"
    ;;
  *) echo 'Supported systems: macOS and Linux x86_64.' >&2; exit 1 ;;
esac
