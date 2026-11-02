import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAcceptanceUpdate,
  validateAcceptanceRelease,
  ACCEPTANCE_MANIFEST_URL,
  type UpdateBuildInfo,
} from "@/lib/acceptanceUpdater";
const { invoke, check, getIdentifier } = vi.hoisted(() => ({
  getIdentifier: vi.fn(),
  invoke: vi.fn(),
  check: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.4.2"),
  getIdentifier,
}));
const build: UpdateBuildInfo = {
  channel: "acceptance",
  repository: "AiW520/tuzi-switch",
  runNumber: 10,
  commit: "a".repeat(40),
  platform: "macos",
};
function manifest() {
  const sourceUrl = "https://github.com/AiW520/tuzi-switch/actions/runs/999";
  return {
    schemaVersion: 1,
    success: true,
    channel: "acceptance",
    repository: build.repository,
    runId: "999",
    runNumber: 11,
    commit: "b".repeat(40),
    tag: "test-bbbbbbbb",
    sourceUrl,
    publishedAt: "2026-11-02T00:00:00Z",
    downloads: ["macos", "macos-intel", "windows", "linux"].map((id, i) => ({
      id,
      artifactId: `${100 + i}`,
      href: `${sourceUrl}/artifacts/${100 + i}`,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })),
  };
}
function serve(value = manifest()) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => JSON.stringify(value) }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue(build);
  serve();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("acceptance update channel", () => {
  it.each(["macos", "macos-intel", "windows", "linux"])(
    "offers the exact %s artifact only on user click",
    async (platform) => {
      const result = await checkAcceptanceUpdate({ ...build, platform }, 100);
      expect(result.status).toBe("available");
      expect(invoke).not.toHaveBeenCalled();
      if (result.status !== "available") throw Error("missing update");
      expect(result.update.manual).toBe(true);
      await result.update.downloadAndInstall();
      expect(invoke).toHaveBeenCalledWith("open_external", {
        url: manifest().downloads.find((d) => d.id === platform)?.href,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledWith(
        ACCEPTANCE_MANIFEST_URL,
        expect.objectContaining({
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
        }),
      );
    },
  );
  it.each([9, 10])("does not offer equal/older build %s", async (runNumber) => {
    serve({ ...manifest(), runNumber });
    expect(await checkAcceptanceUpdate(build, 100)).toEqual({
      status: "up-to-date",
    });
  });
  it("does not offer a rebuild of the same source", async () => {
    serve({ ...manifest(), commit: build.commit, tag: "test-aaaaaaaa" });
    expect(await checkAcceptanceUpdate(build, 100)).toEqual({
      status: "up-to-date",
    });
  });
  it("older stable native apps keep semver checking, while old acceptance apps cannot fall back", async () => {
    const { getUpdateBuildInfo } = await import("@/lib/acceptanceUpdater");
    invoke.mockRejectedValue(new Error("unknown command"));
    getIdentifier.mockResolvedValue("com.tuziswitch.desktop");
    expect((await getUpdateBuildInfo()).channel).toBe("stable");
    getIdentifier.mockResolvedValue("com.tuziswitch.desktop.acceptance");
    await expect(getUpdateBuildInfo()).rejects.toThrow("unknown command");
  });
  it("never consults the stable updater for acceptance", async () => {
    const { checkForUpdate } = await import("@/lib/updater");
    expect((await checkForUpdate()).status).toBe("available");
    expect(check).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([0, NaN])(
    "rejects missing local build identity %s",
    async (runNumber) => {
      await expect(
        checkAcceptanceUpdate({ ...build, runNumber }, 100),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("rejects missing platform installers", async () => {
    await expect(
      checkAcceptanceUpdate({ ...build, platform: "windows-arm64" }, 100),
    ).rejects.toThrow();
  });
  it("rejects malformed, cross-channel, expired and foreign manifests", () => {
    for (const patch of [
      { schemaVersion: 2 },
      { repository: "untrusted/repo" },
      { channel: "stable" },
      { runNumber: 0 },
      { runNumber: "11" },
      { runId: "../bad" },
      { commit: "bad" },
      { sourceUrl: "https://evil.test/" },
      { publishedAt: "invalid" },
      { downloads: [] },
    ])
      expect(() =>
        validateAcceptanceRelease({ ...manifest(), ...patch }),
      ).toThrow();
    for (const patch of [
      { href: "https://evil.test/app.exe" },
      { expiresAt: "2020-01-01" },
      { artifactId: "bad" },
      { id: "linux" },
    ]) {
      const m = manifest();
      Object.assign(m.downloads[0], patch);
      expect(() => validateAcceptanceRelease(m)).toThrow();
    }
  });
  it("refuses a stale notification after withdrawal or expiry", async () => {
    const result = await checkAcceptanceUpdate(build, 100);
    if (result.status !== "available") throw Error("missing update");
    serve({ ...manifest(), runNumber: 9 });
    await expect(result.update.downloadAndInstall()).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("reports network failure without stable fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { checkForUpdate } = await import("@/lib/updater");
    await expect(checkForUpdate()).rejects.toThrow("offline");
    expect(check).not.toHaveBeenCalled();
  });
  it("aborts a slow manifest request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      ),
    );
    const promise = checkAcceptanceUpdate(build, 100);
    const assertion = expect(promise).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
