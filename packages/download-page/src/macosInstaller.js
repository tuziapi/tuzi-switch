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

export function macosInstallCommand(release) {
  const installer = release?.macosInstaller;
  if (!isMacosInstaller(installer, release)) return "";
  // Download to a private temporary file; never execute a partial download.
  // Verify the script itself as well as the DMG checksums embedded in it.
  return `(
  set -e
  installer="$(mktemp -t tuzi-install)"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fL '${installer.href}' -o "$installer"
  printf '%s  %s\\n' '${installer.sha256}' "$installer" | shasum -a 256 -c -
  /bin/bash "$installer"
)`;
}
