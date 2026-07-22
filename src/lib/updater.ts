import { getVersion } from "@tauri-apps/api/app";
import { compareVersions } from "./version";

export type UpdateChannel = "stable" | "beta";

export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string;
  notes?: string;
  pubDate?: string;
  /** 原生更新清单不可用时，仅提示用户前往 Release 页手动安装。 */
  manual?: boolean;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
}

const GITHUB_LATEST_RELEASE_API =
  "https://api.github.com/repos/tuziapi/tuzi-switch/releases/latest";

function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = globalThis.setTimeout(() => reject(new Error(message)), timeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  });
}

async function checkGitHubReleaseFallback(
  currentVersion: string,
  timeout: number,
): Promise<
  { status: "up-to-date" } | { status: "available"; info: UpdateInfo }
> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`GitHub Release API 返回 ${response.status}`);
    }

    const release = (await response.json()) as GitHubRelease;
    const availableVersion = release.tag_name?.replace(/^v/i, "") ?? "";
    if (
      !availableVersion ||
      compareVersions(availableVersion, currentVersion) <= 0
    ) {
      return { status: "up-to-date" };
    }

    return {
      status: "available",
      info: {
        currentVersion,
        availableVersion,
        notes: release.body ?? release.name,
        pubDate: release.published_at,
        manual: true,
      },
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export interface CheckOptions {
  timeout?: number;
  channel?: UpdateChannel;
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
  { status: "up-to-date" } | { status: "available"; info: UpdateInfo }
> {
  // 动态引入，避免在未安装插件时导致打包期问题
  const { check } = await import("@tauri-apps/plugin-updater");

  const timeout = opts.timeout ?? 30000;
  const currentVersion = await withTimeout(
    getCurrentVersion(),
    timeout,
    "读取当前版本超时",
  ).catch(() => "");
  const canCompareReleaseVersion = currentVersion.length > 0;
  let update;
  let nativeError: unknown = null;
  try {
    update = await withTimeout(
      check({ timeout } as any),
      timeout,
      "原生更新检查超时",
    );
  } catch (error) {
    nativeError = error;
    console.warn(
      "Tauri updater 检查失败，改用 GitHub Release API 发现版本",
      error,
    );
  }

  if (update) {
    const info: UpdateInfo = {
      currentVersion,
      availableVersion: (update as any).version ?? "",
      notes: (update as any).body ?? (update as any).notes,
      pubDate: (update as any).date,
    };

    return { status: "available", info };
  }

  if (!canCompareReleaseVersion) {
    if (nativeError) throw nativeError;
    return { status: "up-to-date" };
  }

  try {
    return await checkGitHubReleaseFallback(currentVersion, timeout);
  } catch (fallbackError) {
    if (nativeError) {
      throw new Error(
        `原生更新清单与 GitHub Release API 均不可用：${String(nativeError)}；${String(fallbackError)}`,
      );
    }
    // 原生更新器已成功确认没有更新；GitHub API 只作为补充发现通道。
    console.warn("GitHub Release API 兜底检查失败", fallbackError);
    return { status: "up-to-date" };
  }
}
