// Synthetic-only search interaction fixture. Rejects all writes.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { Keys } from "@/components/account/Keys";
import { disconnectedAccount } from "@/lib/api/account";
import i18n from "@/i18n";
import "@/index.css";
import "@/components/account/account.css";
void i18n.changeLanguage("zh");
const key = {
  id: "1",
  name: "Synthetic default",
  masked_key: "sk-***aB19",
  status: 1,
  group: "default",
  created_time: 1,
  accessed_time: 0,
  expired_time: -1,
  remain_quota: "100",
  used_quota: "1",
  unlimited_quota: true,
  model_limits_enabled: false,
  model_limits: "",
  allow_ips: null,
  exclude_ips: null,
  is_expired: false,
};
mockIPC(async (cmd, args) => {
  if (cmd === "account_cancel_request") return;
  if (cmd !== "account_request") throw Error("Only synthetic reads allowed");
  const req = (args as any).request;
  if (req.method !== "GET") throw Error("Writes disabled");
  const q = Object.fromEntries(req.query ?? []);
  let data: any = {};
  if (req.path === "/account/key-groups")
    data = [{ id: "default", label: "default" }];
  if (req.path === "/account/keys") {
    await new Promise((r) => setTimeout(r, 1200));
    if (q.keyword === "fail") throw { code: "network_uncertain" };
    const items =
      (!q.keyword || key.name.includes(q.keyword)) &&
      (!q.token || q.token === "aB19") &&
      (!q.status || q.status === "1")
        ? [key]
        : [];
    data = {
      items,
      page: 1,
      page_size: 20,
      total: String(items.length),
      has_more: false,
    };
  }
  return { success: true, data, meta: { generated_at: 1 } };
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
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <main className="account-business" style={{ padding: 24 }}>
      <Keys state={state} />
    </main>
  </QueryClientProvider>,
);
