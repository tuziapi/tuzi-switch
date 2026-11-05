import { getIdentifier } from "@tauri-apps/api/app";
import { RELEASE_REPOSITORY } from "./releaseRepository";
import { invoke } from "@tauri-apps/api/core";
import type { UpdateHandle, UpdateInfo } from "./updater";

export interface UpdateBuildInfo {
  channel: "stable" | "acceptance";
  repository: string;
  runNumber: number;
  commit: string;
  platform: string;
}

export async function getUpdateBuildInfo(): Promise<UpdateBuildInfo> {
  try {
    return await invoke<UpdateBuildInfo>("get_update_build_info");
  } catch (error) {
    // Older stable native binaries may receive this renderer through hot update.
    // Only the exact stable app ID can use the legacy semver path.
    if ((await getIdentifier()) === "com.tuziswitch.desktop") {
      return {
        channel: "stable",
        repository: RELEASE_REPOSITORY,
        runNumber: 0,
        commit: "",
        platform: "unsupported",
      };
    }
    throw error;
  }
}

export const ACCEPTANCE_REPOSITORY = "AiW520/tuzi-switch";
export const ACCEPTANCE_DOWNLOAD_PAGE = "https://aiw520.github.io/tuzi-switch/";
export const ACCEPTANCE_MANIFEST_URL =
  "https://raw.githubusercontent.com/AiW520/tuzi-switch/codex/download-pages/release.json";

interface AcceptanceRelease {
  schemaVersion: 1;
  success: true;
  channel: "acceptance";
  repository: string;
  runId: string;
  runNumber: number;
  commit: string;
  tag: string;
  sourceUrl: string;
  publishedAt: string;
  downloads: {
    id: string;
    artifactId: string;
    href: string;
    expiresAt: string;
  }[];
}

// Independent MIT client validator: the standalone website is AGPL licensed.
export function validateAcceptanceRelease(value: unknown): AcceptanceRelease {
  const r = value as AcceptanceRelease;
  const platforms = ["macos", "macos-intel", "windows", "linux"];
  if (
    !r ||
    r.schemaVersion !== 1 ||
    r.success !== true ||
    r.channel !== "acceptance" ||
    r.repository !== ACCEPTANCE_REPOSITORY ||
    typeof r.runId !== "string" ||
    !/^[1-9]\d*$/.test(r.runId) ||
    !Number.isSafeInteger(r.runNumber) ||
    r.runNumber <= 0 ||
    typeof r.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(r.commit) ||
    r.tag !== `test-${r.commit.slice(0, 8)}` ||
    r.sourceUrl !==
      `https://github.com/${ACCEPTANCE_REPOSITORY}/actions/runs/${r.runId}` ||
    !Number.isFinite(Date.parse(r.publishedAt)) ||
    !Array.isArray(r.downloads) ||
    r.downloads.length !== platforms.length ||
    !platforms.every((platform) => {
      const matches = r.downloads.filter((d) => d?.id === platform);
      const d = matches[0];
      return (
        matches.length === 1 &&
        typeof d.artifactId === "string" &&
        /^[1-9]\d*$/.test(d.artifactId) &&
        d.href === `${r.sourceUrl}/artifacts/${d.artifactId}` &&
        Date.parse(d.expiresAt) > Date.now()
      );
    }) ||
    new Set(r.downloads.map((d) => d.artifactId)).size !== platforms.length
  )
    throw new Error("Invalid or expired acceptance update metadata");
  return r;
}

async function fetchRelease(timeout: number): Promise<AcceptanceRelease> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(ACCEPTANCE_MANIFEST_URL, {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok)
      throw new Error(`Update metadata unavailable: ${response.status}`);
    const text = await response.text();
    if (text.length > 64000) throw new Error("Update metadata too large");
    return validateAcceptanceRelease(JSON.parse(text));
  } finally {
    window.clearTimeout(timer);
  }
}

export async function checkAcceptanceUpdate(
  build: UpdateBuildInfo,
  timeout: number,
): Promise<
  | { status: "up-to-date" }
  | { status: "available"; info: UpdateInfo; update: UpdateHandle }
> {
  if (
    build.repository !== ACCEPTANCE_REPOSITORY ||
    !Number.isSafeInteger(build.runNumber) ||
    build.runNumber <= 0 ||
    !/^[a-f0-9]{40}$/.test(build.commit)
  ) {
    throw new Error("This local build has no published update identity");
  }
  const release = await fetchRelease(timeout);
  if (release.runNumber <= build.runNumber || release.commit === build.commit) {
    return { status: "up-to-date" };
  }
  const download = release.downloads.find((d) => d.id === build.platform);
  if (!download) throw new Error("No update installer for this platform");
  const openDownload = async () => {
    // Recheck on click: an old notification may outlive the artifact or a rollback.
    const current = await fetchRelease(timeout);
    const target = current.downloads.find((d) => d.id === build.platform);
    if (
      current.runNumber <= build.runNumber ||
      current.commit === build.commit ||
      !target
    ) {
      throw new Error("The update is no longer available; check again");
    }
    await invoke("open_external", { url: target.href });
  };
  return {
    status: "available",
    info: {
      currentVersion: `test-${build.commit.slice(0, 8)} (#${build.runNumber})`,
      availableVersion: `${release.tag} (#${release.runNumber})`,
      pubDate: release.publishedAt,
      channel: "acceptance",
      releaseUrl: release.sourceUrl,
    },
    update: {
      version: release.tag,
      manual: true,
      downloadAndInstall: openDownload,
      download: openDownload,
    },
  };
}
