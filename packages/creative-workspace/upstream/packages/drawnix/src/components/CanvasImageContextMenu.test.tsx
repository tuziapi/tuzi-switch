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
  download: vi.fn(),
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
  getAssistantAccount: () => ({ imageAction: mock.imageAction }),
}));
vi.mock("../utils/canvas-image-actions", () => ({
  runCanvasImageAction: mock.imageAction,
  copyImagePrompt: mock.copyPrompt,
}));
vi.mock("../utils/download-utils", () => ({ smartDownload: mock.download }));
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
  mock.imageAction.mockResolvedValue("saved");
  mock.download.mockResolvedValue({ downloadedCount: 1 });
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
    expect(mock.download).not.toHaveBeenCalled();
  });
  it.each(["[data-canvas-media-drag]", "video", null])(
    "opens native video menu on %s without targeting the image beneath",
    async (selector) => {
      mount();
      open(selector ? overlay.querySelector(selector)! : overlay);
      expect(screen.getAllByRole("menuitem")).toHaveLength(3);
      fireEvent.click(screen.getByText("视频另存为…"));
      await waitFor(() =>
        expect(mock.download).toHaveBeenCalledWith([
          { url: video.url, type: "video", filename: "video-movie" },
        ]),
      );
      expect(mock.imageAction).not.toHaveBeenCalled();
    },
  );
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
    mock.download.mockResolvedValue({ downloadedCount: 0 });
    mount();
    open(overlay);
    fireEvent.click(screen.getByText("视频另存为…"));
    await waitFor(() => expect(mock.download).toHaveBeenCalled());
    expect(mock.success).not.toHaveBeenCalled();
  });
  it("reports a video save error instead of falling back to image export", async () => {
    mock.download.mockRejectedValue(new Error("Original missing"));
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
