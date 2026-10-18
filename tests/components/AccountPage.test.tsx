import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import { AccountPage } from "@/components/account/AccountPage";
import { disconnectedAccount, type AccountState } from "@/lib/api/account";

vi.mock("@/lib/api/account", async (original) => ({
  ...(await original<typeof import("@/lib/api/account")>()),
  desktopRequest: vi.fn(async () => ({
    success: true,
    data: { native: { account: false }, web: {} },
    meta: { generated_at: 1 },
  })),
}));

const makeAccount = (state: AccountState = disconnectedAccount) => ({
  state,
  isLoading: false,
  connect: vi.fn(async (_token: string) => {}),
  openTokenPage: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  retry: vi.fn(async () => {}),
});

async function setup(state?: AccountState) {
  i18n.addResourceBundle("zh", "translation", zh, true, true);
  const account = makeAccount(state);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: import("react").ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const result = render(<AccountPage account={account} />, { wrapper });
  return { account, ...result };
}
const paste = (value = "synthetic-account-system-token") =>
  fireEvent.change(screen.getByLabelText(zh.account.tokenLabel), {
    target: { value },
  });
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: zh.account.connect }));
const connected: AccountState = {
  ...disconnectedAccount,
  status: "connected",
  localCleared: false,
  identity: {
    userId: "1",
    username: "fixture-a",
    displayName: "合成A",
    connectionId: "fixture-connection",
  },
};

describe("system token connection and phase-one account workspace", () => {
  it("preserves the key workspace and opens token guidance only after a click", async () => {
    const { account } = await setup();
    expect(
      screen.getByRole("region", { name: zh.account.pages.keys }),
    ).toBeInTheDocument();
    for (const page of [
      "overview",
      "logs",
      "modelsStatus",
      "profile",
      "models",
    ] as const)
      expect(
        screen.queryByRole("button", { name: zh.account.pages[page] }),
      ).not.toBeInTheDocument();
    expect(account.connect).not.toHaveBeenCalled();
    expect(account.openTokenPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: zh.account.getToken }));
    await waitFor(() => expect(account.openTokenPage).toHaveBeenCalledTimes(1));
    expect(account.connect).not.toHaveBeenCalled();
    expect(screen.getByText(zh.account.tokenHint)).toBeInTheDocument();
  });

  it.each(["", "  ", "synthetic token\nfragment"])(
    "rejects incomplete input %j before IPC",
    async (value) => {
      const { account } = await setup();
      paste(value);
      submit();
      expect(screen.getByRole("alert")).toHaveTextContent(
        zh.account.tokenInvalid,
      );
      expect(account.connect).not.toHaveBeenCalled();
    },
  );

  it("submits a trimmed token once, masks input, and shows verification while waiting", async () => {
    const { account } = await setup();
    let finish!: () => void;
    account.connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const input = screen.getByLabelText(zh.account.tokenLabel);
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    paste("  synthetic-account-system-token  ");
    submit();
    expect(account.connect).toHaveBeenCalledWith(
      "synthetic-account-system-token",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      zh.account.status.verifying,
    );
    expect(
      screen.getByRole("button", { name: zh.account.verifyingToken }),
    ).toBeDisabled();
    expect(input).toBeDisabled();
    finish();
    await waitFor(() => expect(input).toBeEnabled());
  });

  it("keeps failed input for retry and never renders private native error text", async () => {
    const { account, rerender } = await setup();
    account.connect.mockRejectedValueOnce(new Error("SYNTHETIC PRIVATE TEXT"));
    paste();
    submit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        zh.account.actionFailed,
      ),
    );
    expect(screen.getByLabelText(zh.account.tokenLabel)).toHaveValue(
      "synthetic-account-system-token",
    );
    expect(
      screen.queryByText("SYNTHETIC PRIVATE TEXT"),
    ).not.toBeInTheDocument();
    rerender(
      <AccountPage
        account={{
          ...account,
          state: {
            ...disconnectedAccount,
            status: "invalid",
            error: { code: "invalid_token", message: "SYNTHETIC PRIVATE TEXT" },
          },
        }}
      />,
    );
    expect(screen.getByLabelText(zh.account.tokenLabel)).toHaveValue(
      "synthetic-account-system-token",
    );
    expect(
      screen.getByText(zh.account.errors.invalid_token),
    ).toBeInTheDocument();
    submit();
    await waitFor(() => expect(account.connect).toHaveBeenCalledTimes(2));
  });

  it("clears transient input after success and removes old identity after invalidation", async () => {
    const { account, rerender } = await setup();
    paste();
    rerender(<AccountPage account={{ ...account, state: connected }} />);
    expect(screen.getByText(/合成A/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(zh.account.tokenLabel),
    ).not.toBeInTheDocument();
    rerender(
      <AccountPage
        account={{
          ...account,
          state: { ...disconnectedAccount, status: "invalid" },
        }}
      />,
    );
    expect(screen.queryByText(/合成A/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(zh.account.tokenLabel)).toHaveValue("");
  });

  it("allows token replacement for expired and legacy connections without OAuth controls", async () => {
    const { account } = await setup({
      ...disconnectedAccount,
      status: "invalid",
      localCleared: false,
      error: { code: "legacy_credentials", message: "" },
    });
    expect(
      screen.getByText(zh.account.errors.legacy_credentials),
    ).toBeInTheDocument();
    paste();
    submit();
    await waitFor(() => expect(account.connect).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/取消授权/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: zh.account.disconnect }),
    );
    await waitFor(() => expect(account.logout).toHaveBeenCalledTimes(1));
  });

  it("honors Retry-After for token submission while preserving website recovery", async () => {
    const { account } = await setup({
      ...disconnectedAccount,
      status: "error",
      error: { code: "rate_limited", message: "", retryAfter: 30 },
    });
    paste();
    expect(
      screen.getByRole("button", { name: zh.account.connect }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: zh.account.getToken }),
    ).toBeEnabled();
    expect(screen.getByText("请在 30 秒后重试。")).toBeInTheDocument();
    expect(account.connect).not.toHaveBeenCalled();
  });

  it("retains offline identity and explains local-only disconnect", async () => {
    const { account } = await setup({
      ...connected,
      status: "offline",
      remoteRevoked: false,
    });
    expect(screen.getByText(zh.account.offlineHint)).toBeInTheDocument();
    expect(screen.getByText(zh.account.disconnectHint)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zh.account.retry }));
    await waitFor(() => expect(account.retry).toHaveBeenCalledTimes(1));
  });

  it("shows a recoverable error when the system browser cannot open", async () => {
    const { account } = await setup();
    paste();
    account.openTokenPage.mockRejectedValueOnce(
      new Error("synthetic browser failure"),
    );
    fireEvent.click(screen.getByRole("button", { name: zh.account.getToken }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        zh.account.actionFailed,
      ),
    );
    expect(screen.getByLabelText(zh.account.tokenLabel)).toHaveValue(
      "synthetic-account-system-token",
    );
    expect(
      screen.getByRole("button", { name: zh.account.getToken }),
    ).toBeEnabled();
  });
});
