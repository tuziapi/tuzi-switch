// Synthetic-only metadata/IPC. Never downloads, writes user data or installs software.
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { UpdateProvider } from "@/contexts/UpdateContext";
import { UpdateBadge } from "@/components/UpdateBadge";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { registerUpdateGuard } from "@/lib/updateSafety";
import i18n from "@/i18n";
import "@/index.css";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "success";
const repository = "tuziapi/tuzi-switch";
const base = `https://github.com/${repository}/releases/download/v1.5.7/`;
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
const names = [...new Set(Object.values(targets))].map(
  (s) => `tuzi-assistant-${s}`,
);
const notes = "合成正式更新：保留项目与配置。此验收不会执行真实安装。";
const release = {
  tag_name: "v1.5.7",
  html_url: `https://github.com/${repository}/releases/tag/v1.5.7`,
  published_at: "2026-11-06T00:00:00Z",
  body: notes,
  draft: false,
  prerelease: false,
  assets: [
    ...names,
    ...names.map((n) => `${n}.sig`),
    "latest.json",
    "tuzi-assistant-macos-arm64.dmg",
    "tuzi-assistant-macos-x64.dmg",
  ].map((name) => ({
    name,
    state: "uploaded",
    size: 123,
    digest: `sha256:${"a".repeat(64)}`,
    browser_download_url: `${base}${name}`,
  })),
};
const fetchOriginal = window.fetch;
window.fetch = async (...args) => {
  if (args[0] === `https://api.github.com/repos/${repository}/releases/latest`)
    return new Response(JSON.stringify(release), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return fetchOriginal(...args);
};
let attempts = 0;
let installs = 0;
let saves = 0;
const trace: string[] = [];
const log = (text: string) => {
  trace.push(text);
  document.querySelector("output")!.textContent = trace.join(" → ");
};
registerUpdateGuard(async () => {
  log("保存检查");
  saves++;
  if (scenario === "busy" && saves === 1)
    throw Error("还有生成任务正在运行，请完成任务后再更新。");
  if (scenario === "save" && saves === 1)
    throw Error("作品保存失败，请重试后再更新。");
});
mockIPC(async (command, args: any) => {
  if (command === "get_update_build_info")
    return {
      channel: "stable",
      repository,
      platform: params.get("platform") ?? "macos",
    };
  if (command === "plugin:app|version") return "1.5.6";
  if (command === "plugin:updater|check")
    return {
      rid: 1,
      currentVersion: "1.5.6",
      version: "1.5.7",
      body: notes,
      rawJson: {
        version: "1.5.7",
        platforms: Object.fromEntries(
          Object.entries(targets).map(([target, suffix]) => [
            target,
            {
              url: `${base}tuzi-assistant-${suffix}`,
              signature: "SYNTHETIC-SIGNATURE",
            },
          ]),
        ),
      },
    };
  if (command === "plugin:updater|download") {
    log("下载开始");
    attempts++;
    args.onEvent.onmessage({
      event: "Started",
      data: { contentLength: 1000000 },
    });
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      args.onEvent.onmessage({
        event: "Progress",
        data: { chunkLength: 200000 },
      });
      if (scenario === "network" && attempts === 1 && i === 1)
        throw Error("synthetic network interruption");
    }
    args.onEvent.onmessage({ event: "Finished" });
    log("签名校验");
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (scenario === "signature" && attempts === 1)
      throw Error("synthetic bad signature");
    log("校验通过");
    return 2;
  }
  if (command === "check_update_ready") {
    log("原生检查");
    return;
  }
  if (command === "plugin:updater|install") {
    log("安装");
    installs++;
    if (scenario === "install" && installs === 1)
      throw Error("synthetic permission failure");
    return;
  }
  if (command === "plugin:process|restart") {
    log("重启");
    return;
  }
  if (command === "plugin:resources|close") return;
  throw Error(`Unexpected IPC: ${command}`);
});
await i18n.changeLanguage("zh");
createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    defaultTheme={params.get("theme") === "dark" ? "dark" : "light"}
    storageKey="official-inapp-fixture"
  >
    <UpdateProvider>
      <main className="p-8 bg-background text-foreground min-h-screen">
        <div className="flex items-center gap-4">
          <h1>正式渠道 · 应用内更新验收</h1>
          <UpdateBadge />
        </div>
        <p className="mt-6">合成版本 1.5.6 → 1.5.7；不会下载真实更新包。</p>
        <output className="block mt-6" />
      </main>
      <Toaster />
    </UpdateProvider>
  </ThemeProvider>,
);
