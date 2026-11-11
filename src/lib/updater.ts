import { checkAcceptanceUpdate, getUpdateBuildInfo } from "./acceptanceUpdater";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  fetchInstallerRelease,
  installerUpdateFromRelease,
  isNewerInstallerVersion,
  parseInstallerVersion,
} from "./installerUpdater";
import { hasSignedRelease, validateSignedRelease } from "./signedRelease";

// 可选导入：在未注册插件或非 Tauri 环境下，调用时会抛错，外层需做兜底
// 我们按需加载并在运行时捕获错误，避免构建期类型问题
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Update } from "@tauri-apps/plugin-updater";
import {
  GITHUB_LATEST_RELEASE_API,
  RELEASES_URL,
} from "@/lib/releaseRepository";

export type UpdateChannel = "stable" | "beta";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "upToDate"
  | "error";

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string;
  notes?: string;
  pubDate?: string;
  channel?: "stable" | "acceptance";
  releaseUrl?: string;
}

export interface UpdateProgressEvent {
  event: "Started" | "Progress" | "Finished";
  total?: number;
  downloaded?: number;
}

export interface UpdateHandle {
  version: string;
  notes?: string;
  date?: string;
  manual?: boolean;
  // Validated, version-pinned manual links. Never used by signed updates.
  downloadUrl?: string;
  openDownloadPage?: () => Promise<void>;
  downloadAndInstall: (
    onProgress?: (e: UpdateProgressEvent) => void,
  ) => Promise<void>;
  download?: (onProgress?: (e: UpdateProgressEvent) => void) => Promise<void>;
  close?: () => Promise<void>;
  install?: () => Promise<void>;
}

export interface CheckOptions {
  timeout?: number;
  channel?: UpdateChannel;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  message: string,
): Promise<T> {
  let timer: number | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeout);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  });
}

export function mapUpdateHandle(raw: Update): UpdateHandle {
  const progress =
    (onProgress?: (e: UpdateProgressEvent) => void) =>
    (evt: import("@tauri-apps/plugin-updater").DownloadEvent) => {
      onProgress?.({
        event: evt.event,
        ...(evt.event === "Started"
          ? { total: evt.data.contentLength ?? 0, downloaded: 0 }
          : {}),
        ...(evt.event === "Progress"
          ? { downloaded: evt.data.chunkLength }
          : {}),
      });
    };
  return {
    version: raw.version ?? "",
    notes: raw.body,
    date: raw.date,
    downloadAndInstall: (onProgress) =>
      raw.downloadAndInstall(progress(onProgress)),
    // download resolves only after the native updater verifies the signature.
    download: (onProgress) =>
      raw.download(progress(onProgress), { timeout: 600_000 }),
    install: () => raw.install(),
    close: () => raw.close(),
  };
}

function parseVersionParts(version: string): [number, number, number] {
  const core = version.replace(/^v/i, "").split("-")[0] ?? "";
  const [major, minor, patch] = core.split(".");
  return [
    Number.parseInt(major ?? "0", 10) || 0,
    Number.parseInt(minor ?? "0", 10) || 0,
    Number.parseInt(patch ?? "0", 10) || 0,
  ];
}

function compareVersions(a: string, b: string): number {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export async function openReleasePage(version?: string): Promise<void> {
  const tag = version
    ? version.startsWith("v")
      ? version
      : `v${version}`
    : "";
  const url = tag ? `${RELEASES_URL}/tag/${tag}` : RELEASES_URL;
  await invoke("open_external", { url });
}

async function checkGitHubReleaseFallback(
  currentVersion: string,
  timeout: number,
): Promise<
  | { status: "up-to-date" }
  | { status: "available"; info: UpdateInfo; update: UpdateHandle }
> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `GitHub release metadata unavailable: ${response.status}`,
      );
    }

    const release = (await response.json()) as GitHubRelease;
    const availableVersion = release.tag_name?.replace(/^v/i, "") ?? "";
    if (
      !availableVersion ||
      compareVersions(availableVersion, currentVersion) <= 0
    ) {
      return { status: "up-to-date" };
    }

    const info: UpdateInfo = {
      currentVersion,
      availableVersion,
      notes: release.body ?? release.name,
      pubDate: release.published_at,
    };
    const update: UpdateHandle = {
      version: availableVersion,
      notes: info.notes,
      date: info.pubDate,
      manual: true,
      async downloadAndInstall() {
        await openReleasePage(availableVersion);
      },
      download: async () => {
        await openReleasePage(availableVersion);
      },
      install: async () => {
        await openReleasePage(availableVersion);
      },
    };

    return { status: "available", info, update };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getCurrentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "";
  }
}

