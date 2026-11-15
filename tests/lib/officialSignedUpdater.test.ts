import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "@/lib/updater";

const { check, invoke, getVersion } = vi.hoisted(() => ({
  check: vi.fn(),
  invoke: vi.fn(),
  getVersion: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));

const repo = "tuziapi/tuzi-switch";
const prefix = `https://github.com/${repo}/releases/download/v1.5.7/`;
const targets = {
  "darwin-aarch64": "macos-arm64.app.tar.gz",
  "darwin-x86_64": "macos-x64.app.tar.gz",
  "windows-x86_64-nsis": "windows-x64.exe",
  "windows-x86_64-msi": "windows-x64.msi",
  "linux-x86_64-appimage": "linux-x64.AppImage",
  "linux-x86_64-deb": "linux-x64.deb",
  "linux-x86_64-rpm": "linux-x64.rpm",
  "windows-x86_64": "windows-x64.exe",
  "linux-x86_64": "linux-x64.AppImage",
};
function fixture() {
  const names = [...new Set(Object.values(targets))].map(
    (suffix) => `tuzi-assistant-${suffix}`,
  );
  const release = {
    tag_name: "v1.5.7",
    html_url: `https://github.com/${repo}/releases/tag/v1.5.7`,
    published_at: "2026-11-06T00:00:00Z",
    draft: false,
    prerelease: false,
    body: "SYNTHETIC official release notes",
    assets: [
      ...names,
      ...names.map((name) => `${name}.sig`),
      "latest.json",
      "tuzi-assistant-macos-arm64.dmg",
      "tuzi-assistant-macos-x64.dmg",
    ].map((name) => ({
      name,
      browser_download_url: `${prefix}${name}`,
      state: "uploaded",
      size: 123,
      digest: `sha256:${"a".repeat(64)}`,
    })),
  };
  const native = {
    currentVersion: "1.5.6",
    version: "1.5.7",
    body: "native notes",
    rawJson: {
      version: "1.5.7",
      platforms: Object.fromEntries(
        Object.entries(targets).map(([target, suffix]) => [
          target,
          {
            url: `${prefix}tuzi-assistant-${suffix}`,
            signature: "SYNTHETIC-NOT-A-REAL-SIGNATURE",
          },
        ]),
      ),
    },
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { release, native };
}
let data: ReturnType<typeof fixture>;
beforeEach(() => {
  vi.clearAllMocks();
  data = fixture();
  invoke.mockResolvedValue({
    channel: "stable",
    repository: repo,
    platform: "macos",
  });
  getVersion.mockResolvedValue("1.5.6");
  check.mockResolvedValue(data.native);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async () => ({
        ok: true,
        json: async () => data.release,
      })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("official signed updates and unsigned transition", () => {
  it.each(["macos", "macos-intel", "windows", "linux"])(
    "selects a native signed update on %s without opening a browser",
    async (platform) => {
      invoke.mockResolvedValue({
        channel: "stable",
        repository: repo,
        platform,
      });
      const result = await checkForUpdate();
      expect(result).toMatchObject({
        status: "available",
        info: {
          availableVersion: "1.5.7",
          channel: "stable",
          notes: data.release.body,
        },
      });
      if (result.status !== "available") throw Error("missing update");
      expect(result.update.manual).not.toBe(true);
      expect(data.native.download).not.toHaveBeenCalled();
      await result.update.download!();
      expect(data.native.download).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 600_000,
      });
      expect(data.native.install).not.toHaveBeenCalled();
      expect(data.native.downloadAndInstall).not.toHaveBeenCalled();
      expect(
        invoke.mock.calls.every(
          ([command]) => command === "get_update_build_info",
        ),
      ).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        `https://api.github.com/repos/${repo}/releases/latest`,
        expect.anything(),
      );
    },
  );
  it.each([null, "old", "newer", "wrong-installed-version"])(
    "rejects missing/stale/racing native manifest: %s",
    async (variant) => {
      if (variant === null) check.mockResolvedValue(null);
      else if (variant === "wrong-installed-version")
        data.native.currentVersion = "1.5.5";
      else data.native.version = variant === "old" ? "1.4.2" : "1.5.8";
      await expect(checkForUpdate()).rejects.toThrow("不一致");
      if (variant !== null) expect(data.native.close).toHaveBeenCalledOnce();
      expect(data.native.download).not.toHaveBeenCalled();
    },
  );
  it("does not turn a declared signed release's network failure into unsigned installation", async () => {
    check.mockRejectedValue(new Error("manifest unavailable"));
    await expect(checkForUpdate()).rejects.toThrow("manifest unavailable");
    expect(invoke).not.toHaveBeenCalledWith("open_external", expect.anything());
  });
  it("closes a native resource arriving after the check deadline", async () => {
    vi.useFakeTimers();
    let finish!: (value: typeof data.native) => void;
    check.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const assertion = expect(checkForUpdate({ timeout: 100 })).rejects.toThrow(
      "超时",
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    finish(data.native);
    await vi.advanceTimersByTimeAsync(0);
    expect(data.native.close).toHaveBeenCalledOnce();
  });
  it.each([
    "missing-manifest",
    "missing-signature",
    "missing-archive",
    "duplicate-manifest",
    "foreign-asset",
    "empty-digest",
  ])("rejects incomplete or mixed release assets: %s", async (variant) => {
    if (variant === "missing-manifest")
      data.release.assets = data.release.assets.filter(
        (a) => a.name !== "latest.json",
      );
    if (variant === "missing-signature")
      data.release.assets = data.release.assets.filter(
        (a) => a.name !== "tuzi-assistant-macos-arm64.app.tar.gz.sig",
      );
    if (variant === "missing-archive")
      data.release.assets = data.release.assets.filter(
        (a) => a.name !== "tuzi-assistant-macos-arm64.app.tar.gz",
      );
    if (variant === "duplicate-manifest")
      data.release.assets.push(
        data.release.assets.find((a) => a.name === "latest.json")!,
      );
    if (variant === "foreign-asset")
      data.release.assets[0].browser_download_url =
        data.release.assets[0].browser_download_url.replace(
          "tuziapi",
          "AiW520",
        );
    if (variant === "empty-digest") data.release.assets[0].digest = "";
    await expect(checkForUpdate()).rejects.toThrow("正式更新附件");
    expect(check).not.toHaveBeenCalled();
  });
  it.each([
    "other-repository",
    "other-version",
    "missing-target",
    "missing-signature",
    "unknown-target",
    "manifest-version",
  ])("rejects a native manifest before download: %s", async (variant) => {
    const platform = data.native.rawJson.platforms["darwin-aarch64"];
    if (variant === "other-repository")
      platform.url = platform.url.replace("tuziapi", "AiW520");
    if (variant === "other-version")
      platform.url = platform.url.replace("v1.5.7", "v1.5.8");
    if (variant === "missing-target")
      delete data.native.rawJson.platforms["windows-x86_64-msi"];
    if (variant === "missing-signature") platform.signature = " ";
    if (variant === "unknown-target")
      data.native.rawJson.platforms["foreign-platform"] = platform;
    if (variant === "manifest-version") data.native.rawJson.version = "1.4.2";
    await expect(checkForUpdate()).rejects.toThrow();
    expect(data.native.close).toHaveBeenCalledOnce();
    expect(data.native.download).not.toHaveBeenCalled();
  });
  it("propagates byte signature rejection without installing or opening a manual installer", async () => {
    data.native.download.mockRejectedValue(new Error("signature mismatch"));
    const result = await checkForUpdate();
    if (result.status !== "available") throw Error("missing update");
    await expect(result.update.download!()).rejects.toThrow(
      "signature mismatch",
    );
    expect(data.native.install).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("open_external", expect.anything());
  });
  it("keeps old unsigned releases visible as explicitly manual updates", async () => {
    data.release.assets = data.release.assets.filter(
      (a) =>
        a.name !== "latest.json" &&
        !a.name.endsWith(".sig") &&
        !a.name.endsWith(".app.tar.gz"),
    );
    const result = await checkForUpdate();
    expect(result).toMatchObject({
      status: "available",
      update: { manual: true },
    });
    expect(check).not.toHaveBeenCalled();
  });
});
