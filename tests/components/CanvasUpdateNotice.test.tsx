import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasUpdateNotice } from "@/components/CanvasUpdateNotice";
import { UpdateProvider } from "@/contexts/UpdateContext";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  download: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@/lib/updater", () => ({
  checkForUpdate: mocks.check,
  relaunchApp: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    info: mocks.info,
    dismiss: mocks.dismiss,
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function result(version = "1.6.3") {
  return {
    status: "available",
    info: {
      currentVersion: "1.6.2",
      availableVersion: version,
      channel: "stable",
      notes: "合成更新说明",
    },
    update: {
      version,
      download: mocks.download,
      install: vi.fn(),
      downloadAndInstall: vi.fn(),
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.check.mockResolvedValue(result());
});
afterEach(() => vi.useRealTimers());

describe("canvas update notice", () => {
  it("keeps the canvas notice after toast duration and opens notes without downloading", async () => {
    render(
      <UpdateProvider>
        <CanvasUpdateNotice />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(17000);
    });
    expect(screen.getByLabelText("桌面版本更新")).toBeInTheDocument();
    expect(screen.getByText("发现新版本 1.6.3")).toBeInTheDocument();
    expect(mocks.info).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "查看更新" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("合成更新说明")).toBeInTheDocument();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("retains a compact entry after dismissal and expands again for a newer version", async () => {
    render(
      <UpdateProvider>
        <CanvasUpdateNotice />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "收起更新提醒" }));
    expect(screen.queryByRole("button", { name: "查看更新" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "更新 1.6.3" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "稍后" }));
    mocks.check.mockResolvedValue(result("1.6.4"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    });
    expect(screen.getByText("发现新版本 1.6.4")).toBeInTheDocument();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("restores the global notification on leaving canvas without persisting a dismissal", async () => {
    const view = render(
      <UpdateProvider>
        <CanvasUpdateNotice />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.info).not.toHaveBeenCalled();
    view.rerender(
      <UpdateProvider>
        <span>其他页面</span>
      </UpdateProvider>,
    );
    expect(mocks.info).toHaveBeenCalledOnce();
    expect(
      localStorage.getItem("tuziswitch:update:dismissedVersion"),
    ).toBeNull();
  });
});
