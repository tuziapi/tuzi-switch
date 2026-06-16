import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { UpdateBadge } from "@/components/UpdateBadge";
import type { UpdateHandle, UpdateInfo } from "@/lib/updater";

const downloadAndInstallMock = vi.fn();
const resetDismissMock = vi.fn();
const relaunchMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

interface UpdateState {
  hasUpdate: boolean;
  updateInfo: UpdateInfo | null;
  updateHandle: UpdateHandle | null;
  isChecking: boolean;
  error: string | null;
  isDismissed: boolean;
  dismissUpdate: ReturnType<typeof vi.fn>;
  checkUpdate: ReturnType<typeof vi.fn>;
  resetDismiss: ReturnType<typeof vi.fn>;
}

let updateState: UpdateState;

vi.mock("@/contexts/UpdateContext", () => ({
  useUpdate: () => updateState,
}));

vi.mock("@/lib/updater", () => ({
  relaunchApp: () => relaunchMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "settings.updateAvailable") {
        return `检测到新版本：${params?.version}`;
      }
      if (key === "settings.updateDialogDescription") {
        return `当前版本 ${params?.current}，可升级到 ${params?.version}。`;
      }
      if (key === "settings.updateTo") {
        return `更新到 ${params?.version}`;
      }
      if (key === "settings.updateDownloadingWithProgress") {
        return `正在下载更新 ${params?.progress}%`;
      }
      return key;
    },
  }),
}));

describe("UpdateBadge", () => {
  beforeEach(() => {
    downloadAndInstallMock.mockReset();
    resetDismissMock.mockReset();
    relaunchMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();

    updateState = {
      hasUpdate: true,
      updateInfo: {
        currentVersion: "1.1.29",
        availableVersion: "1.1.30",
        notes: "修复更新体验",
      },
      updateHandle: {
        version: "1.1.30",
        downloadAndInstall: downloadAndInstallMock,
      },
      isChecking: false,
      error: null,
      isDismissed: false,
      dismissUpdate: vi.fn(),
      checkUpdate: vi.fn(),
      resetDismiss: resetDismissMock,
    };
  });

  it("opens an update dialog from the top badge", () => {
    render(<UpdateBadge />);

    fireEvent.click(screen.getByRole("button", { name: "检测到新版本：1.1.30" }));

    expect(screen.getByText("当前版本 1.1.29，可升级到 1.1.30。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新到 1.1.30" })).toBeInTheDocument();
  });

  it("shows progress and restart action after native update installs", async () => {
    downloadAndInstallMock.mockImplementation(async (onProgress) => {
      onProgress({ event: "Started", total: 100 });
      onProgress({ event: "Progress", downloaded: 50 });
      onProgress({ event: "Finished" });
    });

    render(<UpdateBadge />);

    fireEvent.click(screen.getByRole("button", { name: "检测到新版本：1.1.30" }));
    fireEvent.click(screen.getByRole("button", { name: "更新到 1.1.30" }));

    await waitFor(() => {
      expect(screen.getByText("settings.updateRestartTitle")).toBeInTheDocument();
    });

    expect(resetDismissMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "settings.updateInstalledRestarting",
      { closeButton: true },
    );

    fireEvent.click(screen.getByRole("button", { name: /settings.restartNow/ }));
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});
