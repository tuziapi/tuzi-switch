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
const platform = ["macos", "windows", "linux"].includes(
  params.get("platform") || "",
)
  ? params.get("platform")!
  : "macos";
let imported = () => {};
let status = {
  enabled: true,
  recoveryRequired: params.has("recovery"),
  boundProvider: params.has("recovery")
    ? "合成供应商 A"
    : (null as string | null),
  profileDir: "~/.tuzi-switch/claude-local-p0/desktop-profile",
  capabilities: {
    platform,
    voiceInput: platform !== "linux",
    computerUse: platform !== "linux",
    cowork: true,
  },
  options: { voiceInput: false, computerUse: false, cowork: false },
  voiceModelReady: false,
  core: {
    version: "5.11492.5",
    supported: true,
    claudeRunning: false,
    running: false,
    connected: false,
    caReady: params.has("ready"),
    caTrusted: params.has("ready"),
    nodeAvailable: true,
    warning: null,
  },
};
mockIPC((command, payload) => {
  if (command === "import_claude_desktop_providers_from_claude") {
    imported();
    return 1;
  }
  if (command === "get_claude_local_status") return structuredClone(status);
  if (command === "claude_local_action") {
    const { action, providerId } = payload as {
      action: string;
      providerId?: string;
    };
    if (action === "prepare") status.core.caReady = true;
    if (action === "trust") status.core.caTrusted = true;
    if (action === "untrust") status.core.caTrusted = false;
    if (action === "prepare_voice" && platform !== "linux")
      status.voiceModelReady = true;
    for (const [feature, key] of [
      ["voice", "voiceInput"],
      ["computer", "computerUse"],
      ["cowork", "cowork"],
    ] as const) {
      if (action === `enable_${feature}` && status.capabilities[key])
        status.options[key] = true;
      if (action === `disable_${feature}`) status.options[key] = false;
    }
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
    <main className="min-h-screen bg-background text-foreground p-6 sm:p-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="border-b pb-5">
          <p className="text-sm text-muted-foreground mb-2">
            兔子助手 / 工具配置
          </p>
          <h1 className="text-2xl font-semibold">Claude Desktop</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            当前源码界面预览 · 模拟状态，可点击体验；不修改系统或调用模型
          </p>
          <nav aria-label="预览平台" className="mt-4 flex gap-2">
            {[
              ["macos", "Mac"],
              ["windows", "Windows"],
              ["linux", "Linux"],
            ].map(([value, label]) => (
              <a
                key={value}
                href={`?platform=${value}`}
                aria-current={platform === value ? "page" : undefined}
                className={`rounded-md border px-3 py-1 text-sm ${platform === value ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                {label}
              </a>
            ))}
          </nav>
        </header>
        <ClaudeLocalPanel
          providerId={provider}
          providers={lines}
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
