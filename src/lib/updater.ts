import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { track } from "@/lib/analytics";

// 可选导入：在未注册插件或非 Tauri 环境下，调用时会抛错，外层需做兜底
// 我们按需加载并在运行时捕获错误，避免构建期类型问题
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Update } from "@tauri-apps/plugin-updater";

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
  downloadAndInstall: (
    onProgress?: (e: UpdateProgressEvent) => void,
  ) => Promise<void>;
  download?: () => Promise<void>;
  install?: () => Promise<void>;
}

export interface CheckOptions {
  timeout?: number;
  channel?: UpdateChannel;
  source?: "manual" | "automatic";
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
}

const RELEASES_URL = "https://github.com/tuziapi/tuzi-switch/releases";
const GITHUB_LATEST_RELEASE_API =
  "https://api.github.com/repos/tuziapi/tuzi-switch/releases/latest";

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

function mapUpdateHandle(raw: Update): UpdateHandle {
  return {
    version: raw.version ?? "",
    notes: raw.body,
    date: raw.date,
    async downloadAndInstall(onProgress?: (e: UpdateProgressEvent) => void) {
      let downloadFinished = false;
      try {
        await raw.downloadAndInstall((evt) => {
          if (evt.event === "Finished") downloadFinished = true;
          if (!onProgress) return;
          const mapped: UpdateProgressEvent = { event: evt.event };
          if (evt.event === "Started") {
            mapped.total = evt.data.contentLength ?? 0;
            mapped.downloaded = 0;
          } else if (evt.event === "Progress") {
            mapped.downloaded = evt.data.chunkLength;
          }
          onProgress(mapped);
        });
        track("update_action", { action: "download", result: "success" });
        track("update_action", { action: "install", result: "success" });
      } catch (error) {
        track("update_action", {
          action: downloadFinished ? "install" : "download",
          result: "failed",
        });
        throw error;
      }
    },
    download: async () => {
      try {
        await raw.download();
        track("update_action", { action: "download", result: "success" });
      } catch (error) {
        track("update_action", { action: "download", result: "failed" });
        throw error;
      }
    },
    install: async () => {
      try {
        await raw.install();
        track("update_action", { action: "install", result: "success" });
      } catch (error) {
        track("update_action", { action: "install", result: "failed" });
        throw error;
      }
    },
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

async function openReleasePage(version?: string): Promise<void> {
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
  const source = opts.source ?? "manual";
  const currentVersion = await withTimeout(
    getCurrentVersion(),
    timeout,
    "Get current app version timed out",
  ).catch(() => "");

  let update: Update | null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    update = await withTimeout(
      check({ timeout } as any),
      timeout,
      "Tauri updater check timed out",
    );
  } catch (error) {
    console.warn(
      "Tauri updater check failed, falling back to GitHub release",
      error,
    );
    try {
      const result = await checkGitHubReleaseFallback(currentVersion, timeout);
      track("update_action", { action: "check", result: "success", source });
      return result;
    } catch (fallbackError) {
      track("update_action", { action: "check", result: "failed", source });
      throw fallbackError;
    }
  }
  if (!update) {
    try {
      const result = await checkGitHubReleaseFallback(currentVersion, timeout);
      track("update_action", { action: "check", result: "success", source });
      return result;
    } catch (fallbackError) {
      track("update_action", { action: "check", result: "failed", source });
      throw fallbackError;
    }
  }

  const mapped = mapUpdateHandle(update);
  const info: UpdateInfo = {
    currentVersion,
    availableVersion: mapped.version,
    notes: mapped.notes,
    pubDate: mapped.date,
  };

  track("update_action", { action: "check", result: "success", source });
  return { status: "available", info, update: mapped };
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

// 旧的聚合更新流程已由调用方直接使用 updateHandle 取代
// 如需单函数封装，可在需要时基于 checkForUpdate + updateHandle 复合调用
