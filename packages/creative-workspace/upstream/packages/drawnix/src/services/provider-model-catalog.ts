import type { ModelConfig } from '../constants/model-config';
import {
  runtimeModelDiscovery,
  type RuntimeModelDiscoveryOptions,
} from '../utils/runtime-model-discovery';
import { normalizeModelApiBaseUrl } from '../utils/provider-base-url';
import {
  TUZI_PROVIDER_DEFAULT_BASE_URL,
  type ProviderProfile,
} from '../utils/settings-manager';
import { isTuziCompatibleBaseUrl } from './provider-routing/tuzi-api-endpoints';

interface DiscoverProviderModelsOptions
  extends Pick<RuntimeModelDiscoveryOptions, 'selectAll' | 'signal'> {
  forceMarketplaceRefresh?: boolean;
}

// Pricing enriches labels/categories only. A slow optional endpoint must not
// hold the authenticated model list behind its full 15-second timeout.
export const MODEL_METADATA_WAIT_MS = 2_000;
async function optionalMetadata<T>(
  request: Promise<T>,
  signal?: AbortSignal,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const fallback = new Promise<null>((resolve) => {
    abort = () => resolve(null);
    timer = setTimeout(abort, MODEL_METADATA_WAIT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    return await Promise.race([request, fallback]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

export function usesTuziMarketplace(profile: ProviderProfile): boolean {
  return (
    profile.id.startsWith('tuzi-') ||
    isTuziCompatibleBaseUrl(
      profile.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL,
    ) ||
    isTuziCompatibleBaseUrl(profile.pricingUrl)
  );
}

export async function discoverProviderModels(
  profile: ProviderProfile,
  fallbackBaseUrls: string[] = [],
  options: DiscoverProviderModelsOptions = {},
): Promise<ModelConfig[]> {
  options.signal?.throwIfAborted();
  const baseUrl = normalizeModelApiBaseUrl(
    profile.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL,
  );
  let modelMetadata: RuntimeModelDiscoveryOptions['modelMetadata'];

  if (usesTuziMarketplace(profile)) {
    const { modelPricingService, resolveProviderPricingConfig } = await import(
      '../utils/model-pricing-service'
    );
    const pricingConfig = resolveProviderPricingConfig(profile);
    try {
      if (pricingConfig) {
        const catalog = await optionalMetadata(
          modelPricingService.fetchAndCache(
            profile.id,
            pricingConfig.pricingUrl,
            profile.apiKey.trim(),
            pricingConfig.pricingGroup,
            pricingConfig.cnyPerUsd,
            { force: options.forceMarketplaceRefresh },
          ),
          options.signal,
        );
        modelMetadata = catalog
          ? Object.entries(catalog.prices).map(([id, price]) => ({
              id,
              description: price.description,
              ...catalog.modelCatalog?.[id],
              supported_endpoint_types:
                catalog.modelCatalog?.[id]?.supported_endpoint_types ||
                Object.keys(catalog.modelEndpoints?.[id] || {}),
            }))
          : undefined;
      }
    } catch {
      // Pricing is optional metadata; availability comes from the authenticated request.
    }
  }

  options.signal?.throwIfAborted();
  return runtimeModelDiscovery.discover(
    profile.id,
    baseUrl,
    profile.apiKey.trim(),
    fallbackBaseUrls,
    {
      selectAll: options.selectAll,
      signal: options.signal,
      modelMetadata,
    },
  );
}
