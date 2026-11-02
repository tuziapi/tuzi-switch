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
mockIPC((command, args) => {
  if (command === "get_update_build_info")
    return {
      channel,
      repository: "AiW520/tuzi-switch",
      runNumber: 10,
      commit: "a".repeat(40),
      platform,
    };
  if (command === "open_external") {
    document.querySelector("output")!.textContent = String(
      (args as { url?: string } | undefined)?.url,
    );
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
          合成数据：当前构建 #10，新构建 #11。不会打开真实下载。
        </p>
        <output className="block break-all mt-8" />
      </main>
      <Toaster />
    </UpdateProvider>
  </ThemeProvider>,
);
