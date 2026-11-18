// Synthetic UI fixture. Buttons only update an in-memory mock; no certificates or clients are changed.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClaudeLocalPanel } from "@/components/proxy/ClaudeLocalPanel";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import i18n from "@/i18n";
import "@/index.css";
const params = new URLSearchParams(location.search);
// Production uses native capabilities_for(std::env::consts::OS).
// Browser-only fixtures detect the viewing OS; the query override is for QA.
const detectedPlatform = /Mac/i.test(navigator.platform)
  ? "macos"
  : /Win/i.test(navigator.platform)
    ? "windows"
    : "linux";
const platform = ["macos", "windows", "linux"].includes(
  params.get("platform") || "",
)
  ? params.get("platform")!
  : detectedPlatform;
let imported = () => {};
const status = {
  enabled: true,
  desktopRunning: params.has("running"),
  recoveryRequired: params.has("recovery"),
  capabilities: {
    platform,
    voiceInput: false,
    computerUse: false,
    cowork: false,
  },
};
const gateway = {
  supported: true,
  configured: params.has("configured"),
  appliedId: params.has("configured") ? "synthetic-profile" : null,
  mode: "proxy",
  expectedBaseUrl: "http://127.0.0.1:15721/claude-desktop",
  actualBaseUrl: "http://127.0.0.1:15721/claude-desktop",
  proxyRunning: params.has("configured"),
  staleRawModels: false,
  missingRouteMappings: false,
  gatewayTokenConfigured: true,
};
mockIPC((command, payload) => {
  if (command === "get_claude_desktop_status") return structuredClone(gateway);
  if (command === "import_claude_desktop_providers_from_claude") {
    imported();
    return 1;
  }
  if (command === "get_claude_local_status") return structuredClone(status);
  if (command === "detect_official_claude_installation")
    return !params.has("missing");
  if (command === "claude_local_action") {
    const { action } = payload as { action: string };
    if (action === "stop") status.recoveryRequired = false;
    else if (action === "prepare_connection" || action === "launch") {
      gateway.configured = true;
      gateway.appliedId = "synthetic-profile";
      gateway.proxyRunning = true;
      if (action === "launch") status.desktopRunning = true;
    } else if (action !== "untrust")
      throw new Error(`Unexpected cleanup action: ${action}`);
    return structuredClone(status);
  }
  throw new Error(`Unexpected synthetic IPC: ${command}`);
});
await i18n.changeLanguage(params.get("lang") || "zh");
function Fixture() {
  const [provider, select] = useState(params.has("configured") ? "a" : "");
  const [lines, setLines] = useState(
    params.has("configured")
      ? [
          { id: "a", name: "示例线路 A" },
          { id: "b", name: "示例线路 B" },
        ]
      : [],
  );
  imported = () => {
    setLines([
      { id: "a", name: "示例线路 A" },
      { id: "b", name: "示例线路 B" },
    ]);
    select("a");
  };
  return (
    <main className="min-h-screen bg-background text-foreground p-4 sm:p-6">
      <div className="w-full space-y-6">
        <header className="border-b pb-5">
          <p className="text-sm text-muted-foreground mb-2">
            兔子助手 / 工具配置
          </p>
          <h1 className="text-2xl font-semibold">Claude Desktop</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            当前源码界面预览 · 模拟状态，可点击体验；不修改系统或调用模型
          </p>
        </header>
        <ClaudeLocalPanel
          providerId={provider}
          providers={lines.map((line) => ({
            ...line,
            meta: {
              claudeDesktopModelRoutes: {
                "claude-synthetic": { model: "claude-synthetic" },
              },
            },
          }))}
          onSelectProvider={select}
          onAddProvider={imported}
        >
          <p className="text-sm text-muted-foreground">
            预览中的示例线路。正式应用在此显示原有供应商卡片和编辑操作。
          </p>
        </ClaudeLocalPanel>
        <p className="text-xs text-muted-foreground">
          界面预览 · 合成数据，无真实模型请求或系统修改
        </p>
      </div>
      <Toaster />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    defaultTheme={params.has("dark") ? "dark" : "light"}
    storageKey={`claude-p0-fixture-theme-${params.has("dark")}`}
  >
    <QueryClientProvider client={new QueryClient()}>
      <Fixture />
    </QueryClientProvider>
  </ThemeProvider>,
);
