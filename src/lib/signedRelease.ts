import type { InstallerRelease } from "./installerUpdater";

const repository = "tuziapi/tuzi-switch";
// Keep aligned with scripts/updater-assets.mjs. Generic aliases support older runtimes.
const targets: Record<string, string> = {
  "darwin-aarch64": "tuzi-assistant-macos-arm64.app.tar.gz",
  "darwin-x86_64": "tuzi-assistant-macos-x64.app.tar.gz",
  "windows-x86_64-nsis": "tuzi-assistant-windows-x64.exe",
  "windows-x86_64-msi": "tuzi-assistant-windows-x64.msi",
  "linux-x86_64-appimage": "tuzi-assistant-linux-x64.AppImage",
  "linux-x86_64-deb": "tuzi-assistant-linux-x64.deb",
  "linux-x86_64-rpm": "tuzi-assistant-linux-x64.rpm",
  "windows-x86_64": "tuzi-assistant-windows-x64.exe",
  "linux-x86_64": "tuzi-assistant-linux-x64.AppImage",
};

function requireAsset(release: InstallerRelease, name: string) {
  const matches = release.assets.filter((asset) => asset?.name === name);
  const asset = matches[0];
  if (
    matches.length !== 1 ||
    asset.state !== "uploaded" ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
    asset.browser_download_url !==
      `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`
  )
    throw Error("正式更新附件不完整或来源不符，请稍后重新检查更新。");
}

/** Manual compatibility is chosen from release contents, never from a signing error. */
export function hasSignedRelease(release: InstallerRelease): boolean {
  const declared = release.assets.some(
    (asset) => asset?.name === "latest.json" || asset?.name?.endsWith(".sig"),
  );
  if (!declared) return false;
  requireAsset(release, "latest.json");
  for (const name of new Set(Object.values(targets))) {
    requireAsset(release, name);
    requireAsset(release, `${name}.sig`);
  }
  return true;
}

/** Validate metadata before exposing a native download. Native download verifies bytes/signature. */
export function validateSignedRelease(
  raw: Record<string, unknown>,
  release: InstallerRelease,
): void {
  if (raw.version !== release.tag_name.slice(1))
    throw Error("更新清单与正式版本不一致，请稍后重新检查更新。");
  const platforms = raw.platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms))
    throw Error("正式更新清单缺少平台信息。");
  const entries = platforms as Record<
    string,
    { url?: unknown; signature?: unknown }
  >;
  if (
    Object.keys(entries).some(
      (target) => !Object.prototype.hasOwnProperty.call(targets, target),
    )
  )
    throw Error("正式更新清单包含未知平台。");
  for (const [target, name] of Object.entries(targets)) {
    const entry = entries[target];
    if (
      !entry ||
      entry.url !==
        `https://github.com/${repository}/releases/download/${release.tag_name}/${name}` ||
      typeof entry.signature !== "string" ||
      !entry.signature.trim()
    )
      throw Error("正式更新清单的来源或签名信息无效。");
  }
}
