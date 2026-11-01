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

  it("loads settings on demand and asks before discarding edits", async () => {
    setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(
      screen.getByRole("button", { name: zh.account.workspace.settings }),
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
  it("queries log filters on submit, retains pagination and loads statistics only on demand", async () => {
    const { client } = setup();
    await screen.findByText("合成开发密钥");
    await userEvent.click(tab("logs"));
    await waitFor(() => expect(paths()).toContain("/account/logs"));
    expect(paths()).not.toContain("/account/logs/statistics");
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
    await userEvent.click(screen.getByRole("button", { name: /消费统计/ }));
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
    await screen.findAllByText("99.8%");
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
              q.queryKey.includes("/account/model-performance") &&
              q.getObserversCount() > 0,
          ),
      ).toBe(true),
    );
    await userEvent.click(tab("keys"));
    expect(
      client
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey.includes("/account/model-performance"))
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
          name: zh.account.business.requestSummary,
        }).length,
      ).toBeGreaterThan(0),
    );
    await userEvent.click(
      screen.getAllByRole("button", {
        name: zh.account.business.requestSummary,
      })[0],
    );
    expect(
      screen.getByRole("dialog", { name: zh.account.business.requestSummary }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(paths().some((p) => p.startsWith("/account/logs/requests/"))).toBe(
        true,
      ),
    );
  });
});
