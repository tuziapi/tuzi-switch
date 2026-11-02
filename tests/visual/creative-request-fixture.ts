// Preview-only transport. No network, credentials or production endpoint is used.
interface SyntheticRequestState {
  hold: boolean;
  fail: boolean;
  requests: Array<{ id: string; method: string; path: string }>;
  release: () => void;
}
const pending = new Set<() => void>();
const cancelled = new Set<string>();
export const creativeRequestFixture: SyntheticRequestState = {
  hold: false,
  fail: false,
  requests: [],
  release() { for (const finish of pending) finish(); pending.clear(); },
};
(window as unknown as { __creativeRequestFixture: SyntheticRequestState }).__creativeRequestFixture = creativeRequestFixture;
// A 1px synthetic PNG for persistence/decoding checks, not a generated artwork.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8uQAAAAASUVORK5CYII=';
export async function creativeManualPreviewIPC(command: string, args: unknown) {
  const payload = args as { requestId?: string; request: { requestId: string; url: string; method: string }; onChunk: {onmessage: (value: unknown) => void} };
  if (command === 'creative_manual_cancel') { cancelled.add(payload.requestId!); creativeRequestFixture.release(); return; }
  const {request, onChunk} = payload;
  const url = new URL(request.url);
  if (url.origin !== 'https://creative.synthetic.invalid') throw new Error('Synthetic transport rejects non-fixture endpoints');
  creativeRequestFixture.requests.push({id:request.requestId, method:request.method, path:url.pathname});
  onChunk.onmessage({type:'ready'});
  if (creativeRequestFixture.hold) await new Promise<void>(resolve => pending.add(resolve));
  if (cancelled.delete(request.requestId)) throw new Error('creative_cancelled_outcome_unknown');
  if (creativeRequestFixture.fail) throw new Error('creative_outcome_unknown');
  let body: unknown;
  if (url.pathname === '/v1/models') {
    body = {data:[{id:'gpt-image-2',supported_endpoint_types:['image-generation'],endpoints:{'image-generation':{path:'/v1/images/generations',method:'POST'}}}]};
  } else if (url.pathname === '/v1/images/generations' && request.method === 'POST') {
    body = {created:1,data:[{b64_json:png}]};
  } else throw new Error('Synthetic endpoint unsupported: '+url.pathname);
  onChunk.onmessage({type:'start',status:200,content_type:'application/json'});
  onChunk.onmessage({type:'data',data:btoa(JSON.stringify(body))});
  onChunk.onmessage({type:'end'});
}
