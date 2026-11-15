// Synthetic-only visual fixture. No credentials, filesystem writes, or real downloads.
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { UpdateProvider } from "@/contexts/UpdateContext";
import { UpdateBadge } from "@/components/UpdateBadge";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import i18n from "@/i18n";
import "@/index.css";
const params = new URLSearchParams(location.search);
const channel = params.get("channel") ?? "acceptance";
const platform = params.get("platform") ?? "macos";
const failure = params.get("failure");
let openAttempts = 0;
mockIPC((command, args) => {
  if (command === "get_update_build_info")
    return {
      channel,
      repository:
        channel === "stable" ? "tuziapi/tuzi-switch" : "AiW520/tuzi-switch",
      runNumber: 10,
      commit: "a".repeat(40),
      platform,
    };
  if (command === "plugin:app|version") return "1.5.5";
  if (command === "open_external") {
    openAttempts++;
    if (failure === "opener" && openAttempts === 1)
      throw "打开链接失败: synthetic OS error 1155";
    document.querySelector("output")!.textContent = String(
      (args as { url?: string } | undefined)?.url,
    );
    return true;
  }
  if (command === "copy_text_to_clipboard") {
    document.querySelector("output")!.textContent =
      `copied: ${(args as { text: string }).text}`;
    return true;
  }
  throw new Error(`Unexpected IPC: ${command}`);
});
await i18n.changeLanguage("zh");
createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    defaultTheme={params.get("theme") === "dark" ? "dark" : "light"}
    storageKey="synthetic-update-theme"
  >
    <UpdateProvider>
      <main className="min-h-screen bg-background text-foreground p-8">
        <div className="flex items-center gap-4">
          <h1>兔子助手 · 更新提醒验收</h1>
          <UpdateBadge />
        </div>
        <p className="mt-8">
          {channel === "stable"
            ? "合成数据：当前版本 1.5.5，新版本 1.5.6。不会打开真实下载。"
            : "合成数据：当前构建 #10，新构建 #11。不会打开真实下载。"}
        </p>
        <output className="block break-all mt-8" />
      </main>
      <Toaster />
    </UpdateProvider>
  </ThemeProvider>,
);
