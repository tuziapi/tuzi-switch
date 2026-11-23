import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfficialTuziMcpCard } from "@/components/mcp/OfficialTuziMcpCard";
import { officialMcpApi, type OfficialMcpStatus } from "@/lib/api/officialMcp";

vi.mock("@/lib/api/officialMcp", () => ({
  officialMcpApi: {
    status: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    manage: vi.fn(),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, args?: { name?: string }) =>
      args?.name ? `${key}: ${args.name}` : key,
  }),
}));

const empty: OfficialMcpStatus = {
  configured: false,
  busy: false,
  phase: "not_configured",
  error: null,
  accountId: null,
  accountName: null,
  assistantAccountName: "customer",
  accountMismatch: false,
  checkedAt: null,
};
function show(status = empty) {
  vi.mocked(officialMcpApi.status).mockResolvedValue(status);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OfficialTuziMcpCard />
    </QueryClientProvider>,
  );
}
describe("official Tuzi MCP customer setup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(officialMcpApi.start).mockResolvedValue();
    vi.mocked(officialMcpApi.cancel).mockResolvedValue();
    vi.mocked(officialMcpApi.manage).mockResolvedValue();
  });
  it("connects with one action and asks for no credentials", async () => {
    show();
    await screen.findByText("officialMcp.assistantAccount: customer");
    expect(screen.getByText("https://api.tu-zi.com/mcp")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByText("officialMcp.connect"));
    await waitFor(() =>
      expect(officialMcpApi.start).toHaveBeenCalledWith("connect"),
    );
    expect(screen.queryByText("officialMcp.phases.connected")).toBeNull();
  });
  it("does not confuse a saved configuration with verified access", async () => {
    show({ ...empty, configured: true, phase: "configured" });
    expect(
      await screen.findByText("officialMcp.phases.configured"),
    ).toBeVisible();
    fireEvent.click(screen.getByText("officialMcp.check"));
    await waitFor(() =>
      expect(officialMcpApi.start).toHaveBeenCalledWith("check"),
    );
    expect(screen.queryByText("officialMcp.phases.connected")).toBeNull();
  });
  it("supports cancellation and prevents duplicate authorization", async () => {
    show({ ...empty, configured: true, busy: true, phase: "authorizing" });
    expect(
      await screen.findByText("officialMcp.phases.authorizing"),
    ).toBeVisible();
    expect(screen.getByText("officialMcp.reauthorize")).toBeDisabled();
    expect(screen.getByText("officialMcp.check")).toBeDisabled();
    fireEvent.click(screen.getByText("officialMcp.cancel"));
    await waitFor(() => expect(officialMcpApi.cancel).toHaveBeenCalledOnce());
  });
  it("surfaces account mismatches instead of claiming association success", async () => {
    show({
      ...empty,
      configured: true,
      phase: "connected",
      checkedAt: 1,
      accountId: "2",
      accountName: "other",
      accountMismatch: true,
    });
    expect(
      await screen.findByText("officialMcp.phases.account_mismatch"),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("officialMcp.mismatch");
    expect(screen.queryByText("officialMcp.phases.connected")).toBeNull();
  });
  it("shows verified account and last check separately from revoke management", async () => {
    show({
      ...empty,
      configured: true,
      phase: "connected",
      checkedAt: 1,
      accountId: "1",
      accountName: "customer",
    });
    expect(
      await screen.findByText("officialMcp.phases.connected"),
    ).toBeVisible();
    expect(screen.getByText("officialMcp.verified")).toBeVisible();
    fireEvent.click(screen.getByText("officialMcp.manage"));
    await waitFor(() => expect(officialMcpApi.manage).toHaveBeenCalledOnce());
    expect(officialMcpApi.start).not.toHaveBeenCalled();
  });
  it("never displays untrusted native errors or secrets", async () => {
    vi.mocked(officialMcpApi.start).mockRejectedValue(
      new Error("SYNTHETIC-secret"),
    );
    show();
    await screen.findByText("officialMcp.assistantAccount: customer");
    fireEvent.click(screen.getByText("officialMcp.connect"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "officialMcp.errors.local_error",
    );
    expect(screen.queryByText(/SYNTHETIC-secret/)).toBeNull();
  });
});
