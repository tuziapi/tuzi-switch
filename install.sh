#!/bin/bash
  set -e
  installer="$(mktemp -t tuzi-install)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL 'https://tuziapi.github.io/tuzi-switch/install-macos-v1.5.5.sh' -o "$installer"
  printf '%s  %s\n' '2728e17ac0fe4f307f8732a13f0843339d20f9bf18675b617646ce7fe228ea7a' "$installer" | shasum -a 256 -c -
  /bin/bash "$installer" "$@"
