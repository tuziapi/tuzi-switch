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
let status = {
  enabled: true,
  recoveryRequired: params.has("recovery"),
  boundProvider: params.has("recovery")
    ? "合成供应商 A"
    : (null as string | null),
  profileDir: "~/.tuzi-switch/claude-local-p0/desktop-profile",
  core: {
    version: "2.26454.0",
    supported: true,
    claudeRunning: false,
    running: false,
    connected: false,
    caReady: false,
    caTrusted: false,
    nodeAvailable: true,
    warning: null,
  },
};
mockIPC((command, payload) => {
  if (command === "get_claude_local_status") return structuredClone(status);
  if (command === "claude_local_action") {
    const { action, providerId } = payload as {
      action: string;
      providerId?: string;
    };
    if (action === "prepare") status.core.caReady = true;
    if (action === "trust") status.core.caTrusted = true;
    if (action === "untrust") status.core.caTrusted = false;
    if (action === "launch") {
      status.core.running = true;
      status.core.connected = true;
      status.boundProvider =
        providerId === "b" ? "合成供应商 B" : "合成供应商 A";
    }
    if (action === "stop") {
      status.core.running = false;
      status.core.connected = false;
      status.boundProvider = null;
      status.recoveryRequired = false;
    }
    return structuredClone(status);
  }
  throw new Error(`Unexpected synthetic IPC: ${command}`);
});
await i18n.changeLanguage(params.get("lang") || "zh");
function Fixture() {
  const [provider, select] = useState("a");
  return (
    <main className="min-h-screen bg-background text-foreground p-6 sm:p-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="border-b pb-5">
          <p className="text-sm text-muted-foreground mb-2">
            兔子助手 / 工具配置
          </p>
          <h1 className="text-2xl font-semibold">Claude Desktop</h1>
        </header>
        <ClaudeLocalPanel providerId={provider} />
        <section className="rounded-xl border p-4">
          <label htmlFor="provider" className="mr-4 text-sm">
            供应商
          </label>
          <select
            id="provider"
            className="border rounded-md bg-background p-2 text-sm"
            value={provider}
            onChange={(e) => select(e.target.value)}
          >
            <option value="a">合成供应商 A</option>
            <option value="b">合成供应商 B</option>
          </select>
        </section>
        <p className="text-xs text-muted-foreground">
          P0 界面验收 · 合成数据，无真实模型请求或系统修改
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
