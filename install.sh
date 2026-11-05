#!/bin/bash
  set -e
  version="${TUZI_SWITCH_TAG:-v1.5.5}"
  args=()
  version_seen=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        if [ "$version_seen" = true ] || [ "$#" -lt 2 ] || [ -z "$2" ]; then
          printf '%s\n' '用法：--version v1.5.5（仅指定一次）' >&2
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
    'v1.5.5'|'1.5.5') ;;
    *) printf '不支持的版本：%s。当前可安装：v1.5.5。\n' "$version" >&2; exit 2 ;;
  esac
  installer="$(mktemp -t tuzi-install)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL 'https://tuziapi.github.io/tuzi-switch/install-macos-v1.5.5.sh' -o "$installer"
  printf '%s  %s\n' '2728e17ac0fe4f307f8732a13f0843339d20f9bf18675b617646ce7fe228ea7a' "$installer" | shasum -a 256 -c -
  /bin/bash "$installer" "${args[@]}"
