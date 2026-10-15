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
  startLogin: vi.fn(async () => {}),
  cancelLogin: vi.fn(async () => {}),
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

describe("G1 account navigation and native state projection", () => {
  it("shows only the phase-one key workspace without a sidebar", async () => {
    const { account } = await setup();
    expect(
      screen.getByRole("region", { name: zh.account.pages.keys }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: zh.account.pages.overview }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: zh.account.pages.logs }),
    ).not.toBeInTheDocument();
    expect(account.startLogin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: zh.account.connect }));
    await waitFor(() => expect(account.startLogin).toHaveBeenCalledTimes(1));
  });

  it.each(["authorizing", "exchanging", "verifying"] as const)(
    "shows %s as pending, not connected",
    async (status) => {
      const { account } = await setup({ ...disconnectedAccount, status });
      expect(screen.getByRole("status")).toHaveTextContent(
        zh.account.status[status],
      );
      expect(
        screen.queryByRole("button", { name: zh.account.connect }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: zh.account.cancel }));
      await waitFor(() => expect(account.cancelLogin).toHaveBeenCalledTimes(1));
    },
  );

  it("clears displayed identity when native state becomes invalid", async () => {
    const { account, rerender } = await setup({
      ...disconnectedAccount,
      status: "connected",
      identity: {
        userId: "1",
        username: "fixture-a",
        displayName: "合成A",
        connectionId: "fixture-connection",
      },
    });
    expect(screen.getByText(/合成A/)).toBeInTheDocument();
    rerender(
      <AccountPage
        account={{
          ...account,
          state: { ...disconnectedAccount, status: "invalid" },
        }}
      />,
    );
    expect(screen.queryByText(/合成A/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      zh.account.status.invalid,
    );
  });

  it("distinguishes offline identity and incomplete remote logout", async () => {
    await setup({
      ...disconnectedAccount,
      status: "offline",
      localCleared: true,
      remoteRevoked: false,
    });
    expect(screen.getByText(zh.account.offlineHint)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      zh.account.remoteNotRevoked,
    );
  });

  it.each([
    { status: "invalid", localCleared: false, code: "refresh_uncertain" },
    { status: "invalid", localCleared: true, code: "refresh_uncertain" },
    { status: "error", localCleared: false, code: "secure_storage_failed" },
  ] as const)(
    "allows explicit cleanup for $status/$code without unusable reauthorization",
    async ({ status, localCleared, code }) => {
      const { account, rerender } = await setup({
        ...disconnectedAccount,
        status,
        localCleared,
        error: { code, message: "" },
      });
      expect(
        screen.queryByRole("button", { name: zh.account.connect }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: zh.account.disconnect }),
      );
      await waitFor(() => expect(account.logout).toHaveBeenCalledTimes(1));
      expect(account.startLogin).not.toHaveBeenCalled();
      rerender(
        <AccountPage account={{ ...account, state: disconnectedAccount }} />,
      );
      expect(
        screen.getByRole("button", { name: zh.account.connect }),
      ).toBeEnabled();
    },
  );

  it("renders policy errors without automatic reauthorization or arbitrary native error text", async () => {
    const { account } = await setup({
      ...disconnectedAccount,
      status: "error",
      error: { code: "insufficient_scope", message: "SYNTHETIC PRIVATE TEXT" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      zh.account.errors.insufficient_scope,
    );
    expect(
      screen.queryByText("SYNTHETIC PRIVATE TEXT"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: zh.account.connect }),
    ).not.toBeInTheDocument();
    expect(account.startLogin).not.toHaveBeenCalled();
  });

  it("honors the native Retry-After without retrying automatically", async () => {
    const { account } = await setup({
      ...disconnectedAccount,
      status: "error",
      error: { code: "rate_limited", message: "", retryAfter: 30 },
    });
    expect(
      screen.getByRole("button", { name: zh.account.retry }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: zh.account.connect }),
    ).toBeDisabled();
    expect(screen.getByText("请在 30 秒后重试。")).toBeInTheDocument();
    expect(account.retry).not.toHaveBeenCalled();
  });

  it("reports rejected user action instead of successful connection", async () => {
    const { account } = await setup();
    account.startLogin.mockRejectedValueOnce(new Error("synthetic failure"));
    fireEvent.click(screen.getByRole("button", { name: zh.account.connect }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        zh.account.actionFailed,
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      zh.account.status.disconnected,
    );
  });
});
