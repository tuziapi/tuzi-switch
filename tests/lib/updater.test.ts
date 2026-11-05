import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const checkMock = vi.fn();
const getVersionMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("checkForUpdate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
    getVersionMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ channel: "stable" });
    getVersionMock.mockResolvedValue("1.1.26");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to GitHub release when Tauri updater check hangs", async () => {
    checkMock.mockReturnValue(new Promise(() => {}));
    mockLatestRelease();

    const { checkForUpdate } = await import("@/lib/updater");
    const resultPromise = checkForUpdate({ timeout: 100 });

    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.info.availableVersion).toBe("1.1.27");
      expect(result.update.manual).toBe(true);
    }
    expect(fetch).toHaveBeenCalledWith(
      `https://api.github.com/repos/${__RELEASE_REPOSITORY__}/releases/latest`,
      expect.objectContaining({
        headers: { Accept: "application/vnd.github+json" },
      }),
    );
  });

  it("falls back to GitHub release when Tauri updater reports no update", async () => {
    checkMock.mockResolvedValue(null);
    mockLatestRelease();

    const { checkForUpdate } = await import("@/lib/updater");
    const result = await checkForUpdate({ timeout: 100 });

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.info.currentVersion).toBe("1.1.26");
      expect(result.info.availableVersion).toBe("1.1.27");
    }
    expect(fetch).toHaveBeenCalledWith(
      `https://api.github.com/repos/${__RELEASE_REPOSITORY__}/releases/latest`,
      expect.any(Object),
    );
  });
});

function mockLatestRelease() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "v1.1.27",
        name: "兔子switch v1.1.27",
        body: "release notes",
        published_at: "2026-06-11T11:16:49.254Z",
      }),
    }),
  );
}

describe.each(["tuziapi/tuzi-switch", "AiW520/tuzi-switch"])(
  "signed integrated release channel: %s",
  (repository) => {
    beforeEach(() => {
      invokeMock.mockResolvedValue({
        channel: "stable",
        repository,
      });
      getVersionMock.mockResolvedValue("1.5.2");
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => vi.unstubAllGlobals());
    it("uses signed native updater and downloads separately from installation", async () => {
      const download = vi.fn(async (cb) => {
          cb({ event: "Progress", data: { chunkLength: 20 } });
        }),
        install = vi.fn(),
        both = vi.fn();
      checkMock.mockResolvedValue({
        version: "1.5.3",
        download,
        install,
        downloadAndInstall: both,
      });
      const { checkForUpdate } = await import("@/lib/updater");
      const result = await checkForUpdate();
      expect(result.status).toBe("available");
      if (result.status === "available") {
        const cb = vi.fn();
        await result.update.download!(cb);
        expect(cb).toHaveBeenCalledWith({ event: "Progress", downloaded: 20 });
        expect(install).not.toHaveBeenCalled();
        await result.update.install!();
        expect(install).toHaveBeenCalledOnce();
      }
      expect(both).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalledWith(
        "open_external",
        expect.anything(),
      );
    });
    it("does not turn a network/manifest error into browser download", async () => {
      checkMock.mockRejectedValue(Error("invalid manifest"));
      const { checkForUpdate } = await import("@/lib/updater");
      await expect(checkForUpdate()).rejects.toThrow("invalid manifest");
      expect(fetch).not.toHaveBeenCalled();
    });
    it("accepts no update without browser fallback", async () => {
      checkMock.mockResolvedValue(null);
      const { checkForUpdate } = await import("@/lib/updater");
      expect(await checkForUpdate()).toEqual({ status: "up-to-date" });
      expect(fetch).not.toHaveBeenCalled();
    });
  },
);
