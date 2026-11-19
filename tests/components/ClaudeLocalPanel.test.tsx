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
import { toast } from "sonner";
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
  providersApi: {
    importClaudeDesktopFromClaude: vi.fn(),
    getClaudeDesktopStatus: vi.fn(),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
const stopped = {
  enabled: true,
  desktopRunning: false,
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
  const view = render(
    <QueryClientProvider client={client}>
      <ClaudeLocalPanel {...props}>
        <p>provider-management-fallback</p>
      </ClaudeLocalPanel>
    </QueryClientProvider>,
  );
  return { client, props, ...view };
}
const readyConnection = {
  supported: true,
  configured: true,
  appliedId: "synthetic-profile",
  mode: "proxy" as const,
  expectedBaseUrl: "http://127.0.0.1:15721/claude-desktop",
  actualBaseUrl: "http://127.0.0.1:15721/claude-desktop",
  proxyRunning: true,
  staleRawModels: false,
  missingRouteMappings: false,
  gatewayTokenConfigured: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("claude-desktop-configuration-mode", "normal");
  vi.mocked(claudeDesktopLocal.status).mockResolvedValue(stopped);
  vi.mocked(claudeDesktopLocal.officialInstallation).mockResolvedValue(true);
  vi.mocked(settingsApi.openExternal).mockResolvedValue(undefined);
  vi.mocked(claudeDesktopLocal.action).mockResolvedValue(stopped);
  vi.mocked(providersApi.getClaudeDesktopStatus).mockResolvedValue(
    readyConnection,
  );
});

describe("Claude Desktop configuration modes", () => {
  beforeEach(() =>
    localStorage.removeItem("claude-desktop-configuration-mode"),
  );

  it("restores the wizard and persists normal mode without applying a provider", async () => {
    const view = mount();
    await screen.findByRole("button", { name: "claudeLocal.launchAction" });
    expect(screen.getByText("claudeLocal.connectionStep")).toBeVisible();
    expect(screen.queryByText("claudeLocal.trustStep")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "claudeLocal.normalMode" }),
    );
    expect(screen.getByText("provider-management-fallback")).toBeVisible();
    expect(screen.queryByText("claudeLocal.stepsLabel")).toBeNull();
    view.unmount();
    mount();
    expect(
      await screen.findByRole("button", { name: "claudeLocal.normalMode" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "claudeLocal.guidedMode" }),
    );
    expect(
      await screen.findByRole("button", { name: "claudeLocal.launchAction" }),
    ).toBeEnabled();
  });

  it("keeps model editing and provider selection wired to the existing forms", async () => {
    const edit = vi.fn();
    const { props } = mount({ onEditProvider: edit });
    await screen.findByRole("button", { name: "claudeLocal.launchAction" });
    fireEvent.click(
      screen.getByRole("button", { name: "claudeLocal.manageModels" }),
    );
    expect(edit).toHaveBeenCalledWith("synthetic-provider");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "synthetic-provider" },
    });
    expect(props.onSelectProvider).toHaveBeenCalledWith("synthetic-provider");
  });

  it("prepares the route before launching and never requests certificate trust", async () => {
    vi.mocked(providersApi.getClaudeDesktopStatus).mockResolvedValue({
      ...readyConnection,
      proxyRunning: false,
    });
    mount();
    const prepare = await screen.findByRole("button", {
      name: "claudeLocal.checkConnection",
    });
    vi.mocked(providersApi.getClaudeDesktopStatus).mockResolvedValue(
      readyConnection,
    );
    fireEvent.click(prepare);
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "prepare_connection",
        "synthetic-provider",
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "claudeLocal.launchAction" }),
    );
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "launch",
        "synthetic-provider",
      ),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("claudeLocal.launchRequested"),
    );
    expect(claudeDesktopLocal.action).not.toHaveBeenCalledWith(
      "trust",
      expect.anything(),
    );
    expect(screen.queryByText("claudeLocal.gatewayCleanupDone")).toBeNull();
  });

  it.each([true, null])(
    "blocks starting when process status is %s",
    async (desktopRunning) => {
      vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
        enabled: true,
        desktopRunning,
      });
      mount();
      expect(
        await screen.findByRole("button", { name: "claudeLocal.launchAction" }),
      ).toBeDisabled();
      expect(screen.getByRole("combobox")).toBeDisabled();
      expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
    },
  );

  it("shows missing-model setup instead of launching", async () => {
    const edit = vi.fn();
    mount({
      providers: [{ id: "synthetic-provider", name: "Synthetic" }],
      onEditProvider: edit,
    });
    const configure = await screen.findByRole("button", {
      name: "claudeLocal.configureModels",
    });
    await waitFor(() => expect(configure).toBeEnabled());
    fireEvent.click(configure);
    expect(edit).toHaveBeenCalledWith("synthetic-provider");
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
  });

  it("leaves optional features visible and unavailable with explanations", async () => {
    mount();
    fireEvent.click(await screen.findByText("claudeLocal.optionalFeatures"));
    for (const feature of ["voice", "computer", "cowork"]) {
      expect(
        screen.getByRole("switch", { name: `claudeLocal.${feature}` }),
      ).toBeDisabled();
      expect(
        screen.getByText(`claudeLocal.${feature}GatewayHint`),
      ).toBeVisible();
    }
  });

  it("keeps recovery blocking configuration in both modes", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      recoveryRequired: true,
    });
    mount();
    await screen.findByRole("button", { name: "claudeLocal.recoverAction" });
    for (const mode of ["normal", "guided"]) {
      fireEvent.click(
        screen.getByRole("button", { name: `claudeLocal.${mode}Mode` }),
      );
      expect(screen.queryByText("provider-management-fallback")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "claudeLocal.launchAction" }),
      ).toBeNull();
    }
  });

  it("keeps launch errors visible and allows retry without claiming success", async () => {
    vi.mocked(claudeDesktopLocal.action).mockRejectedValue(
      new Error("synthetic launch failure"),
    );
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "claudeLocal.launchAction" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "synthetic launch failure",
    );
    expect(
      screen.getByRole("button", { name: "claudeLocal.launchAction" }),
    ).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });
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
        screen.getByRole("button", { name: "claudeLocal.recheckInstallation" }),
      );
      await screen.findByText("claudeLocal.gatewayHint");
      expect(screen.getByText("provider-management-fallback")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "claudeLocal.trustAction" }),
      ).toBeNull();
      expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
    },
  );
  it("confirms every manual recheck even when the installation is unchanged", async () => {
    mount();
    await screen.findByText("claudeLocal.gatewayHint");
    expect(toast.success).not.toHaveBeenCalled();
    for (const count of [1, 2]) {
      fireEvent.click(
        screen.getByRole("button", { name: "claudeLocal.recheckInstallation" }),
      );
      await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(count));
    }
    expect(toast.success).toHaveBeenCalledWith(
      "claudeLocal.installationConfirmed",
    );
  });
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
