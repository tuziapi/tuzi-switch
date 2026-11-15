import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAssistantAccount } from "../upstream/packages/drawnix/src/services/assistant-account";
import { unifiedCacheService } from "../upstream/packages/drawnix/src/services/unified-cache-service";
import {
  readCanvasImage,
  runCanvasImageAction,
} from "../upstream/packages/drawnix/src/utils/canvas-image-actions";

vi.mock(
  "../upstream/packages/drawnix/src/services/unified-cache-service",
  () => ({
    unifiedCacheService: { getCachedBlob: vi.fn() },
  }),
);

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const source = `data:image/png;base64,${png}`;
const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Production allows data: images but disallows fetch(data:) in connect-src.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Load failed")),
  );
  vi.mocked(unifiedCacheService.getCachedBlob).mockResolvedValue(null);
});
afterEach(() => {
  setAssistantAccount(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inline original image export under production CSP", () => {
  it.each(["copy", "save", "reveal"] as const)(
    "%s receives original bytes without fetching or looking up the data URL",
    async (action) => {
      const imageAction = vi
        .fn()
        .mockResolvedValue(
          action === "copy"
            ? "copied"
            : action === "save"
              ? "saved"
              : "revealed",
        );
      setAssistantAccount({ imageAction } as never);
      await runCanvasImageAction(action, source, "original");
      const [receivedAction, blob, name] = imageAction.mock.calls[0];
      expect(receivedAction).toBe(action);
      expect(name).toBe("original");
      expect(await asDataUrl(blob)).toBe(source);
      expect(fetch).not.toHaveBeenCalled();
      expect(unifiedCacheService.getCachedBlob).not.toHaveBeenCalled();
    },
  );

  it("normalizes legacy raw Base64 and whitespace without changing bytes", async () => {
    expect(
      await asDataUrl(
        await readCanvasImage(` ${png.slice(0, 32)}\n${png.slice(32)} `),
      ),
    ).toBe(source);
    expect(
      await asDataUrl(
        await readCanvasImage(`${source.slice(0, 50)}\n${source.slice(50)}`),
      ),
    ).toBe(source);
  });

  it("keeps GIF original encoding rather than converting it to a still PNG", async () => {
    const gif =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    expect(await asDataUrl(await readCanvasImage(gif))).toBe(gif);
  });

  it.each(["data:image/png;base64,not-base64!", "data:image/png;base64,"])(
    "rejects invalid or empty inline data without fetching",
    async (invalid) => {
      await expect(readCanvasImage(invalid)).rejects.toThrow(/损坏|为空/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized data before Base64 decoding", async () => {
    const decode = vi.spyOn(globalThis, "atob");
    await expect(
      readCanvasImage(
        `data:image/png;base64,${"A".repeat(Math.ceil((64 * 1024 * 1024) / 3) * 4 + 4)}`,
      ),
    ).rejects.toThrow("超过 64 MB");
    expect(decode).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still uses original cache bytes and refuses a missing virtual original", async () => {
    const blob = new Blob(["cached original"], { type: "image/png" });
    vi.mocked(unifiedCacheService.getCachedBlob).mockResolvedValueOnce(blob);
    expect(await readCanvasImage("/__aitu_cache__/image/original.png")).toBe(
      blob,
    );
    await expect(
      readCanvasImage("/__aitu_cache__/image/missing.png"),
    ).rejects.toThrow("原图缓存暂不可用");
    expect(fetch).not.toHaveBeenCalled();
  });
});
