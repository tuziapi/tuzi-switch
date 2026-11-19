// Synthetic form acceptance fixture. No real credentials or network calls.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ClaudeDesktopProviderForm,
  type ClaudeDesktopProviderFormValues,
} from "@/components/providers/forms/ClaudeDesktopProviderForm";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import i18n from "@/i18n";
import "@/index.css";
const params = new URLSearchParams(location.search);
let fetchCount = 0;
mockIPC((command) => {
  if (command === "get_claude_desktop_default_routes") return [];
  if (command === "fetch_claude_desktop_models") {
    fetchCount++;
    if (params.has("fail")) throw new Error("HTTP 401");
    return [
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `claude-sonnet-synthetic-${index + 1}`,
        ownedBy: "synthetic",
        createdAt: 1700000000 + index * 86400,
      })),
      { id: "deepseek-chat", ownedBy: "synthetic" },
      { id: "vendor/gpt-conversation", ownedBy: "synthetic" },
      { id: "gemini-flash-synthetic", ownedBy: "synthetic" },
      { id: "gpt-image-synthetic", ownedBy: "synthetic" },
    ];
  }
  throw new Error(`Unexpected fixture IPC ${command}`);
});
await i18n.changeLanguage(params.get("lang") || "zh");
function Fixture() {
  const [saved, setSaved] = useState<ClaudeDesktopProviderFormValues>();
  return (
    <main className="p-6 space-y-4 max-w-4xl mx-auto">
      <p className="text-sm text-muted-foreground">
        模型配置预览 · 合成模型和凭证，无真实请求
      </p>
      <ClaudeDesktopProviderForm
        submitLabel="保存线路"
        onSubmit={setSaved}
        onCancel={() => {}}
        initialData={{
          name: "合成线路",
          settingsConfig: {
            env: {
              ANTHROPIC_BASE_URL: "https://synthetic.example",
              ANTHROPIC_AUTH_TOKEN: "synthetic-key",
            },
          },
        }}
      />
      {saved && (
        <div role="status">
          已保存 {saved.meta?.claudeDesktopModelCatalog?.length} 个模型，
          {Object.keys(saved.meta?.claudeDesktopModelRoutes ?? {}).length}{" "}
          个映射；协议 {saved.meta?.apiFormat}；模式{" "}
          {saved.meta?.claudeDesktopMode}；获取次数 {fetchCount}；默认{" "}
          {JSON.parse(saved.settingsConfig).env.ANTHROPIC_MODEL}
        </div>
      )}
      <Toaster />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    defaultTheme={params.has("dark") ? "dark" : "light"}
    storageKey="claude-model-fixture"
  >
    <QueryClientProvider client={new QueryClient()}>
      <Fixture />
    </QueryClientProvider>
  </ThemeProvider>,
);
