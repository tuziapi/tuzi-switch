import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  checkInstallerUpdate,
  validateInstallerRelease,
  isNewerInstallerVersion,
} from "@/lib/installerUpdater";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
function fixture(repo: string) {
  return {
    tag_name: "v1.5.1",
    html_url: `https://github.com/${repo}/releases/tag/v1.5.1`,
    published_at: "2026-11-03T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: [
      "macos-arm64.dmg",
      "macos-x64.dmg",
      "windows-x64.exe",
      "linux-x64.AppImage",
    ].map((s) => ({
      name: `tuzi-assistant-${s}`,
      browser_download_url: `https://github.com/${repo}/releases/download/v1.5.1/tuzi-assistant-${s}`,
      size: 123,
      state: "uploaded",
      digest: `sha256:${"a".repeat(64)}`,
    })),
  };
}
describe.each(["tuziapi/tuzi-switch", "AiW520/tuzi-switch"])(
  "installer updates: %s",
  (repo) => {
    beforeEach(() => {
      invoke.mockReset();
    });
    afterEach(() => vi.unstubAllGlobals());
    it("compares semantic versions and rejects invalid current identities", () => {
      expect(isNewerInstallerVersion("v1.10.0", "1.9.9")).toBe(true);
      expect(isNewerInstallerVersion("v1.5.0", "1.5.0")).toBe(false);
      expect(isNewerInstallerVersion("v1.4.3", "1.5.0")).toBe(false);
      expect(() => isNewerInstallerVersion("v1.5.0", "")).toThrow();
    });
    it("rejects drafts, prereleases, missing installers, wrong host and missing checksums", () => {
      for (const mutate of [
        (r: any) => (r.draft = true),
        (r: any) => (r.prerelease = true),
        (r: any) => r.assets.pop(),
        (r: any) => r.assets.push(r.assets[0]),
        (r: any) =>
          (r.assets[0].browser_download_url = "https://untrusted.test/app.dmg"),
        (r: any) => (r.assets[0].digest = ""),
        (r: any) => (r.tag_name = "v1.5.1-beta"),
      ]) {
        const r = fixture(repo);
        mutate(r);
        expect(() => validateInstallerRelease(r, repo)).toThrow();
      }
    });
    it.each([
      ["macos", "macos-arm64.dmg"],
      ["macos-intel", "macos-x64.dmg"],
      ["windows", "windows-x64.exe"],
      ["linux", "linux-x64.AppImage"],
    ])(
      "opens the direct %s installer only on click",
      async (platform, suffix) => {
        vi.stubGlobal(
          "fetch",
          vi
            .fn()
            .mockResolvedValue({ ok: true, json: async () => fixture(repo) }),
        );
        const r = await checkInstallerUpdate(
          {
            channel: "stable",
            repository: repo,
            platform,
            runNumber: 0,
            commit: "",
          },
          "1.5.0",
          1000,
        );
        expect(invoke).not.toHaveBeenCalled();
        expect(r.status).toBe("available");
        if (r.status === "available") {
          expect(r.update.manual).toBe(true);
          await r.update.download!();
        }
        expect(invoke).toHaveBeenCalledWith("open_external", {
          url: `https://github.com/${repo}/releases/download/v1.5.1/tuzi-assistant-${suffix}`,
        });
      },
    );
    it("rejects releases from the other channel", () => {
      const other =
        repo === "tuziapi/tuzi-switch"
          ? "AiW520/tuzi-switch"
          : "tuziapi/tuzi-switch";
      expect(() => validateInstallerRelease(fixture(other), repo)).toThrow();
    });
    it("does not silently download a version different from the displayed notes", async () => {
      const changed = JSON.parse(
        JSON.stringify(fixture(repo)).split("v1.5.1").join("v1.5.2"),
      );
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce({ ok: true, json: async () => fixture(repo) })
          .mockResolvedValueOnce({ ok: true, json: async () => changed }),
      );
      const result = await checkInstallerUpdate(
        {
          channel: "stable",
          repository: repo,
          platform: "macos",
          runNumber: 0,
          commit: "",
        },
        "1.5.0",
        1000,
      );
      expect(result.status).toBe("available");
      if (result.status === "available")
        await expect(result.update.download!()).rejects.toThrow(
          "Release changed",
        );
      expect(invoke).not.toHaveBeenCalled();
    });
    it("revalidates withdrawn releases before opening and never opens an artifact archive", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => fixture(repo) })
        .mockResolvedValueOnce({ ok: false, status: 404 });
      vi.stubGlobal("fetch", fetchMock);
      const r = await checkInstallerUpdate(
        {
          channel: "stable",
          repository: repo,
          platform: "macos",
          runNumber: 0,
          commit: "",
        },
        "1.5.0",
        1000,
      );
      if (r.status === "available")
        await expect(r.update.download!()).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    });
  },
);
