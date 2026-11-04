import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAssistantAccount } from '../upstream/packages/drawnix/src/services/assistant-account';
import { fetchWithTuziClientChannel } from '../upstream/packages/drawnix/src/services/tuzi-client-attribution';
import { fetchModelDiscovery } from '../upstream/packages/drawnix/src/services/model-discovery-fetch';
import { modelPricingService } from '../upstream/packages/drawnix/src/utils/model-pricing-service';
import { providerPricingCacheSettings } from '../upstream/packages/drawnix/src/utils/settings-manager';
import type { CreativeAccountBridge } from '../src/bridge-types';

const reference = 'tuzi-account:synthetic-parity-binding';
function bridge() {
  const request = vi.fn().mockResolvedValue(new Response('{"data":[]}', {status:200}));
  const requestManual = vi.fn().mockResolvedValue(new Response('{"data":[]}', {status:200}));
  setAssistantAccount({state:{status:'connected'}, request, requestManual} as unknown as CreativeAccountBridge);
  return {request, requestManual};
}
afterEach(() => { setAssistantAccount(undefined); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('feature delta through assistant transport', () => {
  it('routes model discovery through the account bridge without sending a reference to fetch', async () => {
    const host = bridge(); const network = vi.fn(); vi.stubGlobal('fetch',network);
    await fetchModelDiscovery('https://api.tu-zi.com/v1/models', {headers:{Authorization:`Bearer ${reference}`}});
    expect(host.request).toHaveBeenCalledWith(reference,'https://api.tu-zi.com/v1/models',expect.any(Object));
    expect(host.requestManual).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('preserves multipart mask bytes and cancellation when using an account binding', async () => {
    const host = bridge(); const network = vi.fn(); vi.stubGlobal('fetch',network);
    const body = new FormData(); const mask = new Blob(['synthetic-transparent-mask'], {type:'image/png'});
    body.append('model','gpt-image-2'); body.append('mask',mask,'mask.png');
    const signal = new AbortController().signal;
    await fetchWithTuziClientChannel('https://api.tu-zi.com/v1/images/edits', {method:'POST',headers:{Authorization:`Bearer ${reference}`},body,signal});
    const [key,url,init] = host.request.mock.calls[0];
    expect(key).toBe(reference); expect(new URL(url).pathname).toBe('/v1/images/edits');
    expect(init.body).toBe(body); expect(init.signal).toBe(signal);
    expect((init.body.get('mask') as File).type).toBe('image/png');
    expect(host.requestManual).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('routes new Suno v2 calls through the existing manual native transport', async () => {
    const host = bridge(); const network = vi.fn(); vi.stubGlobal('fetch',network);
    const body = JSON.stringify({model:'suno-v2',prompt:'synthetic'});
    await fetchWithTuziClientChannel('https://api.tu-zi.com/suno/v2/generate', {method:'POST',body,headers:{Authorization:'Bearer SYNTHETIC-ONLY'}});
    expect(host.requestManual).toHaveBeenCalledWith(expect.stringContaining('/suno/v2/generate'),expect.objectContaining({body}));
    expect(host.request).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it.each(['https://api.tu-zi.com/api/pricing','https://pricing.synthetic.invalid/api/pricing'])('does not disclose account references to pricing: %s', async url => {
    const network = vi.fn().mockResolvedValue({ok:true,json:async()=>({success:true,data:[]})}); vi.stubGlobal('fetch',network);
    vi.spyOn(providerPricingCacheSettings,'update').mockResolvedValue();
    await modelPricingService.fetchAndCache('synthetic-parity',url,reference,'default',1,{force:true});
    expect(new Headers(network.mock.calls[0][1].headers).has('authorization')).toBe(false);
  });
});
