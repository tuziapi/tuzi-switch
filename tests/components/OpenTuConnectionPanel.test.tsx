import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenTuConnectionPanel } from "@/components/settings/OpenTuConnectionPanel";
import { opentuMcpApi } from "@/lib/api/opentuMcp";

vi.mock("@/lib/api/opentuMcp", () => ({
  opentuMcpApi: { pairing: vi.fn(), copy: vi.fn(), check: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("OpenTu connection setup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(opentuMcpApi.pairing).mockResolvedValue({
      endpoint: "http://127.0.0.1:54321/mcp",
      protocolVersion: "2025-06-18",
      canvasReady: false,
    });
    vi.mocked(opentuMcpApi.copy).mockResolvedValue(undefined);
    vi.mocked(opentuMcpApi.check).mockResolvedValue({
      protocolVersion: "2025-06-18",
      toolCount: 9,
      canvasReady: false,
    });
  });
  it("shows the actual address and copies credentials only through native commands", async () => {
    render(<OpenTuConnectionPanel />);
    expect(
      await screen.findByDisplayValue("http://127.0.0.1:54321/mcp"),
    ).toHaveAttribute("readonly");
    fireEvent.click(screen.getByText("opentuConnection.copyToken"));
    await waitFor(() =>
      expect(opentuMcpApi.copy).toHaveBeenCalledWith("token"),
    );
    expect(
      await screen.findByText("opentuConnection.copied.token"),
    ).toBeVisible();
    fireEvent.click(screen.getByText("opentuConnection.copyHeader"));
    await waitFor(() =>
      expect(opentuMcpApi.copy).toHaveBeenCalledWith("authorization"),
    );
  });
  it("reports local checks separately from client acceptance and canvas readiness", async () => {
    render(<OpenTuConnectionPanel />);
    fireEvent.click(screen.getByText("opentuConnection.check"));
    expect(await screen.findByText("opentuConnection.passed")).toBeVisible();
    expect(screen.getByText("opentuConnection.openCanvas")).toBeVisible();
    expect(screen.getByText("opentuConnection.localOnly")).toBeVisible();
  });
  it("recovers when the server was unavailable during initial rendering", async () => {
    vi.mocked(opentuMcpApi.pairing).mockRejectedValueOnce(
      new Error("unavailable"),
    );
    render(<OpenTuConnectionPanel />);
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByText("opentuConnection.copyAddress")).toBeDisabled();
    fireEvent.click(screen.getByText("opentuConnection.check"));
    expect(
      await screen.findByDisplayValue("http://127.0.0.1:54321/mcp"),
    ).toBeVisible();
    expect(await screen.findByText("opentuConnection.passed")).toBeVisible();
  });
  it("does not expose native error contents or claim success after a failed copy", async () => {
    vi.mocked(opentuMcpApi.copy).mockRejectedValue(
      new Error("SYNTHETIC-secret-error"),
    );
    render(<OpenTuConnectionPanel />);
    await screen.findByDisplayValue("http://127.0.0.1:54321/mcp");
    fireEvent.click(screen.getByText("opentuConnection.copyToken"));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(/SYNTHETIC-secret/)).toBeNull();
    expect(screen.queryByText("opentuConnection.copied.token")).toBeNull();
  });
});
