// Isolated synthetic UI: no filesystem, clipboard, account or model calls.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { Toaster } from "sonner";
import { TuziProviderDialog } from "@/components/providers/TuziProviderDialog";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { AccountPage } from "@/components/account/AccountPage";
import { disconnectedAccount } from "@/lib/api/account";
import fixture from "../fixtures/b11-provider-codex.json";
import i18n from "@/i18n";
import "@/index.css";
void i18n.changeLanguage("zh");
const noop = () => {};
mockIPC(async (command) => {
  if (command === "get_settings") return { commonConfigConfirmed: true };
  if (command === "get_common_config_snippet") return "";
  if (command === "auth_get_status") return { authenticated: false };
  if (command === "get_current_provider") return "";
  if (command === "get_providers" || command === "read_all_codex_env_keys")
    return {};
  if (command === "tuzi_provider_preview")
    return {
      id: "synthetic",
      changes: Array.from(
        { length: 20 },
        (_, i) =>
          `合成配置文件 ${i + 1}：保持其他供应商和工具设置；模型 Key 已脱敏，保存前备份。`,
      ),
    };
  if (command === "tuzi_provider_save")
    return { backupId: "synthetic", enabled: false, tested: false };
  if (command === "account_take_token_prefill")
    return "SYNTHETIC0000000000000000000000";
  return null;
});
function Preview() {
  const [open, setOpen] = useState(true);
  const [request, setRequest] = useState(0);
  const mode = new URLSearchParams(location.search).get("mode") ?? "card";
  return (
    <>
      <Toaster />
      {mode === "form" ? (
        open ? (
          <TuziProviderDialog
            draft={{
              appId: "codex",
              protocol: "responses",
              key: "sk-SYNTHETIC_ACCOUNT_MODEL_KEY",
              tokenId: "17",
              userId: "20",
              generation: 1,
              model: "synthetic-model",
              name: "合成密钥",
            }}
            onClose={() => setOpen(false)}
            onSaved={() => setOpen(false)}
          />
        ) : (
          <p>合成保存完成，未写入真实配置。</p>
        )
      ) : mode === "account" ? (
        <>
          <button onClick={() => setRequest((value) => value + 1)}>
            模拟固定回跳（合成数据）
          </button>
          <AccountPage
            tokenReturnRequest={request}
            account={{
              state: disconnectedAccount,
              isLoading: false,
              connect: async () => {},
              openTokenPage: async () => {},
              logout: async () => {},
              retry: async () => disconnectedAccount,
            }}
          />
        </>
      ) : (
        <div className="p-6">
          <h1 className="mb-4">合成供应商 · 标题显示验证</h1>
          <ProviderCard
            provider={fixture as any}
            appId="codex"
            isCurrent={false}
            isProxyRunning={false}
            onSwitch={noop}
            onEdit={noop}
            onDelete={noop}
            onConfigureUsage={noop}
            onOpenWebsite={noop}
            onDuplicate={noop}
          />
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <Preview />
  </QueryClientProvider>,
);
