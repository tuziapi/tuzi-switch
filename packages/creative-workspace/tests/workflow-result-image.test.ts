import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowResultImage } from "../upstream/packages/drawnix/src/components/chat-drawer/WorkflowResultImage";
import { unifiedCacheService } from "../upstream/packages/drawnix/src/services/unified-cache-service";

vi.mock("@aitu/utils", () => ({
  normalizeImageDataUrl: (value: string) => value,
}));
vi.mock(
  "../upstream/packages/drawnix/src/services/unified-cache-service",
  () => ({
    unifiedCacheService: { getCachedImageBlobWithThumbnailFallback: vi.fn() },
  }),
);
const readCache = vi.mocked(
  unifiedCacheService.getCachedImageBlobWithThumbnailFallback,
);
const original = "/__aitu_cache__/image/content-synthetic.png";
const preview = vi.fn();
const card = (props = {}) =>
  React.createElement(WorkflowResultImage, {
    url: original,
    index: 0,
    onPreview: preview,
    ...props,
  });
beforeEach(() => {
  vi.useFakeTimers();
  preview.mockReset();
  readCache.mockReset().mockResolvedValue(new Blob(["SYNTHETIC"]));
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:workflow-result");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("workflow result images", () => {
  it("reads a desktop cache result, opens preview only after load, releases Blob on unmount", async () => {
    const { unmount } = render(card());
    fireEvent.click(screen.getByRole("button"));
    expect(preview).not.toHaveBeenCalled();
    await act(async () => undefined);
    expect(readCache).toHaveBeenCalledWith(original);
    const image = screen.getByAltText("生成结果 1");
    expect(image.getAttribute("src")).toBe("blob:workflow-result");
    fireEvent.load(image);
    expect(screen.queryByRole("status")).toBeNull();
    expect(image.style.visibility).toBe("visible");
    fireEvent.click(screen.getByRole("button"));
    expect(preview).toHaveBeenCalledTimes(1);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:workflow-result");
  });

  it("falls back from a broken thumbnail to the original cached image", async () => {
    render(card({ thumbnailUrl: "data:image/png;base64,broken" }));
    await act(async () => {
      fireEvent.error(screen.getByAltText("生成结果 1"));
    });
    expect(readCache).toHaveBeenCalledWith(original);
    const image = screen.getByAltText("生成结果 1");
    expect(image.getAttribute("src")).toBe("blob:workflow-result");
    fireEvent.load(image);
    expect(screen.queryByText("图片暂时无法显示")).toBeNull();
  });

  it("times out and retries only the displayed result without submitting a form or opening preview", async () => {
    readCache.mockResolvedValue(null);
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(React.createElement("form", { onSubmit: submit }, card()));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.getByText("图片暂时无法显示")).toBeTruthy();
    expect(screen.queryByAltText("生成结果 1")).toBeNull();
    readCache.mockResolvedValue(new Blob(["SYNTHETIC recovered"]));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "重新加载生成结果 1" }),
      );
    });
    fireEvent.load(screen.getByAltText("生成结果 1"));
    expect(screen.queryByText("图片暂时无法显示")).toBeNull();
    expect(preview).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not re-read cached images on unrelated parent updates", async () => {
    const { rerender } = render(card());
    await act(async () => undefined);
    fireEvent.load(screen.getByAltText("生成结果 1"));
    const calls = readCache.mock.calls.length;
    rerender(card({ onPreview: () => undefined }));
    await act(async () => undefined);
    expect(readCache).toHaveBeenCalledTimes(calls);
  });

  it("discards late cache reads after the result is removed", async () => {
    let resolve!: (blob: Blob) => void;
    readCache.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { unmount } = render(card());
    unmount();
    await act(async () => {
      resolve(new Blob(["SYNTHETIC late"]));
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:workflow-result");
    expect(preview).not.toHaveBeenCalled();
  });
});
