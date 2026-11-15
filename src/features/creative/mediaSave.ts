import { invoke } from "@tauri-apps/api/core";
import type { CreativeAccountBridge } from "@tuzi/creative-workspace";

const MAX_BYTES = 128 * 1024 * 1024;

export const nativeSaveMedia: NonNullable<
  CreativeAccountBridge["saveMedia"]
> = async (blob, name, kind) => {
  if (!blob.size || blob.size > MAX_BYTES) {
    throw new Error("媒体为空或超过 128 MB，无法导出。");
  }
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取媒体失败，请重试。"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
  const encodedName = btoa(
    String.fromCharCode(...new TextEncoder().encode(name.slice(0, 120))),
  );
  try {
    return await invoke<"saved" | "cancelled">("creative_save_media", bytes, {
      headers: { "x-media-name": encodedName, "x-media-kind": kind },
    });
  } catch (error) {
    throw new Error(
      typeof error === "string" ? error : "媒体保存失败，请重试。",
    );
  }
};