export async function checkForUpdate(
  opts: CheckOptions = {},
): Promise<
  | { status: "up-to-date" }
  | { status: "available"; info: UpdateInfo; update: UpdateHandle }
> {
  const timeout = opts.timeout ?? 30000;
  const build = await withTimeout(
    getUpdateBuildInfo(),
    timeout,
    "Get update build identity timed out",
  );
  if (build.channel === "acceptance")
    return checkAcceptanceUpdate(build, timeout);
  if (build.channel !== "stable") throw new Error("Unknown update channel");
  const currentVersion = await withTimeout(
    getCurrentVersion(),
    timeout,
    "Get current app version timed out",
  ).catch(() => "");

  if (build.repository === "tuziapi/tuzi-switch") {
    // Release discovery prevents stale manifests from silently hiding new versions.
    parseInstallerVersion(currentVersion);
    const release = await fetchInstallerRelease(build, timeout);
    if (!isNewerInstallerVersion(release.tag_name, currentVersion))
      return { status: "up-to-date" };
    if (!hasSignedRelease(release))
      return installerUpdateFromRelease(
        build,
        currentVersion,
        release,
        timeout,
      );

    const { check } = await import("@tauri-apps/plugin-updater");
    let expired = false;
    let native: Update | null = null;
    try {
      native = await withTimeout(
        check({ timeout }).then((update) => {
          if (expired) void update?.close().catch(() => {});
          return update;
        }),
        timeout,
        "正式更新检查超时，请重试。",
      );
      if (
        !native ||
        native.version !== release.tag_name.slice(1) ||
        native.currentVersion !== currentVersion
      )
        throw Error("更新清单与正式版本不一致，请稍后重新检查更新。");
      validateSignedRelease(native.rawJson, release);
      return {
        status: "available",
        info: {
          currentVersion,
          availableVersion: native.version,
          notes: release.body ?? undefined,
          pubDate: release.published_at,
          channel: "stable",
          releaseUrl: release.html_url,
        },
        update: mapUpdateHandle(native),
      };
    } catch (error) {
      expired = true;
      await native?.close().catch(() => {});
      throw error; // A declared signed release never falls back to unsigned installation.
    }
  }

  const integratedChannel = [
    "tuziapi/tuzi-switch",
    "AiW520/tuzi-switch",
  ].includes(build.repository);

  let update: Update | null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    update = await withTimeout(
      check({ timeout } as any),
      timeout,
      "Tauri updater check timed out",
    );
  } catch (error) {
    if (integratedChannel) throw error; // Never silently open a browser or bypass signing.
    console.warn(
      "Tauri updater check failed, falling back to GitHub release",
      error,
    );
    return await checkGitHubReleaseFallback(currentVersion, timeout);
  }
  if (!update) {
    if (integratedChannel) return { status: "up-to-date" };
    return await checkGitHubReleaseFallback(currentVersion, timeout);
  }

  const mapped = mapUpdateHandle(update);
  const info: UpdateInfo = {
    currentVersion,
    availableVersion: mapped.version,
    notes: mapped.notes,
    pubDate: mapped.date,
  };

  return { status: "available", info, update: mapped };
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

// 旧的聚合更新流程已由调用方直接使用 updateHandle 取代
// 如需单函数封装，可在需要时基于 checkForUpdate + updateHandle 复合调用
