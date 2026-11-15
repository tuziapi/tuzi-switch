import { AccountSettings } from "@/components/account/AccountSettings";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import { AccountPage } from "@/components/account/AccountPage";
import { disconnectedAccount, type AccountState } from "@/lib/api/account";
import { invoke } from "@tauri-apps/api/core";
import {
  accountPreviewIPC,
  setAccountPreviewMode,
} from "../visual/account-fixture";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const state: AccountState = {
  ...disconnectedAccount,
  status: "connected",
  generation: 1,
  identity: {
    userId: "synthetic-user",
    username: "preview_synthetic",
    displayName: "本地合成账户",
    connectionId: "synthetic-connection",
  },
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const account = {
    state,
    isLoading: false,
    connect: vi.fn(),
    openTokenPage: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(async () => state),
  };
  const view = render(<AccountPage account={account} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...view, account, client };
}
const paths = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "account_request")
    .map(([, args]) => (args as { request: { path: string } }).request.path);
const tab = (page: "keys" | "logs" | "models" | "modelsStatus") =>
  screen.getByRole("tab", { name: zh.account.pages[page] });

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  i18n.addResourceBundle("zh", "translation", zh, true, true);
  setAccountPreviewMode("normal");
  vi.mocked(invoke).mockImplementation(accountPreviewIPC as typeof invoke);
});

