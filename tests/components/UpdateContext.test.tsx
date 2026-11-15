import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateProvider, useUpdate } from "@/contexts/UpdateContext";
import { registerUpdateGuard } from "@/lib/updateSafety";
const { check, info, download, open, success, restart, invoke } = vi.hoisted(
  () => ({
    check: vi.fn(),
    info: vi.fn(),
    download: vi.fn(),
    open: vi.fn(),
    success: vi.fn(),
    restart: vi.fn(),
    invoke: vi.fn(),
  }),
);
vi.mock("@/lib/updater", () => ({
  checkForUpdate: check,
  openReleasePage: open,
  relaunchApp: restart,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
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

describe("official signed update presentation", () => {
  it("shows notes, downloads only after consent, pins the version and saves before explicit install", async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const trace: string[] = [];
    const removeGuard = registerUpdateGuard(async () => {
      trace.push("save");
    });
    invoke.mockImplementation(async () => {
      trace.push("native-check");
    });
    install.mockImplementation(async () => {
      trace.push("install");
    });
    restart.mockImplementation(async () => {
      trace.push("restart");
    });
    check.mockResolvedValue({
      status: "available",
      info: {
        currentVersion: "1.5.6",
        availableVersion: "1.5.7",
        channel: "stable",
        notes: "合成签名版本说明",
      },
      update: {
        version: "1.5.7",
        download,
        install,
        downloadAndInstall: vi.fn(),
      },
    });
    try {
      render(
        <UpdateProvider>
          <Probe />
        </UpdateProvider>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(info.mock.calls[0][1].action.label).toBe("settings.viewUpdate");
      act(() => info.mock.calls[0][1].action.onClick());
      expect(screen.getByText("合成签名版本说明")).toBeInTheDocument();
      expect(download).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "下载更新" }));
      });
      expect(download).toHaveBeenCalledOnce();
      expect(install).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "稍后" }));
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
      });
      expect(check).toHaveBeenCalledOnce();
      act(() => info.mock.calls[0][1].action.onClick());
      expect(
        screen.getByRole("button", { name: "重启并更新" }),
      ).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "重启并更新" }));
      });
      expect(trace).toEqual(["save", "native-check", "install", "restart"]);
    } finally {
      removeGuard();
    }
  });
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

describe("official manual update presentation", () => {
  it("shows release notes first and opens an installer only after an explicit download click", async () => {
    check.mockResolvedValue({
      status: "available",
      info: {
        currentVersion: "1.5.5",
        availableVersion: "1.5.6",
        channel: "stable",
        notes: "合成更新说明 <script>synthetic</script>",
      },
      update: { manual: true, version: "1.5.6", downloadAndInstall: download },
    });
    render(
      <UpdateProvider>
        <Probe />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(info.mock.calls[0][1].action.label).toBe("settings.viewUpdate");
    await act(async () => {
      info.mock.calls[0][1].action.onClick();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("合成更新说明 <script>synthetic</script>"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("script")).toBeNull();
    expect(screen.getByText(/下载完成后请手动安装/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重启并更新" })).toBeNull();
    expect(download).not.toHaveBeenCalled();
    let finish!: () => void;
    download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下载安装包" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "正在打开浏览器…" }));
    });
    expect(download).toHaveBeenCalledOnce();
    await act(async () => {
      finish();
    });
    expect(success).toHaveBeenCalledWith("settings.updatePageOpened");
  });

  it("keeps an OS opening failure visible with copy and version-page recovery", async () => {
    const downloadUrl =
      "https://github.com/tuziapi/tuzi-switch/releases/download/v1.6.0/tuzi-assistant-windows-x64.exe";
    const openPage = vi.fn().mockResolvedValue(undefined);
    check.mockResolvedValue({
      status: "available",
      info: {
        currentVersion: "1.5.7",
        availableVersion: "1.6.0",
        channel: "stable",
      },
      update: {
        manual: true,
        version: "1.6.0",
        downloadUrl,
        openDownloadPage: openPage,
        downloadAndInstall: download,
      },
    });
    download.mockRejectedValue(new Error("系统未能打开浏览器：os error 1155"));
    invoke.mockResolvedValue(true);
    render(
      <UpdateProvider>
        <Probe />
      </UpdateProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => info.mock.calls[0][1].action.onClick());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "下载安装包" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("os error 1155");
    expect(screen.getByRole("textbox", { name: "安装包下载链接" })).toHaveValue(
      downloadUrl,
    );
    expect(success).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制下载链接" }));
    });
    expect(invoke).toHaveBeenCalledWith("copy_text_to_clipboard", {
      text: downloadUrl,
    });
    invoke.mockRejectedValueOnce("clipboard unavailable");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制下载链接" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("手动复制");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "打开版本下载页" }));
    });
    expect(openPage).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "已请求浏览器打开下载",
    );
    expect(screen.queryByRole("button", { name: "重启并更新" })).toBeNull();
  });
});
