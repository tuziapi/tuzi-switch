// Temporary synthetic-only fixture. No external requests or real credentials.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ConfigureTool } from "@/components/account/ConfigureTool";
import { disconnectedAccount } from "@/lib/api/account";
import i18n from "@/i18n";
import "@/index.css";
import "@/components/account/account.css";
void i18n.changeLanguage("zh");
const all = Array.from({ length: 130 }, (_, i) => ({
  model_name:
    i < 3
      ? ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"][i]
      : i === 100
        ? "gpt-6.1-sol"
        : i === 101
          ? "gpt-6-astra"
          : `synthetic-model-${String(i).padStart(3, "0")}`,
  enable_groups: ["default"],
  supported_endpoint_types: [
    ...(i < 3 || i >= 100 ? ["openai-response"] : []),
    "anthropic",
  ],
  endpoints: {},
}));
mockIPC((cmd, args) => {
  if (cmd === "tuzi_provider_sources") return [];
  if (cmd === "account_cancel_request") return;
  if (cmd !== "account_request")
    throw Error("Synthetic fixture rejects side effects");
  const req = (args as any).request;
  if (req.path !== "/account/keys/1/models" || req.method !== "GET")
    throw Error("Synthetic fixture only allows model list reads");

  return { success: true, data: { items: all }, meta: { generated_at: 1 } };
});
const state = {
  ...disconnectedAccount,
  status: "connected" as const,
  generation: 1,
  identity: {
    userId: "synthetic",
    username: "synthetic",
    displayName: "Synthetic",
    connectionId: "synthetic",
  },
};
const key = {
  id: "1",
  name: "SYNTHETIC ONLY",
  status: 1,
  group: "default",
  expired_time: -1,
  remain_quota: "100",
  unlimited_quota: true,
  model_limits_enabled: false,
  model_limits: "",
} as any;
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <ConfigureTool
      state={state}
      keyDto={key}
      onClose={() => {}}
      onReady={() => {}}
    />
  </QueryClientProvider>,
);
