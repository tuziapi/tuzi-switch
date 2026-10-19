import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import { invoke } from "@tauri-apps/api/core";
import { Keys } from "@/components/account/Keys";
import { ConfigureTool } from "@/components/account/ConfigureTool";
import { CurrencySwitcher } from "@/components/account/AccountCurrency";
import {
  desktopRequest,
  disconnectedAccount,
  type AccountState,
} from "@/lib/api/account";
import { amountToQuota } from "@/lib/accountMoney";
import type { DesktopKey, Money } from "@/lib/api/desktop";
vi.mock("@/lib/api/account", async (original) => ({
  ...(await original<typeof import("@/lib/api/account")>()),
  desktopRequest: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
const state: AccountState = {
  ...disconnectedAccount,
  status: "connected",
  generation: 1,
  identity: {
    userId: "42",
    username: "synthetic",
    displayName: "Synthetic",
    connectionId: "fixture",
  },
};
const key: DesktopKey = {
  id: "101",
  name: "Synthetic Key",
  masked_key: "sk-synthetic…demo",
  status: 1,
  group: "default",
  created_time: 1,
  accessed_time: 0,
  expired_time: -1,
  remain_quota: "1000000",
  used_quota: "500000",
  unlimited_quota: false,
  model_limits_enabled: false,
  model_limits: "",
  allow_ips: null,
  exclude_ips: null,
  is_expired: false,
};
const money: Money = {
  quota_per_unit: "500000",
  base_currency: "USD",
  display_type: "USD",
  usd_exchange_rate: "7.3",
  custom_currency_symbol: "",
  custom_currency_exchange_rate: "1",
};
const env = (data: unknown) => ({
  success: true as const,
  message: "",
  data,
  meta: {
    contract_version: "system-token-v1",
    request_id: "fixture",
    generated_at: 1,
  },
});
function setup(
  element: React.ReactNode = (
    <>
      <CurrencySwitcher />
      <Keys state={state} />
    </>
  ),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  i18n.addResourceBundle("zh", "translation", zh, true, true);
  vi.clearAllMocks();
  localStorage.setItem("tuzi-account-display-currency", "CNY");
  vi.mocked(invoke).mockResolvedValue([]);
  vi.mocked(desktopRequest).mockImplementation(async (req) => {
    if (req.path === "/account/account")
      return env({ quota: "1000000", money }) as never;
    if (req.path === "/account/key-groups")
      return env([{ id: "default", label: "默认分组" }]) as never;
    if (req.method === "DELETE") return env({}) as never;
    if (req.method === "POST")
      return env({ id: "102", key: "sk-synthetic-new-only" }) as never;
    if (req.path === `/account/keys/${key.id}`) return env(key) as never;
    return env({
      items: [key],
      page: 1,
      page_size: 20,
      total: "1",
      has_more: false,
    }) as never;
  });
});
describe("B09 key workflow regressions", () => {
  it("waits for explicit delete confirmation, cancel and Escape send zero requests; double click sends once", async () => {
    let finish!: () => void;
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.method === "DELETE")
        return await new Promise((resolve) => {
          finish = () => resolve(env({}) as never);
        });
      if (req.path === "/account/key-groups") return env([]) as never;
      return env({ items: [key], page: 1, has_more: false }) as never;
    });
    setup();
    await screen.findByText(key.name);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(
      vi
        .mocked(desktopRequest)
        .mock.calls.filter(([r]) => r.method === "DELETE"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      vi
        .mocked(desktopRequest)
        .mock.calls.filter(([r]) => r.method === "DELETE"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const confirm = screen.getByRole("button", { name: "确认删除" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(finish).toBeDefined());
    expect(
      vi
        .mocked(desktopRequest)
        .mock.calls.filter(([r]) => r.method === "DELETE"),
    ).toHaveLength(1);
    await act(async () => finish());
  });
  it("shows monetary limits in CNY by default and switches display only; permanent expiry has a readable label", async () => {
    setup();
    await screen.findByText("¥14.60 / ¥7.30");
    expect(screen.getByText("永不到期")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "USD" }));
    await screen.findByText("$2.00 / $1.00");
    expect(
      vi.mocked(desktopRequest).mock.calls.every(([r]) => r.method === "GET"),
    ).toBe(true);
  });
  it("does not fill a new create draft with a delayed detail response, and details are read-only until Edit", async () => {
    let finish!: () => void;
    const base = vi.mocked(desktopRequest).getMockImplementation()!;
    vi.mocked(desktopRequest).mockImplementation(async (req, signal) =>
      req.path === `/account/keys/${key.id}`
        ? await new Promise((resolve) => {
            finish = () => resolve(env(key) as never);
          })
        : base(req, signal),
    );
    setup();
    await screen.findByText(key.name);
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.queryByRole("textbox", { name: "名称" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "创建密钥" }));
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), {
      target: { value: "New draft" },
    });
    await act(async () => finish());
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue(
      "New draft",
    );
  });
  it("creates with website defaults and keeps advanced fields collapsed", async () => {
    setup();
    await screen.findByText(key.name);
    fireEvent.click(screen.getByRole("button", { name: "创建密钥" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "名称" }), {
      target: { value: "Synthetic new" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await screen.findByDisplayValue("sk-synthetic-new-only");
    expect(
      vi
        .mocked(desktopRequest)
        .mock.calls.find(([r]) => r.method === "POST")?.[0].body,
    ).toMatchObject({
      name: "Synthetic new",
      group: "default",
      expired_time: -1,
      unlimited_quota: true,
      model_limits_enabled: false,
      allow_ips: "",
      exclude_ips: "",
    });
  });
  it("places key-specific empty state inside table, never the consumption placeholder", async () => {
    const base = vi.mocked(desktopRequest).getMockImplementation()!;
    vi.mocked(desktopRequest).mockImplementation(async (req, signal) =>
      req.path === "/account/keys"
        ? (env({ items: [], page: 1, total: "0", has_more: false }) as never)
        : base(req, signal),
    );
    setup();
    expect(await screen.findByText("还没有 API 密钥")).toBeVisible();
    expect(screen.queryByText(/不代表实际消费为零/)).toBeNull();
    expect(screen.getByText("还没有 API 密钥").closest("td")).not.toBeNull();
  });
  it("routes an existing known configuration without revealing or duplicating its key", async () => {
    vi.mocked(invoke).mockResolvedValue([
      {
        site: "https://api.tu-zi.com",
        userId: "42",
        tokenId: "101",
        app: "codex",
        providerId: "provider-1",
      },
    ]);
    const existing = vi.fn(),
      ready = vi.fn();
    setup(
      <ConfigureTool
        state={state}
        keyDto={key}
        onClose={vi.fn()}
        onReady={ready}
        onExisting={existing}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Codex/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Codex/ }));
    expect(existing).toHaveBeenCalledWith("codex", "provider-1");
    expect(ready).not.toHaveBeenCalled();
    expect(desktopRequest).not.toHaveBeenCalled();
  });
  it("does not mistake another account source for configured; filters incompatible models and forwards chosen tool", async () => {
    vi.mocked(invoke).mockResolvedValue([
      {
        site: "https://api.tu-zi.com",
        userId: "other",
        tokenId: "101",
        app: "codex",
        providerId: "wrong",
      },
    ]);
    const ready = vi.fn();
    vi.mocked(desktopRequest).mockImplementation(async (req) =>
      req.method === "POST"
        ? (env({ key: "sk-synthetic-config-only" }) as never)
        : (env({
            items: [
              {
                model_name: "compatible-fixture",
                enable_groups: ["default"],
                supported_endpoint_types: ["openai-response"],
              },
              {
                model_name: "missing-protocol-fixture",
                enable_groups: ["default"],
                supported_endpoint_types: null,
              },
              {
                model_name: "missing-groups-fixture",
                enable_groups: null,
                supported_endpoint_types: ["openai-response"],
              },
              {
                model_name: "incompatible-fixture",
                enable_groups: ["default"],
                supported_endpoint_types: ["gemini"],
              },
            ],
            pagination: { has_more: false },
            snapshot_id: "fixture",
            snapshot_refreshed: false,
            pricing_meta: {},
          }) as never),
    );
    setup(
      <ConfigureTool
        state={state}
        keyDto={key}
        onClose={vi.fn()}
        onReady={ready}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Codex/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Codex/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "模型" }));
    await screen.findByRole("option", { name: "compatible-fixture" });
    expect(
      screen.queryByRole("option", { name: "incompatible-fixture" }),
    ).toBeNull();
    expect(
      screen.queryByRole("option", { name: "missing-protocol-fixture" }),
    ).toBeNull();
    expect(
      screen.queryByRole("option", { name: "missing-groups-fixture" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "compatible-fixture" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await waitFor(() =>
      expect(ready).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: "codex",
          protocol: "responses",
          tokenId: "101",
          key: "sk-synthetic-config-only",
        }),
      ),
    );
  });
  it.each([
    {
      appId: "claude",
      label: /^Claude 选择并配置$/,
      protocol: "anthropic",
      endpoint: "claude code",
      path: "/v1/messages",
    },
    {
      appId: "gemini",
      label: /^Gemini 选择并配置$/,
      protocol: "gemini",
      endpoint: "gemini generateContent",
      path: "/v1beta/models/{model}:generateContent",
    },
    {
      appId: "openclaw",
      label: /^OpenClaw 选择并配置$/,
      protocol: "chat",
      endpoint: "OpenAI-Chat",
      path: "/v1/chat/completions",
    },
  ])(
    "selects catalog endpoint labels and preserves the Key/model for $appId",
    async ({ appId, label, protocol, endpoint, path }) => {
      const ready = vi.fn();
      vi.mocked(invoke).mockResolvedValue([]);
      vi.mocked(desktopRequest).mockImplementation(async (req) =>
        req.method === "POST"
          ? (env({ key: "SYNTHETIC_MODEL_KEY" }) as never)
          : (env({
              items: [
                {
                  model_name: "synthetic-catalog-model",
                  enable_groups: ["default"],
                  supported_endpoint_types: [endpoint],
                  endpoints: { [endpoint]: { path, method: "POST" } },
                },
              ],
              pagination: { has_more: false },
              snapshot_id: "fixture",
              pricing_meta: {},
            }) as never),
      );
      setup(
        <ConfigureTool
          state={state}
          keyDto={key}
          onClose={vi.fn()}
          onReady={ready}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: label })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: label }));
      fireEvent.click(screen.getByRole("combobox", { name: "模型" }));
      fireEvent.click(
        await screen.findByRole("option", { name: "synthetic-catalog-model" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "下一步" }));
      await waitFor(() =>
        expect(ready).toHaveBeenCalledWith(
          expect.objectContaining({
            appId,
            protocol,
            model: "synthetic-catalog-model",
            key: "SYNTHETIC_MODEL_KEY",
            tokenId: "101",
          }),
        ),
      );
    },
  );

  it("converts monetary input using exact station rate without changing stored existing quota", () => {
    expect(amountToQuota("7.30", money, "CNY")).toBe("500000");
    expect(amountToQuota("1", money, "USD")).toBe("500000");
    expect(amountToQuota("0.000001", money, "USD")).toBe("1");
    expect(() => amountToQuota("-1", money, "CNY")).toThrow();
    expect(() => amountToQuota("1.000000001", money, "CNY")).toThrow();
  });
});
