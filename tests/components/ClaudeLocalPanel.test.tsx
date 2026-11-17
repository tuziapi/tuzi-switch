import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeLocalPanel } from "@/components/proxy/ClaudeLocalPanel";
import {
  claudeDesktopLocal,
  type ClaudeLocalStatus,
} from "@/lib/api/claudeDesktopLocal";
import { providersApi } from "@/lib/api/providers";
vi.mock("@/lib/api/claudeDesktopLocal", () => ({
  claudeDesktopLocal: { status: vi.fn(), action: vi.fn() },
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
    providers: [{ id: "synthetic-provider", name: "Synthetic" }],
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
async function expand(key: string) {
  fireEvent.click(await screen.findByText(`claudeLocal.${key}`));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claudeDesktopLocal.status).mockResolvedValue(stopped);
  vi.mocked(claudeDesktopLocal.action).mockResolvedValue(stopped);
});
describe("Claude Desktop guided setup", () => {
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
    expect(screen.queryByText("provider-management-fallback")).toBeNull();
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
  });
  it("prepares resources without implicitly trusting or launching", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      core: {
        ...stopped.core,
        supported: false,
        version: "",
        caReady: false,
        caTrusted: false,
      },
    });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "claudeLocal.prepareAction" }),
    );
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "prepare",
        "synthetic-provider",
      ),
    );
    expect(claudeDesktopLocal.action).toHaveBeenCalledTimes(1);
  });
  it("requests trust only from the explicit authorization button", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      core: { ...stopped.core, caTrusted: false },
    });
    mount();
    const button = await screen.findByRole("button", {
      name: "claudeLocal.trustAction",
    });
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "trust",
        "synthetic-provider",
      ),
    );
    expect(claudeDesktopLocal.action).toHaveBeenCalledTimes(1);
  });
  it("launches with the selected provider and exposes failures inline", async () => {
    vi.mocked(claudeDesktopLocal.action).mockRejectedValue(
      new Error("Synthetic launch failure"),
    );
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "claudeLocal.launchAction" }),
    );
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "launch",
        "synthetic-provider",
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Synthetic launch failure",
    );
    expect(
      screen.getByRole("button", { name: "claudeLocal.launchAction" }),
    ).toBeEnabled();
  });
  it.each(["nodeAvailable", "claudeRunning"] as const)(
    "blocks launch when %s is not ready",
    async (field) => {
      vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
        ...stopped,
        core: { ...stopped.core, [field]: field === "claudeRunning" },
      });
      mount();
      expect(
        await screen.findByRole("button", { name: "claudeLocal.launchAction" }),
      ).toBeDisabled();
      expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
    },
  );
  it("keeps recovery accessible without a selected provider and locks mutations", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      recoveryRequired: true,
      boundProvider: "Bound original line",
    });
    mount({ providerId: undefined });
    const recover = await screen.findByRole("button", {
      name: "claudeLocal.recoverAction",
    });
    expect(recover).toBeEnabled();
    expect(screen.getByText("Bound original line")).toBeVisible();
    expect(screen.queryByRole("combobox")).toBeNull();
    await expand("optionalFeatures");
    expect(
      screen.getByRole("switch", { name: "claudeLocal.computer" }),
    ).toBeDisabled();
    await expand("advanced");
    expect(
      screen.getByRole("button", { name: "claudeLocal.untrust" }),
    ).toBeDisabled();
    fireEvent.click(recover);
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith("stop", undefined),
    );
  });
  it("shows selected defaults while voice awaits its model and allows cancellation", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      voiceModelReady: false,
      options: { voiceInput: true, computerUse: true, cowork: true },
    });
    mount();
    await expand("optionalFeatures");
    for (const feature of ["voice", "computer", "cowork"]) {
      const toggle = screen.getByRole("switch", {
        name: `claudeLocal.${feature}`,
      });
      expect(toggle).toBeChecked();
      expect(toggle).toBeEnabled();
    }
    expect(
      screen.getByText("claudeLocal.voicePendingDescription"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "claudeLocal.prepareVoice" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "claudeLocal.launchAction" }),
    ).toBeEnabled();
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "claudeLocal.voice" }));
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "disable_voice",
        "synthetic-provider",
      ),
    );
  });
  it("saves a voice preference before download without downloading or launching", async () => {
    mount();
    await expand("optionalFeatures");
    const toggle = screen.getByRole("switch", { name: "claudeLocal.voice" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "enable_voice",
        "synthetic-provider",
      ),
    );
    expect(claudeDesktopLocal.action).toHaveBeenCalledTimes(1);
  });
  it("prepares the speech model only from its download button", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      voiceModelReady: false,
      options: { voiceInput: true, computerUse: true, cowork: true },
    });
    mount();
    await expand("optionalFeatures");
    fireEvent.click(
      screen.getByRole("button", { name: "claudeLocal.prepareVoice" }),
    );
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "prepare_voice",
        "synthetic-provider",
      ),
    );
    expect(claudeDesktopLocal.action).toHaveBeenCalledTimes(1);
  });
  it("disables unsupported Linux features even if old options enable them", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      capabilities: {
        platform: "linux",
        voiceInput: false,
        computerUse: false,
        cowork: true,
      },
      options: { voiceInput: true, computerUse: true, cowork: false },
    });
    mount();
    await expand("optionalFeatures");
    expect(
      screen.getByRole("switch", { name: "claudeLocal.voice" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("switch", { name: "claudeLocal.voice" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "claudeLocal.computer" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "claudeLocal.cowork" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "claudeLocal.prepareVoice" }),
    ).toBeNull();
    expect(screen.getByText("claudeLocal.linuxHint")).toBeVisible();
  });
  it("persists options only after an explicit toggle", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      voiceModelReady: true,
    });
    mount();
    await expand("optionalFeatures");
    fireEvent.click(screen.getByRole("switch", { name: "claudeLocal.voice" }));
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "enable_voice",
        "synthetic-provider",
      ),
    );
  });
  it("switches lines through the existing provider action", async () => {
    const { props } = mount({
      providers: [
        { id: "synthetic-provider", name: "Synthetic" },
        { id: "other", name: "Other" },
      ],
    });
    fireEvent.change(
      await screen.findByRole("combobox", { name: "claudeLocal.lineLabel" }),
      { target: { value: "other" } },
    );
    expect(props.onSelectProvider).toHaveBeenCalledWith("other");
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
  });
  it("blocks launch while a provider switch is pending", async () => {
    mount({ switchingProviderId: "other" });
    expect(
      await screen.findByRole("button", { name: "claudeLocal.launchAction" }),
    ).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
