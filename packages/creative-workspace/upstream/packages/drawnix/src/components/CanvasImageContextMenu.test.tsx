import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasImageContextMenu } from "./CanvasImageContextMenu";

const mock = vi.hoisted(() => ({
  hit: vi.fn(),
  imageAction: vi.fn(),
  videoAction: vi.fn(),
  nativeVideo: true,
  copyPrompt: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  preview: vi.fn(),
  host: null as HTMLElement | null,
}));
vi.mock("@plait/core", () => ({
  PlaitBoard: { getBoardContainer: () => mock.host },
  getHitElementByPoint: mock.hit,
  getElementById: (board: any, id: string) =>
    board.children.find((e: any) => e.id === id),
  toHostPoint: (_: unknown, x: number, y: number) => [x, y],
  toViewBoxPoint: (_: unknown, point: unknown) => point,
}));
vi.mock("@plait/draw", () => ({
  PlaitDrawElement: {
    isDrawElement: (e: any) => e.type === "image",
    isImage: (e: any) => e.type === "image",
  },
}));
vi.mock("../i18n", () => ({ useI18n: () => ({ language: "zh" }) }));
vi.mock("../data/audio", () => ({
  isAudioElement: (e: any) => e.type === "audio",
}));
vi.mock("../services/assistant-account", () => ({
  getAssistantAccount: () => ({
    imageAction: mock.imageAction,
    videoAction: mock.nativeVideo ? mock.videoAction : undefined,
  }),
}));
vi.mock("../utils/canvas-image-actions", () => ({
  runCanvasImageAction: mock.imageAction,
  copyImagePrompt: mock.copyPrompt,
}));
vi.mock("../utils/download-utils", () => ({
  runCanvasVideoAction: mock.videoAction,
}));
vi.mock("../utils/message-plugin", () => ({
  MessagePlugin: {
    loading: vi.fn(),
    close: vi.fn(),
    success: mock.success,
    error: mock.error,
  },
}));
const image = {
  id: "picture",
  type: "image",
  url: "/original.png",
  generationPrompt: "image prompt",
};
const video = {
  id: "movie",
  type: "image",
  url: "/original.mp4",
  isVideo: true,
  generationPrompt: "video prompt",
};
let svg: SVGElement;
let overlay: HTMLDivElement;
function mount() {
  return render(
    <CanvasImageContextMenu
      board={{ children: [image, video] } as any}
      onPreview={mock.preview}
    />,
  );
}
function open(element: Element) {
  fireEvent.contextMenu(element, { clientX: 120, clientY: 140, button: 2 });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.nativeVideo = true;
  mock.imageAction.mockResolvedValue("saved");
  mock.videoAction.mockResolvedValue("saved");
  mock.hit.mockReturnValue(image);
  mock.host = document.createElement("div");
  mock.host.innerHTML =
    '<svg class="board-host-svg"></svg><div data-native-media-overlay="true" data-canvas-media-id="movie"><div data-canvas-media-drag="true"></div><video controls></video></div>';
  document.body.append(mock.host);
  svg = mock.host.querySelector("svg")!;
  overlay = mock.host.querySelector("[data-native-media-overlay]")!;
});
afterEach(() => {
  cleanup();
  mock.host?.remove();
});
describe("canvas media context menu", () => {
  it("survives delayed canvas layout scrolling but dismisses when the user scrolls", () => {
    mount();
    open(svg);
    fireEvent.scroll(mock.host!);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.wheel(mock.host!, { deltaY: 40 });
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("keeps all five original image actions and binds them to the clicked image", async () => {
    mount();
    open(svg);
    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    fireEvent.click(screen.getByText("图片另存为…"));
    await waitFor(() =>
      expect(mock.imageAction).toHaveBeenCalledWith(
        "save",
        image.url,
        "image-picture",
      ),
    );
    expect(mock.videoAction).not.toHaveBeenCalled();
  });
  it.each(["[data-canvas-media-drag]", "video", null])(
    "opens native video menu on %s without targeting the image beneath",
    async (selector) => {
      mount();
      open(selector ? overlay.querySelector(selector)! : overlay);
      expect(screen.getAllByRole("menuitem")).toHaveLength(6);
      fireEvent.click(screen.getByText("视频另存为…"));
      await waitFor(() =>
        expect(mock.videoAction).toHaveBeenCalledWith(
          "save",
          video.url,
          "video-movie",
        ),
      );
      expect(mock.imageAction).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["复制视频文件", "copy", "copied"],
    ["显示视频文件", "reveal", "revealed"],
    ["复制文件路径", "copy-path", "path-copied"],
  ])("%s targets the clicked video original", async (label, action, result) => {
    mock.videoAction.mockResolvedValue(result);
    mount();
    open(overlay);
    fireEvent.click(screen.getByText(label));
    await waitFor(() =>
      expect(mock.videoAction).toHaveBeenCalledWith(
        action,
        video.url,
        "video-movie",
      ),
    );
    expect(mock.imageAction).not.toHaveBeenCalled();
    expect(mock.success).toHaveBeenCalled();
  });
  it("disables desktop file operations when the host does not support them", () => {
    mock.nativeVideo = false;
    mount();
    open(overlay);
    for (const label of ["复制视频文件", "显示视频文件", "复制文件路径"])
      expect(
        (screen.getByRole("menuitem", { name: label }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    expect(
      (
        screen.getByRole("menuitem", {
          name: "视频另存为…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("opens a video rendered inside SVG and previews its ID", () => {
    mock.hit.mockReturnValue(video);
    mount();
    open(svg);
    fireEvent.click(screen.getByText("预览视频"));
    expect(mock.preview).toHaveBeenCalledWith("movie");
  });
  it("copies the video prompt", async () => {
    mount();
    open(overlay);
    fireEvent.click(screen.getByText("复制提示词"));
    await waitFor(() =>
      expect(mock.copyPrompt).toHaveBeenCalledWith("video prompt"),
    );
  });
  it("does not report success after video save is cancelled", async () => {
    mock.videoAction.mockResolvedValue("cancelled");
    mount();
    open(overlay);
    fireEvent.click(screen.getByText("视频另存为…"));
    await waitFor(() => expect(mock.videoAction).toHaveBeenCalled());
    expect(mock.success).not.toHaveBeenCalled();
  });
  it("reports a video save error instead of falling back to image export", async () => {
    mock.videoAction.mockRejectedValue(new Error("Original missing"));
    mount();
    open(overlay);
    fireEvent.click(screen.getByText("视频另存为…"));
    await waitFor(() =>
      expect(mock.error).toHaveBeenCalledWith("Original missing"),
    );
    expect(mock.imageAction).not.toHaveBeenCalled();
  });
  it("blocks right-button drawing on native media but preserves left-click playback", () => {
    const listener = vi.fn();
    overlay.addEventListener("mousedown", listener);
    mount();
    expect(fireEvent.mouseDown(overlay, { button: 2 })).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    fireEvent.mouseDown(overlay, { button: 0 });
    expect(listener).toHaveBeenCalledOnce();
  });
  it("ignores a stale overlay without falling through to another media item", () => {
    overlay.dataset.canvasMediaId = "deleted";
    mount();
    open(overlay);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it.each([
    "input",
    "textarea",
    "div[contenteditable]",
    ".plait-tool-container",
  ])("preserves native menus on %s", (selector) => {
    const target = document.createElement(
      selector.startsWith("input")
        ? "input"
        : selector === "textarea"
          ? "textarea"
          : "div",
    );
    if (selector.includes("contenteditable"))
      target.setAttribute("contenteditable", "true");
    if (selector.startsWith(".")) target.className = selector.slice(1);
    svg.append(target);
    mount();
    open(target);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("does not fall back to the selection when right-clicking blank canvas", () => {
    mock.hit.mockReturnValue(undefined);
    mount();
    open(svg);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("replaces the image menu on a second right click, then dismisses on Escape", () => {
    mount();
    open(svg);
    open(overlay);
    expect(screen.queryByText("复制图片")).toBeNull();
    expect(screen.getByText("预览视频")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
