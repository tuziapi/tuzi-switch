import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexSubagentSettings } from "@/components/settings/CodexSubagentSettings";

const {
  getSettingsMock,
  setSettingsMock,
  toastErrorMock,
  toastSuccessMock,
  translateMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  setSettingsMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  translateMock: (key: string) => key,
}));

vi.mock("@/lib/api", () => ({
  settingsApi: {
    getCodexSubagentSettings: getSettingsMock,
    setCodexSubagentMaxConcurrentThreads: setSettingsMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translateMock }),
}));

const settings = (value: number | null, usedLegacyAlias = false) => ({
  maxConcurrentThreadsPerSession: value,
  configPath: "/Users/test/.codex/config.toml",
  usedLegacyAlias,
});

describe("CodexSubagentSettings", () => {
  beforeEach(() => {
    getSettingsMock.mockResolvedValue(settings(6));
    setSettingsMock.mockImplementation(async (value: number | null) =>
      settings(value),
    );
  });

  it("loads the live Codex value and config path", async () => {
    render(<CodexSubagentSettings />);

    const input = await screen.findByDisplayValue("6");
    await waitFor(() => expect(input).toBeEnabled());
    expect(
      screen.getByText("/Users/test/.codex/config.toml"),
    ).toBeInTheDocument();
  });

  it("saves a custom value and can restore the Codex default", async () => {
    render(<CodexSubagentSettings />);
    const input = await screen.findByTestId("codex-subagent-thread-input");
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("codex-subagent-thread-save"));
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith(12));
    await waitFor(() => expect(input).toHaveValue(12));

    fireEvent.click(screen.getByTestId("codex-subagent-thread-reset"));
    await waitFor(() => expect(setSettingsMock).toHaveBeenCalledWith(null));
    await waitFor(() => expect(input).toHaveValue(null));
  });

  it("rejects invalid input without writing the config", async () => {
    render(<CodexSubagentSettings />);
    const input = await screen.findByTestId("codex-subagent-thread-input");
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("codex-subagent-thread-save"));

    expect(setSettingsMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "settings.codexSubagents.invalid",
    );
  });

  it("shows the migration notice for the legacy alias", async () => {
    getSettingsMock.mockResolvedValue(settings(4, true));
    render(<CodexSubagentSettings />);

    expect(
      await screen.findByText("settings.codexSubagents.legacyDetected"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("codex-subagent-thread-input")).toBeEnabled(),
    );
  });
});
