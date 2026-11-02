import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateProvider, useUpdate } from "@/contexts/UpdateContext";
const { check, info, download, open, success } = vi.hoisted(() => ({
  check: vi.fn(),
  info: vi.fn(),
  download: vi.fn(),
  open: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/lib/updater", () => ({
  checkForUpdate: check,
  openReleasePage: open,
}));
vi.mock("sonner", () => ({
  toast: { info, success, error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
function Probe() {
  const value = useUpdate();
  return (
    <span>{value.hasUpdate ? value.updateInfo?.availableVersion : "none"}</span>
  );
}
function available(version = "test-bbbbbbbb (#11)") {
  return {
    status: "available",
    info: {
      currentVersion: "test-aaaaaaaa (#10)",
      availableVersion: version,
      channel: "acceptance",
    },
    update: { manual: true, version, downloadAndInstall: download },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  check.mockResolvedValue(available());
  download.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});
describe("automatic update notifications", () => {
  it("checks on startup, shows a global notification, downloads only on click and does not repeat on polling", async () => {
    render(
      <UpdateProvider>
        <Probe />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("test-bbbbbbbb (#11)")).toBeInTheDocument();
    expect(info).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
    await act(async () => {
      await info.mock.calls[0][1].action.onClick();
    });
    expect(download).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    });
    expect(check).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledTimes(1);
  });
  it("remembers explicit dismissal across launches but not for a newer version", async () => {
    const first = render(
      <UpdateProvider>
        <Probe />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => info.mock.calls[0][1].cancel.onClick());
    first.unmount();
    info.mockClear();
    render(
      <UpdateProvider>
        <Probe />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(info).not.toHaveBeenCalled();
    check.mockResolvedValue(available("test-cccccccc (#12)"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    });
    expect(info).toHaveBeenCalledTimes(1);
  });
  it("throttles wake events and cleans up listeners and timers", async () => {
    const view = render(
      <UpdateProvider>
        <Probe />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      window.dispatchEvent(new Event("online"));
    });
    expect(check).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
      window.dispatchEvent(new Event("online"));
    });
    expect(check).toHaveBeenCalledTimes(2);
  });
  it("network errors do not advertise the app as up to date or show an update", async () => {
    check.mockRejectedValue(new Error("offline"));
    render(
      <UpdateProvider>
        <Probe />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(info).not.toHaveBeenCalled();
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});
