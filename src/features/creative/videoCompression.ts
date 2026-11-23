import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CreativeAccountBridge } from "@tuzi/creative-workspace";

export const nativeCompressVideo: NonNullable<
  CreativeAccountBridge["compressVideo"]
> = async (input, options, signal, onProgress) => {
  signal.throwIfAborted();
  if (!input.size || input.size > 128 * 1024 * 1024)
    throw new Error("请选择 128 MB 以内的视频。");
  const id = crypto.randomUUID();
  const bytes = await input.arrayBuffer();
  signal.throwIfAborted();
  const unlisten = await listen<{ id: string; seconds: number }>(
    "creative-compression-progress",
    ({ payload }) => {
      if (payload.id !== id) return;
      if (signal.aborted) {
        void invoke("creative_cancel_compression", { id }).catch(() => {});
        return;
      }
      if (Number.isFinite(payload.seconds)) onProgress(payload.seconds);
    },
  );
  const cancel = () => {
    void invoke("creative_cancel_compression", { id }).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const pending = invoke<ArrayBuffer | number[]>(
      "creative_compress_video",
      bytes,
      {
        headers: {
          "x-compression-id": id,
          "x-compression-quality": options.quality,
          "x-compression-resolution": options.resolution,
          "x-compression-audio": options.keepAudio ? "keep" : "remove",
        },
      },
    );
    // Native registration happens before asynchronous processing; cancellation can race IPC dispatch.
    if (signal.aborted) cancel();
    const result = await pending;
    signal.throwIfAborted();
    return new Blob(
      [result instanceof ArrayBuffer ? result : new Uint8Array(result)],
      { type: "video/mp4" },
    );
  } catch (error) {
    if (signal.aborted) throw new Error("已取消压缩，原视频未改动。");
    throw error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "视频压缩失败。");
  } finally {
    signal.removeEventListener("abort", cancel);
    unlisten();
  }
};
