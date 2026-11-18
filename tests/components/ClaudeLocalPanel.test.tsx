import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeLocalPanel } from "@/components/proxy/ClaudeLocalPanel";
import {
  claudeDesktopLocal,
  type ClaudeLocalStatus,
} from "@/lib/api/claudeDesktopLocal";
import { providersApi } from "@/lib/api/providers";
import { settingsApi } from "@/lib/api/settings";
vi.mock("@/lib/api/settings", () => ({
  settingsApi: { openExternal: vi.fn() },
}));
vi.mock("@/lib/api/claudeDesktopLocal", () => ({
  claudeDesktopLocal: {
    status: vi.fn(),
    action: vi.fn(),
    officialInstallation: vi.fn(),
  },
}));
vi.mock("@/lib/api/providers", () => ({
  providersApi: { importClaudeDesktopFromClaude: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
const stopped = {
  enabled: true,
  recoveryRequired: false,
  core: {
    version: "5.11492.5",
    caTrusted: true,
    nodeAvailable: true,
    claudeRunning: false,
    running: false,
    connected: false,
    supported: true,
    caReady: true,
    warning: null,
  },
} satisfies ClaudeLocalStatus;
function mount(
  overrides: Partial<React.ComponentProps<typeof ClaudeLocalPanel>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props = {
    providerId: "synthetic-provider",
    providers: [
      {
        id: "synthetic-provider",
        name: "Synthetic",
        meta: {
          claudeDesktopModelRoutes: {
            "claude-synthetic": { model: "claude-synthetic" },
          },
        },
      },
    ],
    onSelectProvider: vi.fn(),
    onAddProvider: vi.fn(),
    ...overrides,
  };
  render(
    <QueryClientProvider client={client}>
      <ClaudeLocalPanel {...props}>
        <p>provider-management-fallback</p>
      </ClaudeLocalPanel>
    </QueryClientProvider>,
  );
  return { client, props };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claudeDesktopLocal.status).mockResolvedValue(stopped);
  vi.mocked(claudeDesktopLocal.officialInstallation).mockResolvedValue(true);
  vi.mocked(settingsApi.openExternal).mockResolvedValue(undefined);
  vi.mocked(claudeDesktopLocal.action).mockResolvedValue(stopped);
});
describe("Claude Desktop guided setup", () => {
  const windows = {
    enabled: true,
    capabilities: {
      platform: "windows",
      voiceInput: false,
      computerUse: false,
      cowork: false,
    },
  };
  it.each(["windows", "macos", "linux"])(
    "rechecks the %s installation without compatibility actions",
    async (platform) => {
      vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
        ...windows,
        capabilities: { ...windows.capabilities, platform },
      });
      vi.mocked(claudeDesktopLocal.officialInstallation)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      mount();
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "common.cancel",
        }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "claudeLocal.prepareAction" }),
      );
      await screen.findByText("claudeLocal.gatewayHint");
      expect(screen.getByText("provider-management-fallback")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "claudeLocal.trustAction" }),
      ).toBeNull();
      expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
    },
  );
  it("keeps recovery available when the Windows installation probe fails", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...windows,
      recoveryRequired: true,
    });
    vi.mocked(claudeDesktopLocal.officialInstallation).mockRejectedValue(
      new Error("synthetic timeout"),
    );
    mount();
    await screen.findByText("claudeLocal.gatewayDetectionError");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("provider-management-fallback")).toBeNull();
    fireEvent.click(screen.getByText("claudeLocal.gatewayCleanup"));
    fireEvent.click(
      screen.getByRole("button", { name: "claudeLocal.recoverAction" }),
    );
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "stop",
        "synthetic-provider",
      ),
    );
  });
  it.each([true, false])(
    "prompts once when missing and respects confirmation (%s)",
    async (confirm) => {
      vi.mocked(claudeDesktopLocal.officialInstallation).mockResolvedValue(
        false,
      );
      const { client } = mount();
      const dialog = await screen.findByRole("dialog");
      expect(settingsApi.openExternal).not.toHaveBeenCalled();
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: confirm ? "claudeLocal.downloadLink" : "common.cancel",
        }),
      );
      if (confirm)
        expect(settingsApi.openExternal).toHaveBeenCalledWith(
          "https://claude.com/",
        );
      else expect(settingsApi.openExternal).not.toHaveBeenCalled();
      await client.invalidateQueries({
        queryKey: ["officialClaudeDesktopInstallation"],
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it.each([true, null])(
    "keeps the download link available for detection result %s",
    async (installed) => {
      vi.mocked(claudeDesktopLocal.officialInstallation).mockResolvedValue(
        installed,
      );
      const { client } = mount();
      await waitFor(() =>
        expect(
          client.getQueryState(["officialClaudeDesktopInstallation"])?.status,
        ).toBe("success"),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "claudeLocal.downloadLink" }),
      );
      expect(settingsApi.openExternal).toHaveBeenCalledWith(
        "https://claude.com/",
      );
    },
  );
  it("retains provider management in builds without the optional core", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({ enabled: false });
    mount();
    expect(
      await screen.findByText("provider-management-fallback"),
    ).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
  });
  it("shows import and add instead of a blocked launch when no line exists", async () => {
    vi.mocked(providersApi.importClaudeDesktopFromClaude).mockResolvedValue(1);
    const { client, props } = mount({ providerId: undefined, providers: [] });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(
      await screen.findByRole("button", { name: "claudeLocal.importLine" }),
    );
    await waitFor(() =>
      expect(providersApi.importClaudeDesktopFromClaude).toHaveBeenCalledTimes(
        1,
      ),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["providers", "claude-desktop"],
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "claudeLocal.addLine" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "claudeLocal.addLine" }),
    );
    expect(props.onAddProvider).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "claudeLocal.launchAction" }),
    ).toBeNull();
    expect(screen.getByText("provider-management-fallback")).toBeVisible();
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
  });
  it("shows cleanup failures and keeps the retry action available", async () => {
    vi.mocked(claudeDesktopLocal.action).mockRejectedValue(
      new Error("Synthetic cleanup failure"),
    );
    mount();
    fireEvent.click(await screen.findByText("claudeLocal.gatewayCleanup"));
    fireEvent.click(
      screen.getByRole("button", { name: "claudeLocal.untrust" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Synthetic cleanup failure",
    );
    expect(
      screen.getByRole("button", { name: "claudeLocal.untrust" }),
    ).toBeEnabled();
  });
});
