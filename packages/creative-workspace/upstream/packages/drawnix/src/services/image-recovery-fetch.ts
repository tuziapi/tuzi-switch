import { isTauriEnvironment } from '../utils/tauri-env';
import { accountReferenceFromHeaders, requestAssistantAccount, hasAssistantTransport, fetchAssistantManual } from './assistant-account';

/** The desktop command is restricted to trusted Tuzi recovery GETs. */
export async function fetchImageRecovery(url: string, init: RequestInit = {}): Promise<Response> {
  const reference = accountReferenceFromHeaders(init.headers);
  if (reference) return requestAssistantAccount(reference, url, init);
  if (hasAssistantTransport()) return fetchAssistantManual(url, init);
  if (!isTauriEnvironment()) return globalThis.fetch.call(globalThis, url, init);
  if (init.signal?.aborted) throw init.signal.reason;
  const authorization = new Headers(init.headers).get('authorization') || '';
  const internals = (window as unknown as {
    __TUZI_CREATIVE_NATIVE__: { invoke: (command: string, args: object) => Promise<{ status: number; body: string }> };
  }).__TUZI_CREATIVE_NATIVE__;
  const result = await internals.invoke('query_image_recovery', { url, authorization });
  if (init.signal?.aborted) throw init.signal.reason;
  return new Response([204, 205, 304].includes(result.status) ? null : result.body, { status: result.status });
}
