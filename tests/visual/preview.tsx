// Synthetic, in-memory visual fixture. Not imported by the application entry point.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { AccountPage } from "@/components/account/AccountPage";
import { ConfigureTool } from "@/components/account/ConfigureTool";
import { disconnectedAccount } from "@/lib/api/account";
import type { DesktopKey, DesktopPricing } from "@/lib/api/desktop";
import i18n from "@/i18n";
import "@/index.css";
import { accountPreviewIPC, setAccountPreviewMode } from "./account-fixture";
void i18n.changeLanguage("zh");
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
mockIPC(accountPreviewIPC);
function Preview() {
  const [scenario, setScenario] = useState("normal");
  const [theme, setTheme] = useState("light");
  const [revision, setRevision] = useState(0);
  const [configure, setConfigure] = useState<{
    key: DesktopKey;
    model?: DesktopPricing;
  } | null>(null);
  const state = {
    ...disconnectedAccount,
    status:
      scenario === "disconnected"
        ? ("disconnected" as const)
        : scenario === "offline"
          ? ("offline" as const)
          : ("connected" as const),
    generation: revision,
    identity:
      scenario === "disconnected"
        ? null
        : {
            userId: "synthetic-user",
            username: "preview_synthetic",
            displayName: "本地合成账户",
            connectionId: "synthetic-connection",
          },
  };
  return (
    <div
      className={theme === "dark" ? "dark" : ""}
      style={{
        height: "100vh",
        overflow: "auto",
        background: "hsl(var(--background))",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          padding: "8px 16px",
          background: "#eef3f9",
          fontSize: 12,
          color: "#48576b",
          alignItems: "center",
        }}
      >
        <strong>本地视觉验证 · 全部为合成数据 · 写入已隔离</strong>
        <label>
          场景{" "}
          <select
            aria-label="预览场景"
            value={scenario}
            onChange={(e) => {
              setAccountPreviewMode(e.target.value);
              setScenario(e.target.value);
              client.clear();
              setRevision((n) => n + 1);
            }}
          >
            {[
              "normal",
              "empty",
              "error",
              "loading",
              "offline",
              "disconnected",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          主题{" "}
          <select
            aria-label="预览主题"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option>light</option>
            <option>dark</option>
          </select>
        </label>
        <label>
          语言{" "}
          <select
            aria-label="预览语言"
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            defaultValue="zh"
          >
            <option>zh</option>
            <option>en</option>
            <option>ja</option>
          </select>
        </label>
      </div>
      <AccountPage
        key={revision}
        account={
          {
            state,
            isLoading: false,
            connect: async () => {},
            openTokenPage: async () => {},
            logout: async () => state,
            retry: async () => state,
          } as never
        }
        onConfigureKey={(key, model) => setConfigure({ key, model })}
        localStatus="本地合成状态：代理未运行"
      />
      {configure && (
        <ConfigureTool
          state={state}
          keyDto={configure.key}
          model={configure.model}
          onClose={() => setConfigure(null)}
          onReady={() => setConfigure(null)}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <Preview />
  </QueryClientProvider>,
);
