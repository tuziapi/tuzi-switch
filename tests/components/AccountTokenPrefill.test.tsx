import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AccountPage } from "@/components/account/AccountPage";
import { disconnectedAccount } from "@/lib/api/account";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/components/account/BusinessPages", () => ({
  AccountBusiness: () => null,
}));
const ipc = vi.mocked(invoke);
const candidate = "SYNTHETIC0000000000000000000000";
const account = {
  state: disconnectedAccount,
  isLoading: false,
  connect: vi.fn(async () => {}),
  openTokenPage: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  retry: vi.fn(async () => disconnectedAccount),
};
const input = () =>
  document.getElementById("account-system-token") as HTMLInputElement;
beforeEach(() => {
  ipc.mockReset();
  ipc.mockResolvedValue(null);
});
it("does not read on ordinary navigation; return fills without connecting or persisting", async () => {
  ipc.mockImplementation(async (command) =>
    command === "account_take_token_prefill" ? candidate : null,
  );
  const view = render(<AccountPage account={account} />);
  expect(ipc).not.toHaveBeenCalledWith("account_take_token_prefill");
  view.rerender(<AccountPage account={account} tokenReturnRequest={1} />);
  await waitFor(() => expect(input()).toHaveValue(candidate));
  expect(input()).toHaveAttribute("type", "password");
  expect(screen.getByText("account.tokenPrefilled")).toBeInTheDocument();
  expect(account.connect).not.toHaveBeenCalled();
  expect(JSON.stringify({ ...localStorage })).not.toContain(candidate);
});
it("keeps an occupied input and cancels native permission without a read", async () => {
  const view = render(<AccountPage account={account} />);
  fireEvent.change(input(), { target: { value: "user-entered" } });
  view.rerender(<AccountPage account={account} tokenReturnRequest={1} />);
  expect(input()).toHaveValue("user-entered");
  expect(ipc).not.toHaveBeenCalledWith("account_take_token_prefill");
  expect(ipc).toHaveBeenCalledWith("account_cancel_token_prefill");
});
it.each(["typing", "unmount", "generation"] as const)(
  "discards a late clipboard result after %s",
  async (mode) => {
    let resolve!: (value: string) => void;
    ipc.mockImplementation((command) =>
      command === "account_take_token_prefill"
        ? new Promise<string>((done) => {
            resolve = done;
          })
        : Promise.resolve(null),
    );
    const view = render(
      <AccountPage account={account} tokenReturnRequest={1} />,
    );
    await waitFor(() => expect(resolve).toBeDefined());
    if (mode === "typing")
      fireEvent.change(input(), { target: { value: "user-entered" } });
    if (mode === "unmount") view.unmount();
    if (mode === "generation")
      view.rerender(
        <AccountPage
          account={{
            ...account,
            state: {
              ...disconnectedAccount,
              generation: 2,
              status: "verifying",
            },
          }}
          tokenReturnRequest={1}
        />,
      );
    await act(async () => resolve(candidate));
    if (mode !== "unmount") expect(input()).not.toHaveValue(candidate);
    expect(account.connect).not.toHaveBeenCalled();
  },
);
it("read failure leaves manual entry available", async () => {
  ipc.mockImplementation((command) =>
    command === "account_take_token_prefill"
      ? Promise.reject(new Error("denied"))
      : Promise.resolve(null),
  );
  render(<AccountPage account={account} tokenReturnRequest={1} />);
  await waitFor(() =>
    expect(ipc).toHaveBeenCalledWith("account_take_token_prefill"),
  );
  fireEvent.change(input(), { target: { value: "manually-pasted" } });
  expect(input()).toHaveValue("manually-pasted");
});
it("connected accounts cannot request clipboard contents", () => {
  render(
    <AccountPage
      account={{
        ...account,
        state: {
          ...disconnectedAccount,
          status: "connected",
          identity: {
            userId: "1",
            username: "synthetic",
            displayName: "synthetic",
            connectionId: "synthetic",
          },
        },
      }}
      tokenReturnRequest={1}
    />,
  );
  expect(ipc).not.toHaveBeenCalledWith("account_take_token_prefill");
});
