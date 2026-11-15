import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAssistantAccount } from '../upstream/packages/drawnix/src/services/assistant-account';
import { gptImageAdapter } from '../upstream/packages/drawnix/src/services/model-adapters/gpt-image-adapter';
import { tuziGPTImageAdapter } from '../upstream/packages/drawnix/src/services/model-adapters/tuzi-gpt-image-adapter';
import { unifiedCacheService } from '../upstream/packages/drawnix/src/services/unified-cache-service';
import { downloadMediaFile } from '../upstream/packages/drawnix/src/utils/download-utils';
import { getImageFailureDetails, toImageTaskError } from '../upstream/packages/drawnix/src/utils/image-error-details';
import type { CreativeAccountBridge } from '../src/bridge-types';
import type { Task } from '../upstream/packages/drawnix/src/types/task.types';

const model = 'gpt-image-2.6-1k';
const gif = 'R0lGODlhAAHAAIEAAPUUWgAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQALQAAACwAAAAAAAHAAAAI/wABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izat3KtavXr2DDih1LtqzZs2jTql3Ltq3bt3Djyp1Lt67du3jz6t3Lt6/fv4ADCx5MuLDhw4gTK17MuLHjx5AjS55MubLly5gza97MubPnz6BDix5NurTp06hTq17NurXr17Bjy55Nu7bt27hz697Nu7fv38CDCx9OvLjx48iTK1/OvLnz59CjS59Ovbr169iza9/Ovbv37+DDi2wfT768+fPo06tfz769+/fw48ufT7++/fv48+vfz7+///8ABijggAQWaOCBCCao4IIMNujggxBGKOGEFFZo4YUYZqjhhhx26OGHIIYo4ogklmjiiSimqOKKLLbo4oswxijjjDTWaOONOOa4UEAAIfkEAC0AAAAsAAAAAAABwACBCrTcAAAAAAAAAAAACP8AAQgcSLCgwYMIEypcyLChw4cQI0qcSLGixYsYM2rcyLGjx48gQ4ocSbKkyZMoU6pcybKly5cwY8qcSbOmzZs4c+rcybOnz59AgwodSrSo0aNIkypdyrSp06dQo0qdSrWq1atYs2rdyrWr169gw4odS7as2bNo06pdy7at27dw48qdS7eu3bt48+rdy7ev37+AAwseTLiw4cOIEytezLix48eQI0ueTLmy5cuYM2vezLmz58+gQ4seTbq06dOoU6tezbq169ewY8ueTbu27du4c+vezbu379/AgwsfTry48ePIkytfzry58+fQo0ufTr269evYs2vfzr279+/gw4tsH0++vPnz6NOrX8++vfv38OPLn0+/vv37+PPr38+/v///AAYo4IAEFmjggQgmqOCCDDbo4IMQRijhhBRWaOGFGGao4YYcdujhhyCGKOKIJJZo4okopqjiiiy26OKLMMYo44w01mjjjTjmuFBAADs=';
const response = () => new Response(JSON.stringify({ data: [{ b64_json: gif, width: 256, height: 192 }] }));
afterEach(() => { setAssistantAccount(undefined); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('develop 1.2.6 through the assistant boundary', () => {
  it.each([gptImageAdapter, tuziGPTImageAdapter])('$id uses account and manual native transports with isolated model parameters', async adapter => {
    const request = vi.fn(async () => response());
    const requestManual = vi.fn(async () => response());
    const network = vi.fn(() => { throw new Error('unexpected browser network'); });
    vi.stubGlobal('fetch', network);
    setAssistantAccount({ state: { status: 'connected' }, request, requestManual } as unknown as CreativeAccountBridge);
    for (const apiKey of ['tuzi-account:synthetic-126', 'SYNTHETIC-MANUAL-ONLY']) {
      const result = await adapter.generateImage({ baseUrl: 'https://api.tu-zi.com/v1', apiKey, authType: 'bearer' }, {
        model, prompt: 'synthetic GIF', size: '16:9', outputFormat: 'jpeg', params: { quality: 'max', resolution: '4k' },
      });
      expect(result).toMatchObject({ format: 'gif', width: 256, height: 192, url: `data:image/gif;base64,${gif}` });
    }
    expect(request).toHaveBeenCalledOnce(); expect(requestManual).toHaveBeenCalledOnce(); expect(network).not.toHaveBeenCalled();
    const [reference, url, init] = request.mock.calls[0] as unknown as [string, string, RequestInit];
    expect(reference).toBe('tuzi-account:synthetic-126'); expect(new URL(url).pathname).toBe('/v1/images/generations');
    expect(JSON.parse(String(init.body))).toEqual({ model, prompt: 'synthetic GIF', size: '16x9', n: 1, response_format: 'b64_json' });
  });

  it('saves cached GIF bytes through the native image action and preserves cancellation', async () => {
    const blob = new Blob([Uint8Array.from(atob(gif), char => char.charCodeAt(0))], { type: 'image/gif' });
    vi.spyOn(unifiedCacheService, 'getCachedBlob').mockResolvedValue(blob);
    const imageAction = vi.fn().mockResolvedValueOnce('saved').mockResolvedValueOnce('cancelled');
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    setAssistantAccount({ state: { status: 'disconnected' }, imageAction } as unknown as CreativeAccountBridge);
    const url = '/__aitu_cache__/image/synthetic-original.gif';
    expect(await downloadMediaFile(url, '动画', 'gif')).toMatchObject({ downloadedCount: 1 });
    expect(imageAction).toHaveBeenCalledWith('save', blob, '动画.gif');
    expect(await downloadMediaFile(url, '动画', 'gif')).toMatchObject({ downloadedCount: 0 });
    expect(network).not.toHaveBeenCalled();
  });

  it('redacts credential echoes in new persistence and historical display without losing provider IDs', () => {
    const message = 'Denied api_key=SYNTHETIC-ONLY Authorization: Bearer SYNTHETIC.JWT.VALUE (request id: request-126)';
    const error = Object.assign(new Error(message), { fullResponse: '{"error":{"message":"denied"},"api_key":"SYNTHETIC-JSON-ONLY"}' });
    const stored = toImageTaskError(error, 'FAILED', model);
    expect(JSON.stringify(stored)).not.toContain('SYNTHETIC');
    expect(stored.details.requestId).toBe('request-126');
    const historical = { params: { model }, error: { code: 'FAILED', message } } as Task;
    expect(getImageFailureDetails(historical).error).not.toContain('SYNTHETIC');
    expect(historical.error?.message).toBe(message);
  });
});
