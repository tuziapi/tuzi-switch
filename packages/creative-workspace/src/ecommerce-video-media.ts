import { fetchOutputMedia } from "../upstream/packages/drawnix/src/services/assistant-account";
import { unifiedCacheService } from "../upstream/packages/drawnix/src/services/unified-cache-service";
import { isVirtualMediaUrl } from "../upstream/packages/drawnix/src/utils/virtual-media-url";
import { readEcommerceVideoResponse } from "./ecommerce-request";

/** Native WebViews cannot fetch service-worker virtual cache URLs as HTTP. */
export async function downloadEcommerceVideo(url: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (isVirtualMediaUrl(url)) {
    const blob = await unifiedCacheService.getCachedBlob(url, {
      allowNetwork: false,
    });
    signal.throwIfAborted();
    if (!blob)
      throw new Error("本地视频缓存无法读取，请保留任务编号并检查本地存储。");
    return readEcommerceVideoResponse(new Response(blob));
  }
  return readEcommerceVideoResponse(
    await fetchOutputMedia(url, signal, "video/*"),
  );
}
