import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkMock = vi.fn();
const getVersionMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: getVersionMock }));

describe("checkForUpdate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
    getVersionMock.mockReset();
    getVersionMock.mockResolvedValue("3.17.0-tuzi.1");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to GitHub releases when the native updater hangs", async () => {
    checkMock.mockReturnValue(new Promise(() => {}));
    mockLatestRelease("v3.17.0-tuzi.2");

    const { checkForUpdate } = await import("@/lib/updater");
    const pending = checkForUpdate({ timeout: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/tuziapi/tuzi-switch/releases/latest",
      expect.objectContaining({
        headers: { Accept: "application/vnd.github+json" },
      }),
    );
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.info.availableVersion).toBe("3.17.0-tuzi.2");
      expect(result.info.manual).toBe(true);
    }
  });

  it("uses GitHub releases when the native manifest has no update", async () => {
    checkMock.mockResolvedValue(null);
    mockLatestRelease("v3.17.0-tuzi.2");

    const { checkForUpdate } = await import("@/lib/updater");
    const result = await checkForUpdate({ timeout: 100 });

    expect(result.status).toBe("available");
  });
});

function mockLatestRelease(tag: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: tag,
        name: `兔子switch ${tag}`,
        body: "release notes",
        published_at: "2026-07-16T00:00:00Z",
      }),
    }),
  );
}
