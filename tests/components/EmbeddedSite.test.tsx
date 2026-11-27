import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  native: true,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: api.invoke,
  isTauri: () => api.native,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
import { EmbeddedSite, syncSite } from "@/components/shell/EmbeddedSite";

beforeEach(() => {
  api.invoke.mockReset().mockResolvedValue(undefined);
  api.native = true;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 88,
    width: 1000,
    height: 600,
  } as DOMRect);
});
describe("embedded website lifecycle", () => {
  it("hides native content under assistant overlays and restores the same site", async () => {
    const view = render(<EmbeddedSite site="direct" />);
    await waitFor(() =>
      expect(api.invoke).toHaveBeenLastCalledWith("sync_embedded_site", {
        site: "direct",
        bounds: { x: 0, y: 88, width: 1000, height: 600 },
      }),
    );
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    act(() => {
      document.body.append(dialog);
    });
    await waitFor(() =>
      expect(api.invoke).toHaveBeenLastCalledWith("sync_embedded_site", {
        site: null,
        bounds: null,
      }),
    );
    expect(screen.getByText("关闭菜单或弹窗后继续浏览")).toBeVisible();
    expect(screen.queryByText("正在打开网站…")).not.toBeInTheDocument();
    act(() => {
      dialog.remove();
    });
    await waitFor(() =>
      expect(api.invoke.mock.calls.at(-1)?.[1].site).toBe("direct"),
    );
    expect(
      screen.queryByText("关闭菜单或弹窗后继续浏览"),
    ).not.toBeInTheDocument();
    view.rerender(<EmbeddedSite site="shop" />);
    await waitFor(() =>
      expect(api.invoke.mock.calls.at(-1)?.[1].site).toBe("shop"),
    );
    view.rerender(<EmbeddedSite site={null} />);
    await waitFor(() =>
      expect(api.invoke).toHaveBeenLastCalledWith("sync_embedded_site", {
        site: null,
        bounds: null,
      }),
    );
  });
  it("serializes a hide after an outstanding creation", async () => {
    let release!: () => void;
    api.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const create = syncSite({ site: "direct", bounds: {} });
    const hide = syncSite({ site: null, bounds: null });
    await waitFor(() => expect(api.invoke).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([create, hide]);
    expect(api.invoke).toHaveBeenLastCalledWith("sync_embedded_site", {
      site: null,
      bounds: null,
    });
  });
  it("reports failures and allows retry without silently opening a browser", async () => {
    api.invoke.mockRejectedValueOnce(new Error("synthetic failure"));
    render(<EmbeddedSite site="shop" />);
    expect(await screen.findByRole("status")).toHaveTextContent("网站加载失败");
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
  it("explains browser previews cannot host native website views", () => {
    api.native = false;
    render(<EmbeddedSite site="direct" />);
    expect(
      screen.getByText("请在兔子助手桌面应用中使用内嵌网站"),
    ).toBeVisible();
    expect(api.invoke).not.toHaveBeenCalled();
  });
});
