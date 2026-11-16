import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeLocalPanel } from "@/components/proxy/ClaudeLocalPanel";
import { claudeDesktopLocal } from "@/lib/api/claudeDesktopLocal";
vi.mock("@/lib/api/claudeDesktopLocal", () => ({
  claudeDesktopLocal: { status: vi.fn(), action: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
const stopped = {
  enabled: true,
  recoveryRequired: false,
  core: {
    version: "2.26454.0",
    caTrusted: true,
    nodeAvailable: true,
    claudeRunning: false,
    running: false,
    connected: false,
    supported: true,
    caReady: true,
    warning: null,
  },
};
function mount(id = "synthetic-provider") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ClaudeLocalPanel providerId={id} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claudeDesktopLocal.status).mockResolvedValue(stopped);
});
describe("Claude local experiment", () => {
  it("stays hidden in default builds without invoking mutations", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({ enabled: false });
    mount();
    await waitFor(() => expect(claudeDesktopLocal.status).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
  });
  it("launches only after the explicit action and binds the selected provider", async () => {
    vi.mocked(claudeDesktopLocal.action).mockResolvedValue({
      ...stopped,
      boundProvider: "Synthetic",
      core: { ...stopped.core, running: true },
    });
    mount();
    const button = await screen.findByRole("button", {
      name: "claudeLocal.launch",
    });
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "launch",
        "synthetic-provider",
      ),
    );
  });
  it("blocks launch until a provider and trusted certificate are available", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      core: { ...stopped.core, caTrusted: false },
    });
    mount("");
    expect(
      await screen.findByRole("button", { name: "claudeLocal.launch" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "claudeLocal.trust" }),
    ).toBeEnabled();
  });
  it("keeps recovery available and prevents another launch or certificate mutation", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      recoveryRequired: true,
      boundProvider: "Synthetic",
    });
    mount();
    expect(
      await screen.findByRole("button", { name: "claudeLocal.launch" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "claudeLocal.untrust" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "claudeLocal.stop" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "claudeLocal.computer" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "claudeLocal.cowork" }),
    ).toBeDisabled();
  });
  it("requires the local speech model before enabling voice", async () => {
    mount();
    expect(
      await screen.findByRole("checkbox", { name: "claudeLocal.voice" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "claudeLocal.prepareVoice" }),
    ).toBeEnabled();
    expect(claudeDesktopLocal.action).not.toHaveBeenCalled();
  });
  it("persists advanced options only through an explicit idle action", async () => {
    vi.mocked(claudeDesktopLocal.status).mockResolvedValue({
      ...stopped,
      voiceModelReady: true,
    });
    vi.mocked(claudeDesktopLocal.action).mockResolvedValue({
      ...stopped,
      voiceModelReady: true,
      options: { voiceInput: true, computerUse: false, cowork: false },
    });
    mount();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "claudeLocal.voice" }),
    );
    await waitFor(() =>
      expect(claudeDesktopLocal.action).toHaveBeenCalledWith(
        "enable_voice",
        "synthetic-provider",
      ),
    );
  });
});
