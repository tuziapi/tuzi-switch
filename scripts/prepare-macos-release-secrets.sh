#!/usr/bin/env bash

set -euo pipefail

if ! command -v base64 >/dev/null 2>&1; then
  echo "base64 command not found" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm command not found" >&2
  exit 1
fi

WORKDIR="${1:-$PWD/.release-secrets}"
P12_PATH="${2:-}"
TAURI_KEY_PATH="${3:-}"

mkdir -p "$WORKDIR"

echo "Using workdir: $WORKDIR"

if [ -z "$TAURI_KEY_PATH" ]; then
  TAURI_KEY_PATH="$WORKDIR/tauri.key"
  if [ ! -f "$TAURI_KEY_PATH" ]; then
    echo
    echo "Generating Tauri updater key..."
    pnpm tauri signer generate -w "$TAURI_KEY_PATH"
  fi
fi

if [ ! -f "$TAURI_KEY_PATH" ]; then
  echo "Tauri key file not found: $TAURI_KEY_PATH" >&2
  exit 1
fi

TAURI_PRIVATE_KEY_OUTPUT="$WORKDIR/TAURI_SIGNING_PRIVATE_KEY.txt"
cp "$TAURI_KEY_PATH" "$TAURI_PRIVATE_KEY_OUTPUT"

if [ -n "$P12_PATH" ]; then
  if [ ! -f "$P12_PATH" ]; then
    echo "P12 certificate file not found: $P12_PATH" >&2
    exit 1
  fi

  APPLE_CERT_OUTPUT="$WORKDIR/APPLE_CERTIFICATE.base64.txt"
  base64 < "$P12_PATH" | tr -d '\r\n' > "$APPLE_CERT_OUTPUT"
  echo "Wrote Apple certificate base64 to: $APPLE_CERT_OUTPUT"
else
  echo "No .p12 path provided, skipped APPLE_CERTIFICATE export"
fi

echo "Wrote Tauri private key to: $TAURI_PRIVATE_KEY_OUTPUT"
echo
echo "GitHub Secrets you still need to configure manually:"
echo "- TAURI_SIGNING_PRIVATE_KEY: paste contents of $TAURI_PRIVATE_KEY_OUTPUT"
echo "- TAURI_SIGNING_PRIVATE_KEY_PASSWORD: if you set one during key generation"
if [ -n "$P12_PATH" ]; then
  echo "- APPLE_CERTIFICATE: paste contents of $APPLE_CERT_OUTPUT"
  echo "- APPLE_CERTIFICATE_PASSWORD: the password you used when exporting the .p12 file"
fi
echo "- KEYCHAIN_PASSWORD: any strong random password for CI temporary keychain"
echo "- APPLE_ID: your Apple Developer account email"
echo "- APPLE_PASSWORD: app-specific password for notarization"
echo "- APPLE_TEAM_ID: your Apple Developer Team ID"
