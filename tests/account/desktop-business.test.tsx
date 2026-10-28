import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import i18n from "i18next";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) =>
    command === "tuzi_native_tool_sources"
      ? { sources: [], unavailable: [] }
      : [],
  ),
}));
import { ConfigureTool } from "@/components/account/ConfigureTool";
import { AccountMetrics } from "@/components/account/AccountMetrics";
import zh from "@/i18n/locales/zh.json";
import {
  desktopRequest,
  openAccountWeb,
  disconnectedAccount,
  type AccountState,
} from "@/lib/api/account";
import type { DesktopKey, Envelope, Money, Profile } from "@/lib/api/desktop";
import { formatMoney } from "@/lib/accountMoney";
import { useDesktop } from "@/lib/query/desktop";
import {
  Keys,
  Overview,
  Logs,
  ModelsPage,
  ProfilePage,
  WebEntry,
} from "@/components/account/BusinessPages";
vi.mock("@/lib/api/account", async (original) => ({
  ...(await original<typeof import("@/lib/api/account")>()),
  desktopRequest: vi.fn(),
  openAccountWeb: vi.fn(),
}));
const state: AccountState = {
  ...disconnectedAccount,
  status: "connected",
  generation: 3,
  identity: {
    userId: "9007199254740993",
    username: "synthetic",
    displayName: "Synthetic",
    connectionId: "synthetic-connection",
  },
};
const key: DesktopKey = {
  id: "9007199254740997",
  name: "Synthetic key",
  masked_key: "sk-SYN…MASK",
  status: 1,
  group: "default",
  created_time: 1,
  accessed_time: 0,
  expired_time: -1,
  remain_quota: "100",
  used_quota: "1",
  unlimited_quota: false,
  model_limits_enabled: false,
  model_limits: "",
  allow_ips: null,
  exclude_ips: null,
  is_expired: false,
};
const profile: Profile = {
  user_id: state.identity!.userId,
  username: "synthetic",
  email: "",
  display_name: "Synthetic",
  language: "zh-CN",
  accept_unset_model_ratio_model: true,
  high_concurrency_enabled: true,
  record_ip_log: true,
};
const env = <T,>(data: T): Envelope<T> => ({
  success: true,
  message: "",
  data,
  meta: {
    contract_version: "system-token-v1",
    request_id: "synthetic",
    generated_at: 1,
  },
});
const money: Money = {
  quota_per_unit: "100",
  base_currency: "USD",
  display_type: "USD",
  usd_exchange_rate: "7.03",
  custom_currency_symbol: "X",
  custom_currency_exchange_rate: "2.5",
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks();
  i18n.addResourceBundle("zh", "translation", zh, true, true);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.mocked(openAccountWeb).mockResolvedValue();
});
describe("decimal money contract", () => {
  it("keeps values above safe integers and metadata rates exact", () => {
    expect(formatMoney("9007199254740993", money)).toBe(
      "USD 90071992547409.93",
    );
    expect(formatMoney("100", { ...money, display_type: "CNY" })).toBe(
      "CNY 7.03",
    );
    expect(formatMoney("100", { ...money, display_type: "CUSTOM" })).toBe(
      "X 2.50",
    );
  });
  it("rounds half-up and marks tiny positive amounts rather than zero", () => {
    expect(formatMoney("1", { ...money, quota_per_unit: "200" })).toBe(
      "USD 0.01",
    );
    expect(formatMoney("1", { ...money, quota_per_unit: "100000" })).toBe(
      "USD <0.01",
    );
    expect(formatMoney("-1", { ...money, quota_per_unit: "200" })).toBe(
      "USD -0.01",
    );
    expect(formatMoney("123", { ...money, display_type: "TOKENS" })).toBe(
      "123 quota",
    );
  });
});
describe("identity-isolated native business queries", () => {
  it("never retains previous rows across an account generation change", async () => {
    vi.mocked(desktopRequest).mockResolvedValueOnce(env({ owner: "A" }));
    const { wrapper } = setup();
    const hook = renderHook(
      ({ s, page }) =>
        useDesktop<{ owner: string }>(
          s,
          "/account/keys",
          { page },
          30000,
          false,
          true,
        ),
      { wrapper, initialProps: { s: state, page: 1 } },
    );
    await waitFor(() => expect(hook.result.current.data?.data.owner).toBe("A"));
    vi.mocked(desktopRequest).mockImplementation(() => new Promise(() => {}));
    hook.rerender({ s: state, page: 2 });
    expect(hook.result.current.data?.data.owner).toBe("A");
    expect(hook.result.current.isPlaceholderData).toBe(true);
    hook.rerender({
      s: { ...state, generation: state.generation + 1 },
      page: 2,
    });
    expect(hook.result.current.data).toBeUndefined();
    hook.unmount();
  });

  it("discards delayed results after identity changes and cancels old signal", async () => {
    let finish!: (v: Envelope<{ owner: string }>) => void;
    vi.mocked(desktopRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(desktopRequest).mockResolvedValue(env({ owner: "B" }));
    const { wrapper } = setup();
    const hook = renderHook(
      ({ s }) => useDesktop<{ owner: string }>(s, "/account/account"),
      { wrapper, initialProps: { s: state } },
    );
    await waitFor(() => expect(desktopRequest).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(desktopRequest).mock.calls[0][1]!;
    hook.rerender({
      s: {
        ...state,
        generation: 4,
        identity: { ...state.identity!, userId: "B", connectionId: "B" },
      },
    });
    await waitFor(() => expect(hook.result.current.data?.data.owner).toBe("B"));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(env({ owner: "A" })));
    expect(hook.result.current.data?.data.owner).toBe("B");
  });
  it("keeps permission failures visible without retries or empty data", async () => {
    vi.mocked(desktopRequest).mockRejectedValue({
      code: "insufficient_scope",
      status: 403,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDesktop(state, "/account/logs"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(desktopRequest).toHaveBeenCalledTimes(1);
  });
  it("pauses hidden views and cancels outstanding reads", async () => {
    vi.mocked(desktopRequest).mockImplementation(() => new Promise(() => {}));
    const { wrapper } = setup();
    const hook = renderHook(() => useDesktop(state, "/account/logs"), {
      wrapper,
    });
    await waitFor(() => expect(desktopRequest).toHaveBeenCalledOnce());
    const signal = vi.mocked(desktopRequest).mock.calls[0][1]!;
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(signal.aborted).toBe(true));
    hook.unmount();
  });
});
describe("recorded usage availability", () => {
  it("keeps daily consumption unknown when logs cannot confirm any records", async () => {
    vi.mocked(desktopRequest).mockImplementation(async (request) => {
      if (request.path === "/account/account")
        return env({ quota: "125", money });
      throw { code: "logs_unavailable" };
    });
    const { wrapper } = setup();
    const view = render(
      <AccountMetrics state={state} accountEnabled usageEnabled />,
      { wrapper },
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        zh.account.business.errors.logs_unavailable,
      ),
    );
    const values = Array.from(view.container.querySelectorAll("dd"));
    expect(values.map((element) => element.textContent)).toEqual([
      "¥8.79",
      "—",
      "—",
      "—",
    ]);
    expect(
      screen.getByTitle(zh.account.business.usageNotice),
    ).toBeInTheDocument();
  });
});

describe("overview time window", () => {
  it.each([
    [
      "same-day invalidation",
      new Date(2026, 9, 14, 10, 0),
      new Date(2026, 9, 14, 12, 30),
      false,
    ],
    [
      "visible again after midnight",
      new Date(2026, 9, 14, 23, 50),
      new Date(2026, 9, 15, 0, 10),
      true,
    ],
    [
      "local daylight-saving day",
      new Date(2026, 2, 8, 1, 30),
      new Date(2026, 2, 8, 4, 30),
      true,
    ],
  ])(
    "recomputes the paired consumption window on %s",
    async (_name, opened, refreshed, visibility) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(opened);
        vi.mocked(desktopRequest).mockImplementation(async (req) => {
          if (req.path.endsWith("/account"))
            return env({
              username: "synthetic",
              group: "default",
              quota: "1",
              used_quota: "1",
              request_count: "1",
              money,
            });
          const range = Object.fromEntries(req.query ?? []);
          if (req.path.endsWith("/summary"))
            return env({
              call_count: "1",
              quota: "1",
              prompt_tokens: "1",
              completion_tokens: "1",
            });
          return env({
            chart: [],
            table: [],
            start_time: Number(range.start_time),
            end_time: Number(range.end_time),
          });
        });
        const { wrapper, client } = setup();
        const view = render(<Overview state={state} />, { wrapper });
        const calls = () =>
          vi
            .mocked(desktopRequest)
            .mock.calls.map(([r]) => r)
            .filter((r) => r.path.includes("/usage"));
        await waitFor(() => expect(calls()).toHaveLength(2));
        const assertWindow = (offset: number, time: Date) => {
          const start = new Date(time);
          start.setHours(0, 0, 0, 0);
          for (const req of calls().slice(offset, offset + 2)) {
            expect(Object.fromEntries(req.query ?? [])).toMatchObject({
              start_time: String(start.getTime() / 1000),
              end_time: String(time.getTime() / 1000),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          }
        };
        assertWindow(0, opened);
        if (visibility) {
          act(() => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "hidden",
            });
            document.dispatchEvent(new Event("visibilitychange"));
          });
        }
        vi.setSystemTime(refreshed);
        if (visibility) {
          await act(async () => {
            await client.invalidateQueries({ queryKey: ["account"] });
          });
          expect(calls()).toHaveLength(2);
          act(() => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "visible",
            });
            document.dispatchEvent(new Event("visibilitychange"));
          });
        } else {
          await act(async () => {
            await client.invalidateQueries({ queryKey: ["account"] });
          });
        }
        await waitFor(() => expect(calls()).toHaveLength(4));
        assertWindow(2, refreshed);
        view.rerender(<Overview state={state} localStatus="changed" />);
        expect(calls()).toHaveLength(4);
        view.unmount();
        client.clear();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("does not let a canceled previous-day read replace the new paired result", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 14, 23, 50));
      const finishes: Array<() => void> = [];
      const signals: AbortSignal[] = [];
      let delayed = true;
      vi.mocked(desktopRequest).mockImplementation(async (req, signal) => {
        if (req.path.endsWith("/account"))
          return env({
            username: "synthetic",
            group: "default",
            quota: "1",
            used_quota: "1",
            request_count: "1",
            money,
          });
        const range = Object.fromEntries(req.query ?? []);
        const result = req.path.endsWith("/summary")
          ? env({
              call_count: delayed ? "111" : "222",
              quota: "1",
              prompt_tokens: "1",
              completion_tokens: "1",
            })
          : env({
              chart: [],
              table: [],
              start_time: Number(range.start_time),
              end_time: Number(range.end_time),
            });
        if (delayed) {
          signals.push(signal!);
          return new Promise((resolve) => finishes.push(() => resolve(result)));
        }
        return result;
      });
      const { wrapper, client } = setup();
      const view = render(<Overview state={state} />, { wrapper });
      await waitFor(() => expect(finishes).toHaveLength(2));
      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(signals.every((s) => s.aborted)).toBe(true));
      delayed = false;
      vi.setSystemTime(new Date(2026, 9, 15, 0, 10));
      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await screen.findByText(/222/);
      await act(async () => finishes.forEach((finish) => finish()));
      expect(screen.queryByText(/111/)).not.toBeInTheDocument();
      expect(screen.getByText(/222/)).toBeVisible();
      view.unmount();
      client.clear();
    } finally {
      vi.useRealTimers();
    }
  });
  it("pins summary and trend to the same explicit local day window", async () => {
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.path.endsWith("/account"))
        return env({
          username: "synthetic",
          group: "default",
          quota: "1",
          used_quota: "1",
          request_count: "1",
          money,
        });
      if (req.path.endsWith("/summary"))
        return env({
          call_count: "1",
          quota: "1",
          prompt_tokens: "1",
          completion_tokens: "1",
        });
      return env({ chart: [], table: [], start_time: 1, end_time: 2 });
    });
    const { wrapper } = setup();
    render(<Overview state={state} />, { wrapper });
    await waitFor(() =>
      expect(
        vi
          .mocked(desktopRequest)
          .mock.calls.some(([r]) => r.path.endsWith("/summary")),
      ).toBe(true),
    );
    const calls = vi
      .mocked(desktopRequest)
      .mock.calls.map(([r]) => r)
      .filter((r) => r.path.includes("/usage"));
    const range = (query: (typeof calls)[number]["query"]) =>
      query?.filter(([k]) =>
        ["start_time", "end_time", "timezone"].includes(k),
      );
    expect(range(calls[0].query)).toEqual(range(calls[1].query));
    expect(range(calls[0].query)).toHaveLength(3);
  });
});
describe("business actions and secret lifetime", () => {
  it("holds explicitly revealed model keys outside every query cache and clears on close", async () => {
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.path.endsWith("/reveal"))
        return env({ key: "SYNTHETIC_MODEL_KEY_ONLY" });
      if (req.path.endsWith("key-groups"))
        return env([{ id: "default", label: "Default" }]);
      return env({
        page: 1,
        page_size: 20,
        total: "1",
        has_more: false,
        items: [key],
      });
    });
    const { wrapper, client } = setup();
    render(<Keys state={state} />, { wrapper });
    await screen.findByText(/Synthetic key/);
    expect(screen.queryByDisplayValue("SYNTHETIC_MODEL_KEY_ONLY")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.reveal }),
    );
    await screen.findByDisplayValue("SYNTHETIC_MODEL_KEY_ONLY");
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("SYNTHETIC_MODEL_KEY_ONLY");
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.close }),
    );
    expect(screen.queryByDisplayValue("SYNTHETIC_MODEL_KEY_ONLY")).toBeNull();
  });
  it("discards a reveal that finishes after its view is closed", async () => {
    let finish!: (value: Envelope<{ key: string }>) => void;
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.path.endsWith("/reveal"))
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (req.path.endsWith("key-groups"))
        return env([{ id: "default", label: "Default" }]);
      return env({
        page: 1,
        page_size: 20,
        total: "1",
        has_more: false,
        items: [key],
      });
    });
    const { wrapper, client } = setup();
    render(<Keys state={state} />, { wrapper });
    await screen.findByText(/Synthetic key/);
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.reveal }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.close }),
    );
    await act(async () => finish(env({ key: "SYNTHETIC_LATE_SECRET_ONLY" })));
    expect(screen.queryByDisplayValue("SYNTHETIC_LATE_SECRET_ONLY")).toBeNull();
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("SYNTHETIC_LATE_SECRET_ONLY");
  });
  it.each(["filter", "page"])(
    "discards a reveal after %s changes",
    async (change) => {
      let finish!: (value: Envelope<{ key: string }>) => void;
      vi.mocked(desktopRequest).mockImplementation(async (req) => {
        if (req.path.endsWith("/reveal"))
          return new Promise((resolve) => {
            finish = resolve;
          });
        if (req.path.endsWith("key-groups")) return env([]);
        return env({
          page: 1,
          page_size: 20,
          total: "30",
          has_more: true,
          items: [key],
        });
      });
      const { wrapper } = setup();
      render(<Keys state={state} />, { wrapper });
      await screen.findByText(/Synthetic key/);
      fireEvent.click(
        screen.getByRole("button", { name: zh.account.business.reveal }),
      );
      await waitFor(() => expect(finish).toBeDefined());
      if (change === "filter")
        fireEvent.change(
          screen.getByLabelText(zh.account.business.keyFilter.keyword),
          { target: { value: "changed" } },
        );
      else
        fireEvent.click(
          screen.getByRole("button", { name: zh.account.business.next }),
        );
      await act(async () =>
        finish(env({ key: "SYNTHETIC_LATE_FILTER_SECRET" })),
      );
      expect(
        screen.queryByDisplayValue("SYNTHETIC_LATE_FILTER_SECRET"),
      ).toBeNull();
    },
  );
  it("discards a created secret after the form is canceled", async () => {
    let finish!: (value: Envelope<{ id: string; key: string }>) => void;
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.method === "POST")
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (req.path.endsWith("key-groups"))
        return env([{ id: "default", label: "Default" }]);
      return env({
        page: 1,
        page_size: 20,
        total: "0",
        has_more: false,
        items: [],
      });
    });
    const { wrapper } = setup();
    render(<Keys state={state} />, { wrapper });
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.create }),
    );
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Synthetic create" },
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("combobox", { name: "分组" })
          .querySelector('option[value="default"]') ||
          screen.queryByText(/Default · 主分组/),
      ).toBeTruthy(),
    );
    if (!screen.queryByText(/Default · 主分组/))
      fireEvent.change(screen.getByRole("combobox", { name: "分组" }), {
        target: { value: "default" },
      });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: zh.common.cancel }));
    await act(async () =>
      finish(env({ id: "99", key: "SYNTHETIC_CANCELED_CREATED_SECRET" })),
    );
    expect(
      screen.queryByDisplayValue("SYNTHETIC_CANCELED_CREATED_SECRET"),
    ).toBeNull();
  });
  it.each([
    ["Claude", "claude", "anthropic", "claude code"],
    ["Claude Desktop", "claude-desktop", "anthropic", "claude code"],
    ["Gemini", "gemini", "gemini", "gemini generateContent"],
    ["OpenCode", "opencode", "anthropic", "claude code"],
    ["OpenClaw", "openclaw", "anthropic", "claude code"],
    ["Hermes", "hermes", "anthropic", "claude code"],
    ["Grok Build", "grokbuild", "anthropic", "claude code"],
    ["Pi", "pi", "anthropic", "claude code"],
    ["MiniMax Code", "mcode", "anthropic", "claude code"],
  ])(
    "offers known catalog aliases without endpoint details for %s",
    async (label, app, protocol, alias) => {
      Element.prototype.scrollIntoView = vi.fn();
      vi.mocked(desktopRequest).mockImplementation(async (req) =>
        req.path.endsWith("/reveal")
          ? (env({ key: "SYNTHETIC_MODEL_KEY" }) as never)
          : (env({
              items: [
                {
                  model_name: "synthetic-compatible",
                  supported_endpoint_types: [alias],
                },
                {
                  model_name: "synthetic-unknown",
                  supported_endpoint_types: ["unverified-label"],
                },
                {
                  model_name: "synthetic-image",
                  supported_endpoint_types: ["image-generation"],
                },
              ],
            }) as never),
      );
      const onReady = vi.fn();
      const { wrapper } = setup();
      render(
        <ConfigureTool
          state={state}
          keyDto={key}
          onClose={vi.fn()}
          onReady={onReady}
        />,
        { wrapper },
      );
      const tool = screen.getByRole("button", {
        name: new RegExp(`^${label}\\s+选择并配置$`),
      });
      await waitFor(() => expect(tool).toBeEnabled());
      fireEvent.click(tool);
      await screen.findByText("已获取 3 个模型");
      fireEvent.click(screen.getByRole("combobox"));
      expect(
        await screen.findByRole("option", { name: "synthetic-compatible" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.queryByText(/暂无法确认兼容性/)).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("搜索模型"), {
        target: { value: "unknown" },
      });
      expect(
        await screen.findByText("没有匹配的可用模型。"),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("搜索模型"), {
        target: { value: "" },
      });
      fireEvent.click(
        await screen.findByRole("option", { name: "synthetic-compatible" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "下一步" }));
      await waitFor(() =>
        expect(onReady).toHaveBeenCalledWith(
          expect.objectContaining({
            appId: app,
            protocol,
            model: "synthetic-compatible",
          }),
        ),
      );
    },
  );
  it("shows an empty state when all fetched models are hidden", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(desktopRequest).mockResolvedValue(
      env({
        items: [
          { model_name: "synthetic-unknown", supported_endpoint_types: [] },
        ],
      }),
    );
    const { wrapper } = setup();
    render(
      <ConfigureTool
        state={state}
        keyDto={key}
        onClose={vi.fn()}
        onReady={vi.fn()}
      />,
      { wrapper },
    );
    const tool = screen.getByRole("button", { name: /Gemini/ });
    await waitFor(() => expect(tool).toBeEnabled());
    fireEvent.click(tool);
    await screen.findByText("已获取 1 个模型");
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    fireEvent.click(screen.getByRole("combobox"));
    expect(
      await screen.findByText("暂无可用于此工具的模型。"),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
  it("loads the complete Key model list including models beyond the old first page", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(desktopRequest).mockResolvedValue(
      env({
        items: [
          ...Array.from({ length: 130 }, (_, i) => ({
            model_name: `synthetic-${i}`,
            supported_endpoint_types: ["anthropic"],
          })),
          ...["gpt-6.1-sol", "gpt-6-astra"].map((model_name) => ({
            model_name,
            supported_endpoint_types: ["openai"],
          })),
        ],
      }),
    );
    const { wrapper } = setup();
    render(
      <ConfigureTool
        state={state}
        keyDto={key}
        onClose={vi.fn()}
        onReady={vi.fn()}
      />,
      { wrapper },
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Codex/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Codex/ }));
    await waitFor(() => expect(desktopRequest).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("gpt-6.1-sol")).toBeInTheDocument();
    expect(screen.getByText("gpt-6-astra")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(132);
    expect(screen.getByText("已获取 132 个模型")).toBeInTheDocument();
    expect(screen.queryByText(/与“获取模型列表”一致/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "gpt-6-astra" }));
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    expect(
      vi
        .mocked(desktopRequest)
        .mock.calls.every(
          ([req]) =>
            req.path === `/account/keys/${key.id}/models` && !req.query?.length,
        ),
    ).toBe(true);
  });
  it("waits for a complete suffix and retains rows while refreshing", async () => {
    const page = env({
      items: [key],
      page: 1,
      page_size: 20,
      total: "1",
      has_more: false,
    });
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.path.endsWith("key-groups")) return env([]) as never;
      if (
        req.path === "/account/keys" &&
        req.query?.some(([k]) => k === "token")
      )
        return new Promise(() => {});
      return page as never;
    });
    const { wrapper } = setup();
    render(<Keys state={state} />, { wrapper });
    await screen.findByText("Synthetic key");
    vi.mocked(desktopRequest).mockClear();
    const input = screen.getByLabelText(zh.account.business.keyFilter.token);
    fireEvent.change(input, { target: { value: "s" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(desktopRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input, { target: { value: "aB19" } });
    await waitFor(() =>
      expect(desktopRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/account/keys",
          query: expect.arrayContaining([["token", "aB19"]]),
        }),
        expect.anything(),
      ),
    );
    expect(screen.getByText("Synthetic key")).toBeInTheDocument();
    expect(screen.queryByText("没有找到匹配的密钥")).toBeNull();
  });
  it("shows a retry instead of an empty-result message after a search failure", async () => {
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.path.endsWith("key-groups")) return env([]) as never;
      if (
        req.path === "/account/keys" &&
        req.query?.some(([k]) => k === "keyword")
      )
        throw { code: "network_uncertain" };
      return env({
        items: [key],
        page: 1,
        page_size: 20,
        total: "1",
        has_more: false,
      }) as never;
    });
    const { wrapper } = setup();
    render(<Keys state={state} />, { wrapper });
    await screen.findByText("Synthetic key");
    fireEvent.change(
      screen.getByLabelText(zh.account.business.keyFilter.keyword),
      { target: { value: "test" } },
    );
    expect(
      await screen.findByRole("button", { name: "重试" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("没有找到匹配的密钥")).toBeNull();
  });
  it("does not replay an uncertain create", async () => {
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.method === "POST")
        throw { code: "transport_error", outcomeUnknown: true };
      if (req.path.endsWith("key-groups"))
        return env([{ id: "default", label: "Default" }]);
      return env({
        page: 1,
        page_size: 20,
        total: "0",
        has_more: false,
        items: [],
      });
    });
    const { wrapper } = setup();
    render(<Keys state={state} />, { wrapper });
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.create }),
    );
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Synthetic uncertain" },
    });
    await screen.findByRole("option", { name: "Default" });
    fireEvent.change(
      screen.getByRole("combobox", { name: zh.account.business.group }),
      { target: { value: "default" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await screen.findByText(zh.account.business.unknownOutcome);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: zh.account.business.create }),
    ).toBeDisabled();
    expect(
      vi.mocked(desktopRequest).mock.calls.filter(([r]) => r.method === "POST"),
    ).toHaveLength(1);
  });
  it.each(["create", "edit", "status", "delete", "delete404"])(
    "keeps uncertain %s locked through failed verification and unrelated actions",
    async (scenario) => {
      const kind = scenario === "delete404" ? "delete" : scenario;
      let failed = false;
      let rejectRead = true;
      let finishRead: (() => void) | undefined;
      vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(desktopRequest).mockImplementation(async (req) => {
        if (req.path.endsWith("/reveal"))
          return env({ key: "sk-synthetic-reveal-only" });
        if (req.method !== "GET") {
          failed = true;
          throw { code: "transport_error", outcomeUnknown: true };
        }
        if (req.path.endsWith("key-groups"))
          return env([{ id: "default", label: "Default" }]);
        if (failed && rejectRead) {
          await new Promise<void>((resolve) => {
            finishRead = resolve;
          });
          throw kind === "delete"
            ? { code: "business_error", status: 200 }
            : { code: "transport_error" };
        }
        if (req.path === `/account/keys/${key.id}`) {
          if (kind === "delete" && failed)
            throw {
              code: "not_found",
              status: scenario === "delete404" ? 404 : 200,
            };
          return env(key);
        }
        return env({
          page: 1,
          page_size: 20,
          total: "1",
          has_more: false,
          items: [key],
        });
      });
      const { wrapper } = setup();
      render(<Keys state={state} />, { wrapper });
      await screen.findByText(/Synthetic key/);
      const click = (name: string) =>
        fireEvent.click(screen.getByRole("button", { name }));
      if (kind === "create" || kind === "edit") {
        click(
          kind === "create"
            ? zh.account.business.create
            : zh.account.business.details,
        );
        if (kind === "edit") {
          await waitFor(() =>
            expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled(),
          );
          click("编辑");
        }
        const name = await screen.findByRole("textbox", {
          name: zh.account.business.name,
        });
        fireEvent.change(name, { target: { value: "Synthetic changed" } });
        click(kind === "create" ? "创建" : zh.account.business.save);
      } else
        click(
          kind === "status"
            ? zh.account.business.disable
            : zh.account.business.delete,
        );
      if (kind === "delete") click("确认删除");
      await screen.findByText(zh.account.business.unknownOutcome);
      click(zh.account.business.verify);
      await waitFor(() => expect(finishRead).toBeDefined());
      expect(
        screen.getByRole("button", { name: zh.account.business.verify }),
      ).toBeDisabled();
      const readsBefore = vi.mocked(desktopRequest).mock.calls.length;
      click(zh.account.business.verify);
      expect(vi.mocked(desktopRequest).mock.calls).toHaveLength(readsBefore);
      await act(async () => finishRead!());
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: zh.account.business.verify }),
        ).toBeEnabled(),
      );
      expect(
        screen.getByText(zh.account.business.unknownOutcome),
      ).toBeVisible();
      for (const name of [
        zh.account.business.create,
        zh.account.business.details,
        zh.account.business.disable,
        zh.account.business.delete,
      ]) {
        expect(screen.getByRole("button", { name })).toBeDisabled();
        click(name);
      }
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      click(zh.account.business.reveal);
      await screen.findByDisplayValue("sk-synthetic-reveal-only");
      click(zh.account.business.close);
      expect(
        screen.getByText(zh.account.business.unknownOutcome),
      ).toBeVisible();
      rejectRead = false;
      click(zh.account.business.verify);
      await screen.findByRole("button", {
        name: zh.account.business.verifyAcknowledge,
      });
      expect(
        screen.getByText(zh.account.business.unknownOutcome),
      ).toBeVisible();
      click(zh.account.business.verifyAcknowledge);
      expect(
        screen.queryByText(zh.account.business.unknownOutcome),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: zh.account.business.save }),
      ).not.toBeInTheDocument();
      expect(
        vi
          .mocked(desktopRequest)
          .mock.calls.filter(
            ([r]) => r.method !== "GET" && !r.path.endsWith("/reveal"),
          ),
      ).toHaveLength(1);
    },
  );
  it("recovers an uncertain profile write only after a successful reread", async () => {
    let writes = 0;
    vi.mocked(desktopRequest).mockImplementation(async (req) => {
      if (req.method === "PATCH") {
        if (++writes === 1)
          throw { code: "network_uncertain", outcomeUnknown: true };
        return env({ ...profile, record_ip_log: false });
      }
      return env(profile);
    });
    const { wrapper } = setup();
    render(<ProfilePage state={state} canWrite />, { wrapper });
    await screen.findByDisplayValue("Synthetic");
    fireEvent.click(
      screen.getByRole("checkbox", { name: zh.account.business.record_ip_log }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.save }),
    );
    await screen.findByText(zh.account.business.unknownOutcome);
    expect(
      screen.getByRole("button", { name: zh.account.business.save }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.verify }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: zh.account.business.save }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("checkbox", { name: zh.account.business.record_ip_log }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: zh.account.business.record_ip_log }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.save }),
    );
    await waitFor(() => expect(writes).toBe(2));
  });
  it("patches only changed profile fields and preserves explicit false", async () => {
    vi.mocked(desktopRequest).mockImplementation(async (req) =>
      env(
        req.method === "PATCH" ? { ...profile, record_ip_log: false } : profile,
      ),
    );
    const { wrapper } = setup();
    render(<ProfilePage state={state} canWrite />, { wrapper });
    await screen.findByDisplayValue("Synthetic");
    fireEvent.click(
      screen.getByRole("checkbox", { name: zh.account.business.record_ip_log }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.save }),
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(desktopRequest)
          .mock.calls.find(([r]) => r.method === "PATCH")?.[0].body,
      ).toEqual({ record_ip_log: false }),
    );
    await waitFor(() =>
      expect(
        vi.mocked(desktopRequest).mock.calls.filter(([r]) => r.method === "GET")
          .length,
      ).toBeGreaterThan(1),
    );
  });
  it("opens fixed native targets without credentials", async () => {
    const { wrapper } = setup();
    render(
      <>
        <WebEntry target="coding" />
        <WebEntry target="gaccode" />
        <WebEntry target="redemption" allowed={false} />
      </>,
      { wrapper },
    );
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.web.coding }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.web.gaccode }),
    );
    expect(openAccountWeb).toHaveBeenNthCalledWith(1, "coding");
    expect(openAccountWeb).toHaveBeenNthCalledWith(2, "gaccode");
    expect(
      screen.getByRole("button", { name: zh.account.business.web.redemption }),
    ).toBeDisabled();
  });
  it("resets log pagination and request selection on changed filters", async () => {
    vi.mocked(desktopRequest).mockImplementation(async (r) =>
      r.path.endsWith("/logs")
        ? env({
            page: Number(r.query?.find(([k]) => k === "page")?.[1] ?? 1),
            page_size: 20,
            total: "50",
            has_more: true,
            items: [],
          })
        : r.path.endsWith("statistics")
          ? env({ summary: {}, trend: [], by_model: [], by_error: [] })
          : env({
              record_count: "0",
              error_count: "0",
              quota: "0",
              start_timestamp: 1,
              end_timestamp: 2,
            }),
    );
    const { wrapper } = setup();
    render(<Logs state={state} />, { wrapper });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: zh.account.business.next }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.next }),
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(desktopRequest)
          .mock.calls.some(
            ([r]) =>
              r.path.endsWith("/logs") &&
              r.query?.some(([k, v]) => k === "page" && v === "2"),
          ),
      ).toBe(true),
    );
    fireEvent.change(
      screen.getByLabelText(zh.account.business.logFilter.model_name),
      { target: { value: "synthetic-model" } },
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(desktopRequest)
          .mock.calls.some(
            ([r]) =>
              r.path.endsWith("/logs") &&
              r.query?.some(
                ([k, v]) => k === "model_name" && v === "synthetic-model",
              ) &&
              r.query?.some(([k, v]) => k === "page" && v === "1"),
          ),
      ).toBe(true),
    );
  });
  it("renders percentages once, milliseconds, null samples and timestamped history", async () => {
    const model = {
      model_name: "synthetic-model",
      description: "Synthetic",
      tags: "test",
      vendor_id: "1",
      enable_groups: ["default"],
      supported_endpoint_types: ["codex_responses"],
      billing_expr: "SYNTHETIC_PRICE_EXPR",
      billing_mode: "expression",
      pricing_version: "1",
      model_ratio: null,
      model_price: null,
      completion_ratio: null,
      pricing_unavailable: false,
      related_pricing: [],
      endpoints: {},
    };
    const aggregate = {
      has_samples: false,
      avg_latency_ms: 2000,
      avg_ttft_ms: null,
      avg_tps: null,
      success_rate: 75,
      latest_sample_ts: null,
      sample_level: "none",
      ttft_sample_level: "none",
      historical_values: { success_rate: { value: 80, ts: 1 } },
      half_hour_series: [],
    };
    vi.mocked(desktopRequest).mockImplementation(async (req) =>
      req.path.includes("model-performance")
        ? env({
            model_name: model.model_name,
            aggregate,
            groups: [],
            series_schema: "30m",
          })
        : env({
            items: [model],
            pagination: { page: 1, has_more: false },
            snapshot_id: "synthetic-snapshot",
            snapshot_refreshed: false,
            pricing_meta: { default_effective_group: "default" },
          }),
    );
    const { wrapper } = setup();
    render(<ModelsPage state={state} />, { wrapper });
    await screen.findByText("synthetic-model");
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.business.details }),
    );
    await screen.findByText(/75%/);
    expect(screen.queryByText(/7500%/)).toBeNull();
    expect(screen.getByText(/2000 ms/)).toBeInTheDocument();
    expect(
      screen.getByText(zh.account.business.noSamples, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("SYNTHETIC_PRICE_EXPR")).toHaveLength(1);
  });
});
