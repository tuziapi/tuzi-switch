import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import zh from "@/i18n/locales/zh.json";
import { AccountPage, ACCOUNT_PAGES } from "@/components/account/AccountPage";
import { disconnectedAccount, type AccountState } from "@/lib/api/account";

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
  const result = render(<AccountPage account={account} />);
  return { account, ...result };
}

describe("G1 account navigation and native state projection", () => {
  it("keeps every account entry reachable without initiating authorization", async () => {
    const { account } = await setup();
    for (const page of ACCOUNT_PAGES) {
      fireEvent.click(
        screen.getByRole("button", { name: zh.account.pages[page] }),
      );
      expect(
        screen.getByRole("region", { name: zh.account.pages[page] }),
      ).toHaveTextContent(zh.account.stagePending);
    }
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
