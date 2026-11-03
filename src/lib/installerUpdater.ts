import { invoke } from "@tauri-apps/api/core";
import type { UpdateBuildInfo } from "./acceptanceUpdater";
import type { UpdateInfo, UpdateHandle } from "./updater";

// MIT client implementation; does not import the AGPL download website.
const installers: Record<string, string> = {
  macos: "tuzi-assistant-macos-arm64.dmg",
  "macos-intel": "tuzi-assistant-macos-x64.dmg",
  windows: "tuzi-assistant-windows-x64.exe",
  linux: "tuzi-assistant-linux-x64.AppImage",
};
function versionParts(value: string): number[] {
  if (!/^v?\d+\.\d+\.\d+$/.test(value)) throw Error("Invalid release version");
  const parts = value.replace(/^v/, "").split(".").map(Number);
  if (!parts.every(Number.isSafeInteger))
    throw Error("Invalid release version");
  return parts;
}
export function isNewerInstallerVersion(
  remote: string,
  local: string,
): boolean {
  const a = versionParts(remote),
    b = versionParts(local);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
interface InstallerRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  assets: {
    name: string;
    browser_download_url: string;
    size: number;
    state: string;
    digest: string;
  }[];
}
export function validateInstallerRelease(
  value: unknown,
  repository: string,
): InstallerRelease {
  const r = value as InstallerRelease;
  if (
    !r ||
    repository !== "AiW520/tuzi-switch" ||
    r.draft !== false ||
    r.prerelease !== false ||
    !/^v\d+\.\d+\.\d+$/.test(r.tag_name) ||
    r.html_url !==
      `https://github.com/${repository}/releases/tag/${r.tag_name}` ||
    !Number.isFinite(Date.parse(r.published_at)) ||
    !Array.isArray(r.assets)
  )
    throw Error("Invalid installer release");
  versionParts(r.tag_name);
  for (const name of Object.values(installers)) {
    const matches = r.assets.filter((a) => a?.name === name);
    const a = matches[0];
    if (
      matches.length !== 1 ||
      a.state !== "uploaded" ||
      !Number.isSafeInteger(a.size) ||
      a.size <= 0 ||
      !/^sha256:[a-f0-9]{64}$/.test(a.digest) ||
      a.browser_download_url !==
        `https://github.com/${repository}/releases/download/${r.tag_name}/${name}`
    )
      throw Error("Missing verified installer");
  }
  return r;
}
export async function checkInstallerUpdate(
  build: UpdateBuildInfo,
  currentVersion: string,
  timeout: number,
): Promise<
  | { status: "up-to-date" }
  | { status: "available"; info: UpdateInfo; update: UpdateHandle }
> {
  versionParts(currentVersion);
  if (build.repository !== "AiW520/tuzi-switch" || !installers[build.platform])
    throw Error("Unsupported installer channel or platform");
  const fetchRelease = async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(
        `https://api.github.com/repos/${build.repository}/releases/latest`,
        {
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/vnd.github+json" },
        },
      );
      if (!response.ok)
        throw Error(`Release metadata unavailable: ${response.status}`);
      return validateInstallerRelease(await response.json(), build.repository);
    } finally {
      window.clearTimeout(timer);
    }
  };
  const release = await fetchRelease();
  if (!isNewerInstallerVersion(release.tag_name, currentVersion))
    return { status: "up-to-date" };
  const openDownload = async () => {
    const current = await fetchRelease();
    if (!isNewerInstallerVersion(current.tag_name, currentVersion))
      throw Error("Update withdrawn; check again");
    const asset = current.assets.find(
      (a) => a.name === installers[build.platform],
    )!;
    await invoke("open_external", { url: asset.browser_download_url });
  };
  return {
    status: "available",
    info: {
      currentVersion,
      availableVersion: release.tag_name.slice(1),
      notes: release.body,
      pubDate: release.published_at,
      channel: "stable",
      releaseUrl: release.html_url,
    },
    update: {
      version: release.tag_name.slice(1),
      notes: release.body,
      date: release.published_at,
      manual: true,
      downloadAndInstall: openDownload,
      download: openDownload,
    },
  };
}
