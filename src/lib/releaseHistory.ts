import { productReleases, type ProductRelease } from "@/data/versionHistory";
import { RELEASE_REPOSITORY, REPOSITORY_URL } from "./releaseRepository";

export type HistoryRelease = Omit<ProductRelease, "commit"> & {
  releaseNotes?: string;
};
interface PublishedRelease {
  version: string;
  publishedAt: string;
  title: string;
  body: string;
}
export interface ReleaseHistorySnapshot {
  repository: string;
  fetchedAt: number;
  releases: PublishedRelease[];
}
export const HISTORY_CACHE_KEY = `tuzi-release-history-v1:${RELEASE_REPOSITORY}`;
export const HISTORY_STALE_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_LENGTH = 2_000_000;
const VERSION = /^v\d+\.\d+\.\d+$/;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const validRelease = (value: unknown): value is PublishedRelease =>
  record(value) &&
  typeof value.version === "string" &&
  VERSION.test(value.version) &&
  validDate(value.publishedAt) &&
  typeof value.title === "string" &&
  value.title.length <= 300 &&
  typeof value.body === "string" &&
  value.body.length <= 50_000;

export function readReleaseHistoryCache(): ReleaseHistorySnapshot | undefined {
  try {
    const raw = localStorage.getItem(HISTORY_CACHE_KEY);
    if (!raw || raw.length > MAX_CACHE_LENGTH) return;
    const data: unknown = JSON.parse(raw);
    if (
      !record(data) ||
      data.repository !== RELEASE_REPOSITORY ||
      typeof data.fetchedAt !== "number" ||
      !Number.isFinite(data.fetchedAt) ||
      data.fetchedAt <= 0 ||
      data.fetchedAt > Date.now() + 60_000 ||
      !Array.isArray(data.releases) ||
      !data.releases.length ||
      data.releases.length > 1000 ||
      !data.releases.every(validRelease)
    )
      return;
    return data as unknown as ReleaseHistorySnapshot;
  } catch {
    // Storage is optional; failure must not affect the history or other settings.
    return;
  }
}
export function cacheReleaseHistory(snapshot: ReleaseHistorySnapshot): void {
  try {
    const raw = JSON.stringify(snapshot);
    if (raw.length <= MAX_CACHE_LENGTH)
      localStorage.setItem(HISTORY_CACHE_KEY, raw);
  } catch {
    /* Keep the successful response in memory when storage is unavailable. */
  }
}

/** Public metadata only. Never shares account credentials or trusts response URLs. */
export async function fetchReleaseHistory(
  signal: AbortSignal,
): Promise<ReleaseHistorySnapshot> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(abort, 12_000);
  try {
    const releases: PublishedRelease[] = [];
    let totalLength = 0;
    for (let page = 1; page <= 10; page++) {
      const response = await fetch(
        `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=100&page=${page}`,
        {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/vnd.github+json" },
        },
      );
      if (!response.ok) throw new Error("Release history unavailable");
      const text = await response.text();
      totalLength += text.length;
      if (totalLength > MAX_CACHE_LENGTH)
        throw new Error("Release history too large");
      const data: unknown = JSON.parse(text);
      if (!Array.isArray(data) || data.length > 100)
        throw new Error("Invalid release history");
      for (const item of data) {
        if (
          !record(item) ||
          typeof item.draft !== "boolean" ||
          typeof item.prerelease !== "boolean"
        )
          throw new Error("Invalid release record");
        if (
          item.draft ||
          item.prerelease ||
          typeof item.tag_name !== "string" ||
          !VERSION.test(item.tag_name)
        )
          continue;
        const release = {
          version: item.tag_name,
          publishedAt: item.published_at,
          title: item.name ?? item.tag_name,
          body: item.body ?? "",
        };
        if (!validRelease(release))
          throw new Error("Invalid published release");
        releases.push(release);
      }
      if (data.length < 100) {
        if (!releases.length) throw new Error("Empty release history");
        return {
          repository: RELEASE_REPOSITORY,
          fetchedAt: Date.now(),
          releases,
        };
      }
    }
    // Never replace a complete cache with a truncated page set.
    throw new Error("Release history pagination limit");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function mergeReleaseHistory(
  snapshot?: ReleaseHistorySnapshot,
): HistoryRelease[] {
  const releases = new Map<string, HistoryRelease>(
    productReleases.map((r) => [r.version, r]),
  );
  const timestamps = new Map<string, number>();
  for (const remote of snapshot?.releases ?? []) {
    timestamps.set(remote.version, Date.parse(remote.publishedAt));
    const date = new Date(remote.publishedAt);
    const publishedAt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const local = releases.get(remote.version);
    releases.set(remote.version, {
      version: remote.version,
      publishedAt,
      releaseUrl: `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(remote.version)}`,
      changes: local?.changes ?? [],
      releaseNotes: remote.body || remote.title,
    });
  }
  return [...releases.values()].sort(
    (a, b) =>
      (timestamps.get(b.version) ??
        Date.parse(`${b.publishedAt}T00:00:00+08:00`)) -
      (timestamps.get(a.version) ??
        Date.parse(`${a.publishedAt}T00:00:00+08:00`)),
  );
}
