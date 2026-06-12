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
