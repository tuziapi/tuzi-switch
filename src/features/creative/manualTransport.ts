import { encodeCreativeBytes, nativeCreativeResponse } from "./nativeStream";

export async function requestCreativeManual(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const target = new URL(url);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.hash
  )
    throw new Error("请填写完整的 HTTP 或 HTTPS 接口地址。");
  init.signal?.throwIfAborted();
  const prepared = new Request(url, init);
  const bytes = prepared.body
    ? new Uint8Array(await prepared.arrayBuffer())
    : undefined;
  if (bytes && bytes.length > 64 * 1024 * 1024)
    throw new Error("单次上传内容不能超过 64 MB。");
  return nativeCreativeResponse(
    "creative_manual_request",
    "creative_manual_cancel",
    {
      requestId: crypto.randomUUID(),
      url,
      method: prepared.method,
      headers: Object.fromEntries(prepared.headers),
      body: bytes ? encodeCreativeBytes(bytes) : null,
    },
    init.signal,
    (error) =>
      new Error(
        error === "creative_redirect_rejected"
          ? "接口发生重定向，请在配置中填写最终接口地址。"
          : "请求未完成，请检查配置或查询任务结果，避免重复提交。",
      ),
  );
}
