import policy from "@/config/creativeRequestPolicy.json";
import { encodeCreativeBytes } from "./nativeStream";

/** Both credential sources preserve the adapter's method, headers and body bytes. */
export async function prepareCreativeRequest(
  url: string,
  init: RequestInit = {},
) {
  const target = new URL(url);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.hash
  )
    throw new Error("请填写完整的 HTTP 或 HTTPS 接口地址。");
  init.signal?.throwIfAborted();
  // Cancellation belongs to nativeStream; this Request only serializes bytes.
  const prepared = new Request(url, { ...init, signal: undefined });
  const bytes = prepared.body
    ? new Uint8Array(await prepared.arrayBuffer())
    : undefined;
  init.signal?.throwIfAborted();
  if (bytes && bytes.length > 64 * 1024 * 1024)
    throw new Error("单次上传内容不能超过 64 MB。");
  return {
    requestId: crypto.randomUUID(),
    url,
    method: prepared.method,
    headers: Object.fromEntries(prepared.headers),
    body: bytes ? encodeCreativeBytes(bytes) : null,
  };
}

/** This is a destination/credential boundary, not another model adapter. */
export function prepareAccountTarget(
  reference: string,
  url: string,
  init: RequestInit,
) {
  const target = new URL(url);
  if (
    target.origin !== "https://api.tu-zi.com" ||
    target.username ||
    target.password ||
    target.hash ||
    /%(?:25|2f|5c)|\\/i.test(target.pathname) ||
    !(
      policy.modelPathPrefixes.some((prefix) =>
        target.pathname.startsWith(prefix),
      ) || policy.modelPaths.includes(target.pathname)
    )
  )
    throw new Error("账户关联请求必须使用兔子模型服务地址。");
  // Some adapters place the reference in a query auth field. It is never sent
  // to the server; native code supplies the selected model Key as Bearer auth.
  for (const [name, value] of [...target.searchParams]) {
    if (policy.credentialQueryKeys.includes(name.toLowerCase())) {
      if (value !== reference)
        throw new Error("账户关联不接受额外的请求凭证。");
      target.searchParams.delete(name);
    }
  }
  const headers = new Headers(init.headers);
  for (const name of policy.credentialHeaders) headers.delete(name);
  return { url: target.href, init: { ...init, headers } };
}
