import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutSection } from "@/components/settings/AboutSection";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  open: vi.fn(),
  webCheck: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  settingsApi: {
    getToolVersions: vi.fn().mockResolvedValue([]),
    getWebHotUpdateStatus: vi.fn().mockResolvedValue(null),
    checkWebHotUpdate: mocks.webCheck,
    openExternal: mocks.open,
  },
}));
vi.mock("@/lib/acceptanceUpdater", () => ({
  getUpdateBuildInfo: vi.fn().mockResolvedValue({ channel: "preview" }),
  ACCEPTANCE_DOWNLOAD_PAGE: "https://aiw520.github.io/tuzi-switch/",
}));
vi.mock("@/contexts/UpdateContext", () => ({
  useUpdate: () => ({
    hasUpdate: false,
    updateInfo: null,
    updateHandle: null,
    checkUpdate: mocks.check,
    isChecking: false,
    installState: { phase: "idle" },
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    info: mocks.info,
    success: mocks.success,
    error: mocks.error,
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("__APP_VERSION__", "1.6.3-beta.4");
  mocks.check.mockResolvedValue(null);
  mocks.webCheck.mockResolvedValue({ updated: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("standalone preview update guidance", () => {
  it("explains manual installation without claiming the preview is up to date", async () => {
    render(<AboutSection isPortable={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "settings.checkForUpdates" }),
    );
    await waitFor(() =>
      expect(mocks.info).toHaveBeenCalledWith(
        "settings.previewUpdateManualHint",
        { closeButton: true },
      ),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.webCheck).not.toHaveBeenCalled();
  });
  it("opens the existing test download page from release notes", async () => {
    await act(async () => {
      render(<AboutSection isPortable={false} />);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "settings.releaseNotes" }),
    );
    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith(
        "https://aiw520.github.io/tuzi-switch/",
      ),
    );
  });
});
