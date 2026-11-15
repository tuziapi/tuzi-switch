import { invoke } from "@tauri-apps/api/core";
import type { CreativeAccountBridge } from "@tuzi/creative-workspace";

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export const nativeImageAction: NonNullable<
  CreativeAccountBridge["imageAction"]
> = async (action, blob, name) => {
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) {
    throw new Error("图片为空或超过 64 MB，无法处理。");
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败，请重试。"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
  try {
    return await invoke("creative_image_action", {
      request: { action, data, name: name?.slice(0, 120) },
    });
  } catch (error) {
    throw new Error(
      typeof error === "string" ? error : "图片操作失败，请重试。",
    );
  }
};
