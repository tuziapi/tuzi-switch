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
export function parseInstallerVersion(value: string): number[] {
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
  const a = parseInstallerVersion(remote),
    b = parseInstallerVersion(local);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export interface InstallerRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  body?: string | null;
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
    !["tuziapi/tuzi-switch", "AiW520/tuzi-switch"].includes(repository) ||
    r.draft !== false ||
    r.prerelease !== false ||
    !/^v\d+\.\d+\.\d+$/.test(r.tag_name) ||
    r.html_url !==
      `https://github.com/${repository}/releases/tag/${r.tag_name}` ||
    !Number.isFinite(Date.parse(r.published_at)) ||
    (r.body != null && typeof r.body !== "string") ||
    !Array.isArray(r.assets)
  )
    throw Error("Invalid installer release");
  parseInstallerVersion(r.tag_name);
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
  parseInstallerVersion(currentVersion);
  const release = await fetchInstallerRelease(build, timeout);
  return installerUpdateFromRelease(build, currentVersion, release, timeout);
}

export async function fetchInstallerRelease(
  build: UpdateBuildInfo,
  timeout: number,
): Promise<InstallerRelease> {
  if (
    !["tuziapi/tuzi-switch", "AiW520/tuzi-switch"].includes(build.repository) ||
    !installers[build.platform]
  )
    throw Error("Unsupported installer channel or platform");
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
}

export function installerUpdateFromRelease(
  build: UpdateBuildInfo,
  currentVersion: string,
  release: InstallerRelease,
  _timeout: number,
): Awaited<ReturnType<typeof checkInstallerUpdate>> {
  validateInstallerRelease(release, build.repository);
  if (!installers[build.platform])
    throw Error("Unsupported installer platform");
  if (
    release.assets.some(
      (asset) => asset.name === "latest.json" || asset.name.endsWith(".sig"),
    )
  )
    throw Error("Signed releases require the native updater");
  if (!isNewerInstallerVersion(release.tag_name, currentVersion))
    return { status: "up-to-date" };
  // Opening a browser is not an install. Keep the exact validated version from
  // the displayed notes; another /latest lookup only adds a network failure
  // point and can reject a perfectly valid pinned download after a new release.
  // A withdrawn asset is handled by GitHub, never by switching to another URL.
  const downloadUrl = release.assets.find(
    (asset) => asset.name === installers[build.platform],
  )!.browser_download_url;
  const releaseUrl = release.html_url;
  const openUrl = async (url: string) => {
    try {
      const opened = await invoke("open_external", { url });
      if (opened === false) throw Error("Browser did not open");
    } catch (cause) {
      const detail =
        cause instanceof Error
          ? cause.message
          : typeof cause === "string"
            ? cause
            : "Unknown system error";
      throw Error(
        `系统未能打开浏览器。可以复制下载链接，在浏览器中粘贴打开。\n系统信息：${detail.slice(0, 240)}`,
      );
    }
  };
  const openDownload = async () => {
    await openUrl(downloadUrl);
  };
  return {
    status: "available",
    info: {
      currentVersion,
      availableVersion: release.tag_name.slice(1),
      notes: release.body ?? undefined,
      pubDate: release.published_at,
      channel: "stable",
      releaseUrl: release.html_url,
    },
    update: {
      version: release.tag_name.slice(1),
      notes: release.body ?? undefined,
      date: release.published_at,
      manual: true,
      downloadUrl,
      openDownloadPage: () => openUrl(releaseUrl),
      downloadAndInstall: openDownload,
      download: openDownload,
    },
  };
}