describe("account workspace navigation", () => {
  it("opens keys only, switches with keyboard and mounts no overview", async () => {
    setup();
    await screen.findByText("合成开发密钥");
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(tab("keys")).toHaveAttribute("aria-selected", "true");
    expect(paths()).not.toContain("/account/logs");
    expect(paths()).not.toContain("/account/models");
    expect(paths()).not.toContain("/account/profile");
    expect(paths()).not.toContain("/account/usage");
    tab("keys").focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(tab("logs")).toHaveAttribute("aria-selected", "true"),
    );
    await waitFor(() => expect(paths()).toContain("/account/logs"));
    expect(
      screen.queryByText(zh.account.business.balance),
    ).not.toBeInTheDocument();
  });

  it("retains key filters across tabs and clears them for a new account", async () => {
    const { account, rerender } = setup();
    await screen.findByText("合成开发密钥");
    fireEvent.change(
      screen.getByLabelText(zh.account.business.keyFilter.keyword),
      { target: { value: "工作" } },
    );
    await waitFor(() =>
      expect(screen.queryByText("合成开发密钥")).not.toBeInTheDocument(),
    );
    await userEvent.click(tab("models"));
    await screen.findByText("gpt-5.6-sol");
    await userEvent.click(tab("keys"));
    expect(
      screen.getByLabelText(zh.account.business.keyFilter.keyword),
    ).toHaveValue("工作");
    rerender(
      <AccountPage
        account={{
          ...account,
          state: {
            ...state,
            generation: 2,
            identity: { ...state.identity!, connectionId: "synthetic-second" },
          },
        }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText(zh.account.business.keyFilter.keyword),
      ).toHaveValue(""),
    );
  });

  it("hides the settings entry while retaining the standalone settings editor", async () => {
    const { client } = setup();
    await screen.findByText("合成开发密钥");
    expect(
      screen.queryByRole("button", { name: zh.account.workspace.settings }),
    ).toBeNull();
    expect(paths()).not.toContain("/account/profile");
    const settings = render(
      <QueryClientProvider client={client}>
        <AccountSettings state={state} onClose={() => settings.unmount()} />
      </QueryClientProvider>,
    );
    const input = await screen.findByLabelText(zh.account.business.displayName);
    fireEvent.change(input, { target: { value: "修改后的合成名称" } });
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText(zh.account.workspace.unsaved)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: zh.account.workspace.keepEditing }),
    );
    expect(input).toHaveValue("修改后的合成名称");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(
      screen.getByRole("button", { name: zh.account.workspace.discard }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([cmd, args]) =>
            cmd === "account_request" &&
            (args as { request: { method: string } }).request.method !== "GET",
        ),
    ).toHaveLength(0);
  });
  it("queries log filters on submit, retains pagination and loads statistics immediately", async () => {
    const { client } = setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("logs"));
    await waitFor(() => expect(paths()).toContain("/account/logs"));
    await waitFor(() => expect(paths()).toContain("/account/logs/statistics"));
    fireEvent.change(
      screen.getByLabelText(zh.account.business.logFilter.model_name),
      { target: { value: "synthetic-filter" } },
    );
    const queries = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === "account_request")
        .map(
          ([, args]) =>
            (args as { request: { path: string; query?: [string, string][] } })
              .request,
        );
    expect(
      queries().some((r) =>
        r.query?.some(
          ([k, v]) => k === "model_name" && v === "synthetic-filter",
        ),
      ),
    ).toBe(false);
    await userEvent.click(
      screen.getByRole("button", { name: zh.account.workspace.query }),
    );
    await waitFor(() =>
      expect(
        queries().some(
          (r) =>
            r.path === "/account/logs" &&
            r.query?.some(
              ([k, v]) => k === "model_name" && v === "synthetic-filter",
            ),
        ),
      ).toBe(true),
    );
    await userEvent.click(
      screen.getByRole("button", { name: zh.account.business.next }),
    );
    await waitFor(() =>
      expect(
        queries().some(
          (r) =>
            r.path === "/account/logs" &&
            r.query?.some(([k, v]) => k === "page" && v === "2"),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(paths()).toContain("/account/logs/statistics"));
    await userEvent.click(tab("keys"));
    expect(
      client
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey.includes("/account/logs/statistics"))
        .every((q) => q.getObserversCount() === 0),
    ).toBe(true);
    await userEvent.click(tab("logs"));
    expect(
      screen.getByLabelText(zh.account.business.logFilter.model_name),
    ).toHaveValue("synthetic-filter");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: zh.account.business.previous }),
      ).toBeEnabled(),
    );
    fireEvent.change(
      screen.getByLabelText(zh.account.business.logFilter.end_timestamp),
      { target: { value: "2000-01-01T00:00" } },
    );
    expect(
      screen.getByRole("button", { name: zh.account.workspace.query }),
    ).toBeDisabled();
    expect(
      screen.getByText(zh.account.workspace.invalidRange),
    ).toBeInTheDocument();
  });

  it("stops observing performance after leaving the page and restores its window", async () => {
    const { client } = setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("modelsStatus"));
    await screen.findAllByText("99.80%");
    await userEvent.selectOptions(
      screen.getByLabelText(zh.account.business.window),
      "6",
    );
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .some(
            (q) =>
              q.queryKey.includes("/account/model-performance/batch") &&
              q.getObserversCount() > 0,
          ),
      ).toBe(true),
    );
    await userEvent.click(tab("keys"));
    expect(
      client
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey.includes("/account/model-performance/batch"))
        .every((q) => q.getObserversCount() === 0),
    ).toBe(true);
    await userEvent.click(tab("modelsStatus"));
    expect(screen.getByLabelText(zh.account.business.window)).toHaveValue("6");
  });

  it("opens model details without performance requests and request details in a drawer", async () => {
    setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("models"));
    await screen.findByText("gpt-5.6-sol");
    await userEvent.click(
      screen.getAllByRole("button", { name: zh.account.business.details })[0],
    );
    expect(
      screen.getByRole("dialog", { name: "gpt-5.6-sol" }),
    ).toBeInTheDocument();
    expect(paths()).not.toContain("/account/model-performance");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(tab("logs"));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: "查看详情",
        }).length,
      ).toBeGreaterThan(0),
    );
    await userEvent.click(
      screen.getAllByRole("button", {
        name: "查看详情",
      })[0],
    );
    expect(
      screen.getByRole("dialog", { name: "请求详情" }),
    ).toBeInTheDocument();
    expect(screen.getByText("/v1/responses")).toBeInTheDocument();
    await userEvent.click(
      screen.getByText("同一请求的关联记录（扣费、错误、退款）"),
    );
    await waitFor(() =>
      expect(paths().some((p) => p.startsWith("/account/logs/requests/"))).toBe(
        true,
      ),
    );
  });
  it("handles an empty Enter search and recovers to optional-field model details", async () => {
    setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("models"));
    await screen.findByText("gpt-5.6-sol");
    await userEvent.type(
      screen.getByLabelText(zh.account.business.modelFilter.search),
      "11{Enter}",
    );
    await screen.findByText(zh.account.workspace.noModels);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    await screen.findByText("gpt-5.6-sol");
    await userEvent.click(
      screen.getAllByRole("button", { name: zh.account.business.details })[0],
    );
    expect(
      screen.getByRole("dialog", { name: "gpt-5.6-sol" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("页面暂时无法显示，请重试或切换标签页。"),
    ).toBeNull();
  });
  it("shows six status cards and requests only the next page's models", async () => {
    setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("modelsStatus"));
    await screen.findAllByText("99.80%");
    expect(document.querySelectorAll(".account-status-card")).toHaveLength(6);
    expect(
      document.querySelectorAll(
        ".account-status-card > .account-performance-metrics .account-timeline",
      ),
    ).toHaveLength(6);
    await userEvent.click(
      screen.getByRole("button", { name: zh.account.business.next }),
    );
    await screen.findByText("kimi-k2");
    expect(document.querySelectorAll(".account-status-card")).toHaveLength(2);
    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(
            ([cmd, args]) =>
              cmd === "account_request" &&
              JSON.stringify(args).includes(
                '"models":["kimi-k2","gemini-flash"]',
              ),
          ),
      ).toBe(true),
    );
  });
  it("shows ten logs and opens public error details without a request-summary fetch", async () => {
    setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("logs"));
    await screen.findAllByRole("button", { name: "查看详情" });
    expect(
      document.querySelectorAll(".account-log-table tbody tr"),
    ).toHaveLength(10);
    expect(screen.getByText("共 20 条 · 1–10 条")).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "查看详情" })[2],
    );
    expect(screen.getByText("合成错误：请稍后重试")).toBeInTheDocument();
    expect(screen.getByText("synthetic-upstream-2")).toBeInTheDocument();
    expect(paths().some((path) => path.includes("/logs/requests/"))).toBe(
      false,
    );
  });
  it("renders malformed catalog responses as errors while keeping tabs usable", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const request = (args as { request?: { path: string } } | undefined)
        ?.request;
      if (command === "account_request" && request?.path === "/account/models")
        return {
          success: true,
          data: { items: null, pagination: { total: "0" } },
        };
      return accountPreviewIPC(command, args);
    });
    setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("models"));
    await screen.findByRole("alert");
    expect(screen.queryByText(zh.account.workspace.noModels)).toBeNull();
    await userEvent.click(tab("keys"));
    await screen.findByText("合成开发密钥");
  });
  it("omits the all-groups filter and sends only an explicitly selected group", async () => {
    setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("modelsStatus"));
    await screen.findAllByText("99.80%");
    const batches = () =>
      vi.mocked(invoke).mock.calls.flatMap(([cmd, args]) => {
        const request = (
          args as { request?: { path: string; body: Record<string, unknown> } }
        )?.request;
        return cmd === "account_request" &&
          request?.path === "/account/model-performance/batch"
          ? [request.body]
          : [];
      });
    expect(batches()[0]).not.toHaveProperty("groups");
    expect(
      screen.getAllByText("最近 24 小时成功率 · 每格 30 分钟"),
    ).toHaveLength(6);
    expect(screen.queryByText("吞吐")).toBeNull();
    expect(screen.queryByText("数据明细")).toBeNull();
    expect(screen.queryByText("按分组查看服务状态")).toBeNull();
    await userEvent.click(screen.getByRole("combobox", { name: "可用分组" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "default" }),
    );
    await waitFor(() =>
      expect(batches()[batches().length - 1]?.groups).toEqual(["default"]),
    );
    await userEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    await screen.findAllByText("99.80%");
  });
  it("shows catalog pricing without applying account override metadata", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const result = await accountPreviewIPC(command, args);
      if (
        command === "account_request" &&
        (args as { request: { path: string } }).request.path ===
          "/account/models"
      ) {
        const envelope = result as {
          data: {
            items: Record<string, unknown>[];
            pricing_meta: Record<string, unknown>;
          };
        };
        envelope.data.items[0].model_price = 0.125;
        envelope.data.items[0].quota_type = 0;
        envelope.data.pricing_meta.user_model_pricing = {
          default: { "gpt-5.6-sol": { model_price: 98765 } },
        };
      }
      return result;
    });
    setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("models"));
    await screen.findByText("gpt-5.6-sol");
    await userEvent.click(
      screen.getAllByRole("button", { name: zh.account.business.details })[0],
    );
    expect(screen.getByText("$0.125", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("98765")).toBeNull();
    expect(
      screen.queryByText(zh.account.business.effectivePrice, { exact: false }),
    ).toBeNull();
  });
});
