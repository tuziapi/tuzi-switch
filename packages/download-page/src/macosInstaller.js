// This installer is intentionally pinned to the verified release v1.5.7.
export const macosInstallerTag = "v1.5.7";
export const macosInstallerUrl =
  "https://tuziapi.github.io/tuzi-switch/install-macos-v1.5.7.sh";

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

export function macosInstallBootstrap(release, previousInstallers = []) {
  const installer = release?.macosInstaller;
  if (!isMacosInstaller(installer, release)) return "";
  const installers = [...previousInstallers, installer];
  const tags = new Set();
  for (const entry of installers) {
    if (
      !/^v\d+\.\d+\.\d+$/.test(entry.tag) ||
      entry.href !==
        `https://tuziapi.github.io/tuzi-switch/install-macos-${entry.tag}.sh` ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      tags.has(entry.tag)
    )
      throw Error("Invalid or duplicate pinned installer");
    tags.add(entry.tag);
  }
  const routes = installers
    .map(
      (entry) =>
        `    '${entry.tag}'|'${entry.tag.slice(1)}') url='${entry.href}'; sha256='${entry.sha256}' ;;`,
    )
    .join("\n");
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
          printf '%s\\n' '用法：--version ${installer.tag}（仅指定一次）' >&2
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
${routes}
    *) printf '不支持的版本：%s。当前可安装：${[...tags].join(", ")}。\\n' "$version" >&2; exit 2 ;;
  esac
  installer="$(mktemp -t tuzi-install.XXXXXX)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL "$url" -o "$installer"
  printf '%s  %s\\n' "$sha256" "$installer" | shasum -a 256 -c -
  /bin/bash "$installer" "\${args[@]}"
`;
}
