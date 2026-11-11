#!/bin/bash
  set -e
  version="${TUZI_SWITCH_TAG:-v1.6.1}"
  args=()
  version_seen=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        if [ "$version_seen" = true ] || [ "$#" -lt 2 ] || [ -z "$2" ]; then
          printf '%s\n' '用法：--version v1.6.1（仅指定一次）' >&2
          exit 2
        fi
        version="$2"
        version_seen=true
        shift 2
        ;;
      *) args+=("$1"); shift ;;
    esac
  done
  case "$version" in
    'v1.5.5'|'1.5.5') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.5.5.sh'; sha256='4384f7885226c6cb7c1ea8b797141ad5e7ee542f09cc74ddb9c6d4fb0f7e4b49' ;;
    'v1.5.6'|'1.5.6') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.5.6.sh'; sha256='06c4932d60768acc2bb8f9e7a0929f3c8884b2e054874a154856ca01082b80f6' ;;
    'v1.5.7'|'1.5.7') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.5.7.sh'; sha256='d961d779546e20aa088f0b8b505c1c2b617a1357007dacbb60ae2f4d839a95d8' ;;
    'v1.6.0'|'1.6.0') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.6.0.sh'; sha256='8b815171738be8417163a50cc85e59d59c959275ccc86779b7631e746fe625c3' ;;
    'v1.6.1'|'1.6.1') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.6.1.sh'; sha256='a1cfe907c72f4a5fedb82142d4b204c1eedbb72b884616911fa0f7ff3d388ecf' ;;
    *) printf '不支持的版本：%s。当前可安装：v1.5.5, v1.5.6, v1.5.7, v1.6.0, v1.6.1。\n' "$version" >&2; exit 2 ;;
  esac
  installer="$(mktemp -t tuzi-install.XXXXXX)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL "$url" -o "$installer"
  printf '%s  %s\n' "$sha256" "$installer" | shasum -a 256 -c -
  /bin/bash "$installer" "${args[@]}"
