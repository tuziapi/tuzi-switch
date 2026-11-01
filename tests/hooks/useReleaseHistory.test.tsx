import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReleaseHistory } from "@/hooks/useReleaseHistory";
import { productReleases } from "@/data/versionHistory";
import {
  cacheReleaseHistory,
  fetchReleaseHistory,
  HISTORY_CACHE_KEY,
  mergeReleaseHistory,
  readReleaseHistoryCache,
} from "@/lib/releaseHistory";
import { RELEASE_REPOSITORY } from "@/lib/releaseRepository";

const release = (overrides = {}) => ({
  tag_name: "v9.0.0",
  name: "Synthetic release",
  body: "Synthetic release notes",
  published_at: "2026-10-28T18:00:00Z",
  draft: false,
  prerelease: false,
  html_url: "https://untrusted.invalid/",
  ...overrides,
});
const snapshot = () => ({
  repository: RELEASE_REPOSITORY,
  fetchedAt: Date.now(),
  releases: [
    {
      version: "v9.0.0",
      title: "Synthetic release",
      body: "Cached notes",
      publishedAt: "2026-10-28T18:00:00Z",
    },
  ],
});
const fetchMock = vi.fn<typeof fetch>();
const response = (items: unknown, status = 200) =>
  new Response(JSON.stringify(items), { status });

beforeEach(() => {
  localStorage.removeItem(HISTORY_CACHE_KEY);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("release history isolation and fallback", () => {
  it("does not request releases while closed; opens with bundled data then syncs", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(({ open }) => useReleaseHistory(open), {
      initialProps: { open: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hook.result.current.releases).toEqual(productReleases);
    hook.rerender({ open: true });
    expect(hook.result.current.releases).toEqual(productReleases);
    await act(async () => {
      finish(response([release()]));
    });
    expect(hook.result.current.releases[0].version).toBe("v9.0.0");
    expect(hook.result.current.status).toBe("synced");
    expect(readReleaseHistoryCache()?.releases[0].version).toBe("v9.0.0");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Accept: "application/vnd.github+json",
    });
  });
  it("uses fresh cache without a request", () => {
    cacheReleaseHistory(snapshot());
    const hook = renderHook(() => useReleaseHistory(true));
    expect(hook.result.current.releases[0].version).toBe("v9.0.0");
    expect(hook.result.current.status).toBe("synced");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps stale cache and bundled history on rate limiting; reopening does not retry immediately", async () => {
    const cached = {
      ...snapshot(),
      fetchedAt: Date.now() - 7 * 60 * 60 * 1000,
    };
    cacheReleaseHistory(cached);
    fetchMock.mockResolvedValue(response({}, 403));
    const hook = renderHook(({ open }) => useReleaseHistory(open), {
      initialProps: { open: true },
    });
    await waitFor(() => expect(hook.result.current.status).toBe("offline"));
    expect(hook.result.current.releases[0].version).toBe("v9.0.0");
    expect(readReleaseHistoryCache()).toEqual(cached);
    hook.rerender({ open: false });
    hook.rerender({ open: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps local records when offline with corrupt cache", async () => {
    localStorage.setItem(HISTORY_CACHE_KEY, "invalid JSON");
    fetchMock.mockRejectedValue(new TypeError("Network unavailable"));
    const hook = renderHook(() => useReleaseHistory(true));
    await waitFor(() => expect(hook.result.current.status).toBe("offline"));
    expect(hook.result.current.releases).toEqual(productReleases);
  });
  it("cancels requests on close and ignores late results", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(({ open }) => useReleaseHistory(open), {
      initialProps: { open: true },
    });
    const signal = fetchMock.mock.calls[0][1]?.signal;
    hook.rerender({ open: false });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish(response([release()]));
    });
    expect(hook.result.current.releases).toEqual(productReleases);
    expect(readReleaseHistoryCache()).toBeUndefined();
  });
});

describe("public GitHub metadata", () => {
  it("paginates before accepting a complete snapshot, excluding drafts, prereleases and non-version tags", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(Array.from({ length: 100 }, () => release({ draft: true }))),
      )
      .mockResolvedValueOnce(
        response([
          release(),
          release({ prerelease: true }),
          release({ tag_name: "main" }),
        ]),
      );
    const data = await fetchReleaseHistory(new AbortController().signal);
    expect(data.releases).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
    const merged = mergeReleaseHistory(data);
    expect(merged[0]).toMatchObject({
      version: "v9.0.0",
      publishedAt: "2026-10-29",
      releaseUrl: `https://github.com/${RELEASE_REPOSITORY}/releases/tag/v9.0.0`,
    });
    expect(merged.some((r) => r.releaseUrl.includes("untrusted"))).toBe(false);
  });
  it("preserves curated classifications while including updated public notes", async () => {
    fetchMock.mockResolvedValue(response([release({ tag_name: "v1.4.2" })]));
    const data = await fetchReleaseHistory(new AbortController().signal);
    const merged = mergeReleaseHistory(data).find(
      (r) => r.version === "v1.4.2",
    )!;
    expect(merged.changes).toEqual(productReleases[0].changes);
    expect(merged.releaseNotes).toBe("Synthetic release notes");
  });
  it.each([[], [release({ published_at: "bad-date" })], {}])(
    "rejects empty or malformed responses without overwriting cache",
    async (data) => {
      const cached = snapshot();
      cacheReleaseHistory(cached);
      fetchMock.mockResolvedValue(response(data));
      await expect(
        fetchReleaseHistory(new AbortController().signal),
      ).rejects.toThrow();
      expect(readReleaseHistoryCache()).toEqual(cached);
    },
  );
  it("does not accept an incomplete snapshot when a later page fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(Array.from({ length: 100 }, () => release())),
      )
      .mockResolvedValueOnce(response({}, 500));
    await expect(
      fetchReleaseHistory(new AbortController().signal),
    ).rejects.toThrow();
    expect(readReleaseHistoryCache()).toBeUndefined();
  });
  it("bounds the whole operation with a timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const pending = fetchReleaseHistory(new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow("Aborted");
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
  });
  it("still syncs in memory if storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota");
    });
    fetchMock.mockResolvedValue(response([release()]));
    const hook = renderHook(() => useReleaseHistory(true));
    await waitFor(() => expect(hook.result.current.status).toBe("synced"));
    expect(hook.result.current.releases[0].version).toBe("v9.0.0");
  });
});
