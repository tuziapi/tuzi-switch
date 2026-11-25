import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  callback: null as any,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
import { nativeCompressVideo } from "@/features/creative/videoCompression";
const options = {
  quality: "balanced",
  resolution: "720p",
  keepAudio: true,
} as const;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listen.mockImplementation(async (_event, callback) => {
    mocks.callback = callback;
    return mocks.unlisten;
  });
});
describe("native compression bridge", () => {
  it("passes only bytes and fixed options, filters foreign progress and cleans up", async () => {
    const progress = vi.fn();
    mocks.invoke.mockImplementation(async (_command, _bytes, config) => {
      mocks.callback({ payload: { id: "foreign", seconds: 100 } });
      mocks.callback({
        payload: { id: config.headers["x-compression-id"], seconds: 2 },
      });
      return new Uint8Array([1, 2, 3]).buffer;
    });
    const result = await nativeCompressVideo(
      new NodeBlob(["synthetic"]) as Blob,
      options,
      new AbortController().signal,
      progress,
    );
    expect(result.size).toBe(3);
    expect(progress.mock.calls).toEqual([[2]]);
    expect(mocks.invoke.mock.calls[0][2].headers).not.toHaveProperty(
      "authorization",
    );
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });
  it("sends cancellation for the same task even when native registration races abort", async () => {
    const controller = new AbortController();
    let finish!: (data: number[]) => void;
    mocks.invoke.mockImplementation((command) =>
      command === "creative_compress_video"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(),
    );
    const pending = nativeCompressVideo(
      new NodeBlob(["synthetic"]) as Blob,
      options,
      controller.signal,
      vi.fn(),
    );
    const assertion = expect(pending).rejects.toThrow("已取消");
    await vi.waitFor(() => expect(finish).toBeDefined());
    const id = mocks.invoke.mock.calls[0][2].headers["x-compression-id"];
    controller.abort();
    mocks.callback({ payload: { id, seconds: 0 } });
    finish([1, 2, 3]);
    await assertion;
    expect(mocks.invoke).toHaveBeenCalledWith("creative_cancel_compression", {
      id,
    });
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });
  it("rejects empty and oversized uploads before registering listeners", async () => {
    await expect(
      nativeCompressVideo(
        new Blob(),
        options,
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("128 MB");
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
