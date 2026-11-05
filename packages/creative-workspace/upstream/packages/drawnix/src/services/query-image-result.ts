import axios from 'axios';
import { isAccountReference, requestAssistantAccount } from './assistant-account';
import { providerTransport } from './provider-routing/provider-transport';
import { isTrustedTuziApiBaseUrl, isTuziRequestRecoveryBaseUrl, loadTuziApiEndpointBaseUrls, normalizeTuziApiEndpointUrl } from './provider-routing/tuzi-api-endpoints';
import { withTuziClientChannel } from './tuzi-client-attribution';
import { buildImageRecoveryUrl } from './image-generation-recovery-metadata';
import { fetchImageRecovery } from './image-recovery-fetch';
import { isTauriEnvironment } from '../utils/tauri-env';

/** Match canvas recovery: query the original provider, then trusted shared nodes on transport failure. */
export async function queryImageResult(baseUrl: string, apiKey: string, requestId: string) {
    if (isAccountReference(apiKey)) {
        const url = buildImageRecoveryUrl(baseUrl, requestId);
        if (!url) throw new Error('无效的图片结果查询地址');
        const response = await requestAssistantAccount(apiKey, url, {method:'GET'});
        const payload = await response.json();
        const echoedId = payload?.request_id ?? payload?.requestId;
        if (echoedId != null && echoedId !== requestId) return {status:'processing_or_not_found'};
        return payload;
    }
    if (!isTuziRequestRecoveryBaseUrl(baseUrl)) throw new Error('当前渠道不支持按请求 ID 恢复图片');
    const targets = [baseUrl];
    let fallbacksLoaded = false;
    let lastError: unknown;
    for (const target of targets) {
        try {
            const url = buildImageRecoveryUrl(target, requestId);
            if (!url) throw new Error('无效的图片结果查询地址');
            const prepared = providerTransport.prepareRequest({ profileId: 'canvas-recovery', profileName: 'Canvas recovery', providerType: 'custom', baseUrl: target, apiKey, authType: 'bearer' }, {
                path: '/log/get-request', method: 'GET',
            });
            const headers: Record<string, string> = {};
            new Headers(prepared.init.headers).forEach((value, name) => { headers[name] = value; });
            let payload: any;
            if (isTauriEnvironment()) {
                const response = await fetchImageRecovery(url, { headers, signal: AbortSignal.timeout(20_000) });
                if (!response.ok) throw Object.assign(new Error('Recovery request failed'), { response: { status: response.status } });
                payload = await response.json();
            } else {
                const response = await axios.get(withTuziClientChannel(url), { headers, timeout: 20_000 });
                payload = response.data;
            }
            const echoedId = payload?.request_id ?? payload?.requestId;
            if (echoedId != null && (typeof echoedId !== 'string' || echoedId.trim() !== requestId.trim())) {
                return { status: 'processing_or_not_found' };
            }
            if (payload && ['succeeded', 'failed', 'processing_or_not_found'].includes(payload.status)) return payload;
            lastError = new Error('结果查询返回无效响应，结果待确认');
        } catch (error) {
            const status = (error as { response?: { status?: number } })?.response?.status;
            // Authentication and other explicit query errors must not be hidden by fallback.
            if (status && status !== 404 && status !== 429 && status < 500) throw error;
            lastError = error;
        }
        if (!fallbacksLoaded) {
            fallbacksLoaded = true;
            const original = normalizeTuziApiEndpointUrl(baseUrl);
            targets.push(...[...new Set(await loadTuziApiEndpointBaseUrls())].filter(url => isTrustedTuziApiBaseUrl(url) && normalizeTuziApiEndpointUrl(url) !== original));
        }
    }
    throw lastError || new Error('暂时无法查询生成结果');
}
