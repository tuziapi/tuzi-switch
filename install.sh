#!/bin/bash
  set -e
  version="${TUZI_SWITCH_TAG:-v1.5.6}"
  args=()
  version_seen=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        if [ "$version_seen" = true ] || [ "$#" -lt 2 ] || [ -z "$2" ]; then
          printf '%s\n' '用法：--version v1.5.6（仅指定一次）' >&2
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
    *) printf '不支持的版本：%s。当前可安装：v1.5.5, v1.5.6。\n' "$version" >&2; exit 2 ;;
  esac
  installer="$(mktemp -t tuzi-install.XXXXXX)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL "$url" -o "$installer"
  printf '%s  %s\n' "$sha256" "$installer" | shasum -a 256 -c -
  /bin/bash "$installer" "${args[@]}"
