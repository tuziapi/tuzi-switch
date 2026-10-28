import { createRef } from "react";
import type { UnifiedMcpPanelHandle } from "@/components/mcp/UnifiedMcpPanel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Mcp from "@/components/mcp/UnifiedMcpPanel";
import Skills from "@/components/skills/UnifiedSkillsPanel";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import { mcpApi } from "@/lib/api/mcp";
import { skillsApi } from "@/lib/api/skills";
import { sessionsApi } from "@/lib/api/sessions";

function mount(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("workspace query recovery", () => {
  it("retries failed session messages while retaining the selected session", async () => {
    vi.spyOn(sessionsApi, "list").mockResolvedValue([
      {
        providerId: "claude",
        sessionId: "synthetic",
        title: "Synthetic message retry",
        sourcePath: "/synthetic/session",
      },
    ]);
    const read = vi
      .spyOn(sessionsApi, "getMessages")
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue([]);
    mount(<SessionManagerPage appId="claude" />);
    fireEvent.click(await screen.findByText("Synthetic message retry"));
    const alert = await screen.findByRole("alert");
    fireEvent.click(
      within(alert).getByRole("button", { name: "common.refresh" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("heading", { name: "Synthetic message retry" }),
    ).toBeInTheDocument();
  });
  it("keeps partial import recovery visible and refreshes successful entries before retry", async () => {
    const read = vi.spyOn(mcpApi, "getAllServers").mockResolvedValue({});
    const importFromApps = vi
      .spyOn(mcpApi, "importFromApps")
      .mockRejectedValueOnce(
        new Error("成功来源已保存 1 项；失败来源未保存，可再次导入"),
      )
      .mockResolvedValueOnce(0);
    const ref = createRef<UnifiedMcpPanelHandle>();
    mount(<Mcp ref={ref} onOpenChange={() => {}} />);
    await screen.findByText("mcp.unifiedPanel.noServers");
    await act(async () => {
      ref.current?.openImport();
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("成功来源已保存 1 项");
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
    fireEvent.click(within(alert).getByRole("button"));
    await waitFor(() => expect(importFromApps).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
  it("distinguishes failed MCP reads from an empty list and retries", async () => {
    const read = vi
      .spyOn(mcpApi, "getAllServers")
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue({});
    mount(<Mcp onOpenChange={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(
      screen.queryByText("mcp.unifiedPanel.noServers"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(alert).getByRole("button", { name: "common.refresh" }),
    );
    expect(
      await screen.findByText("mcp.unifiedPanel.noServers"),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("distinguishes failed installed skill reads and retries", async () => {
    const read = vi
      .spyOn(skillsApi, "getInstalled")
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue([]);
    mount(<Skills currentApp="claude" onOpenDiscovery={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(screen.queryByText("skills.noInstalled")).not.toBeInTheDocument();
    fireEvent.click(
      within(alert).getByRole("button", { name: "common.refresh" }),
    );
    expect(await screen.findByText("skills.noInstalled")).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("recovers a failed session list without implying there are no sessions", async () => {
    const read = vi
      .spyOn(sessionsApi, "list")
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue([]);
    mount(<SessionManagerPage appId="claude" />);
    const alert = await screen.findByRole("alert");
    fireEvent.click(
      within(alert).getByRole("button", { name: "common.refresh" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(read).toHaveBeenCalledTimes(2);
  });
});
