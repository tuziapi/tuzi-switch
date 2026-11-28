#!/bin/bash
  set -e
  version="${TUZI_SWITCH_TAG:-v1.6.5}"
  args=()
  version_seen=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        if [ "$version_seen" = true ] || [ "$#" -lt 2 ] || [ -z "$2" ]; then
          printf '%s\n' '用法：--version v1.6.5（仅指定一次）' >&2
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
    'v1.6.2'|'1.6.2') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.6.2.sh'; sha256='7bf1dc2fc7d4dcbcc7f5345823339f71c5ba73b2a69c1cd48991464ca0d9fb21' ;;
    'v1.6.3'|'1.6.3') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.6.3.sh'; sha256='751f67c81c0c5a3de8135216c155f3aadb5e473c37664487da8735d7c08a6be8' ;;
    'v1.6.4'|'1.6.4') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.6.4.sh'; sha256='4c77e510261179671a58cbb86ee19c9c98207c08cb576046195affcdd4b8a3de' ;;
    'v1.6.5'|'1.6.5') url='https://tuziapi.github.io/tuzi-switch/install-macos-v1.6.5.sh'; sha256='479b21d8a2e0ba3907ba42b48573dcf7e1a2f09fdd1b090b2e7b1bed9ded6976' ;;
    *) printf '不支持的版本：%s。当前可安装：v1.5.5, v1.5.6, v1.5.7, v1.6.0, v1.6.1, v1.6.2, v1.6.3, v1.6.4, v1.6.5。\n' "$version" >&2; exit 2 ;;
  esac
  installer="$(mktemp -t tuzi-install.XXXXXX)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL "$url" -o "$installer"
  printf '%s  %s\n' "$sha256" "$installer" | shasum -a 256 -c -
  /bin/bash "$installer" "${args[@]}"
