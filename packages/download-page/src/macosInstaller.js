// This installer is intentionally pinned to the already published v1.5.5.
export const macosInstallerTag = "v1.5.5";
export const macosInstallerUrl =
  "https://tuziapi.github.io/tuzi-switch/install-macos-v1.5.5.sh";

export function isMacosInstaller(installer, release) {
  return (
    release?.repository === "tuziapi/tuzi-switch" &&
    release.tag === macosInstallerTag &&
    installer?.tag === release.tag &&
    installer.href === macosInstallerUrl &&
    /^[a-f0-9]{64}$/.test(installer.sha256)
  );
}

export const macosBootstrapUrl =
  "https://tuziapi.github.io/tuzi-switch/install.sh";

export function macosInstallCommand(release, { pinned = false } = {}) {
  if (!isMacosInstaller(release?.macosInstaller, release)) return "";
  return `(s=$(curl -fsSL ${macosBootstrapUrl}) && bash -c "$s"${pinned ? ` -- --version ${release.tag}` : ""})`;
}

export function macosInstallBootstrap(release) {
  const installer = release?.macosInstaller;
  if (!isMacosInstaller(installer, release)) return "";
  // Download to a private temporary file; never execute a partial download.
  // Verify the script itself as well as the DMG checksums embedded in it.
  return `#!/bin/bash
  set -e
  version="\${TUZI_SWITCH_TAG:-${installer.tag}}"
  args=()
  version_seen=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        if [ "$version_seen" = true ] || [ "$#" -lt 2 ] || [ -z "$2" ]; then
          printf '%s\\n' '用法：--version v1.5.5（仅指定一次）' >&2
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
    '${installer.tag}'|'${installer.tag.slice(1)}') ;;
    *) printf '不支持的版本：%s。当前可安装：${installer.tag}。\\n' "$version" >&2; exit 2 ;;
  esac
  installer="$(mktemp -t tuzi-install)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL '${installer.href}' -o "$installer"
  printf '%s  %s\\n' '${installer.sha256}' "$installer" | shasum -a 256 -c -
  /bin/bash "$installer" "\${args[@]}"
`;
}
