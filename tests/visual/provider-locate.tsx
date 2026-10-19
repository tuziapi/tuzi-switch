// Actual provider list, isolated synthetic data; all native calls mocked.
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ProviderList } from "@/components/providers/ProviderList";
import i18n from "@/i18n";
import "@/index.css";
import "@/components/account/account.css";
void i18n.changeLanguage("zh");
mockIPC(() => null);
const noop = () => {};
const providers = Object.fromEntries(
  ["日常开发", "长名称测试-Claude-Codex-Gemini-独立配置", "备用线路"].map(
    (keyName, index) => [
      `synthetic-${index}`,
      {
        id: `synthetic-${index}`,
        name: `兔子线路-${keyName}`,
        icon: "tuzi",
        category: "aggregator" as const,
        settingsConfig: {
          config: 'base_url = "https://api.tu-zi.com/v1"',
          auth: { OPENAI_API_KEY: "sk-SYNTHETIC-VISUAL-ONLY" },
        },
      },
    ],
  ),
);
function Page() {
  const [focusRequest, setFocusRequest] = useState<{ providerId: string }>();
  const [width, setWidth] = useState("100%");
  const clear = useCallback(() => setFocusRequest(undefined), []);
  return (
    <main className="p-6 space-y-4">
      <h1>账户配置定位 · 合成数据</h1>
      <div className="flex gap-4 flex-wrap">
        <button onClick={() => setFocusRequest({ providerId: "synthetic-1" })}>
          查看配置（未启用）
        </button>
        <button onClick={() => setFocusRequest({ providerId: "synthetic-0" })}>
          查看配置（已启用）
        </button>
        <button
          onClick={() => document.documentElement.classList.toggle("dark")}
        >
          切换深浅主题
        </button>
        <label>
          宽度{" "}
          <select value={width} onChange={(e) => setWidth(e.target.value)}>
            <option>100%</option>
            <option>360px</option>
          </select>
        </label>
      </div>
      <div style={{ width, maxWidth: "100%" }} className="overflow-hidden p-1">
        <ProviderList
          providers={providers}
          focusRequest={focusRequest}
          onFocusComplete={clear}
          currentProviderId="synthetic-0"
          appId="codex"
          onSwitch={noop}
          onEdit={noop}
          onDelete={noop}
          onDuplicate={noop}
          onOpenWebsite={noop}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <Page />
  </QueryClientProvider>,
);
