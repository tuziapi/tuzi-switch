import { isTauriEnvironment } from '../utils/tauri-env';
import { accountReferenceFromHeaders, requestAssistantAccount, hasAssistantTransport, fetchAssistantManual } from './assistant-account';

/** Desktop metadata reads bypass WebView CORS; web keeps its existing proxy. */
export async function fetchModelDiscovery(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
  const reference = accountReferenceFromHeaders(init.headers);
  if (reference) return requestAssistantAccount(reference, url, init);
  if (hasAssistantTransport()) return fetchAssistantManual(url, init);
  if (!isTauriEnvironment()) return globalThis.fetch.call(globalThis, url, init);
  init.signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  const internals = (window as unknown as {
    __TUZI_CREATIVE_NATIVE__: { invoke: (command: string, args: object) => Promise<{ status: number; body: string; content_type: string }> };
  }).__TUZI_CREATIVE_NATIVE__;
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(init.signal?.reason || new DOMException('Aborted', 'AbortError'));
    init.signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([internals.invoke('query_model_list', {
      url,
      authorization: headers.get('authorization'),
      googleApiKey: headers.get('x-goog-api-key'),
      timeoutMs: timeoutMs ?? null,
    }).catch((error: unknown) => { throw new Error(typeof error === 'string' ? error : '桌面模型请求失败'); }), cancelled]);
    init.signal?.throwIfAborted();
    if (result.status >= 300 && result.status < 400) throw new Error('模型接口发生重定向，请填写最终接口地址');
    return new Response([204, 205, 304].includes(result.status) ? null : result.body, {
      status: result.status, headers: { 'content-type': result.content_type },
    });
  } finally {
    if (abort) init.signal?.removeEventListener('abort', abort);
  }
}
