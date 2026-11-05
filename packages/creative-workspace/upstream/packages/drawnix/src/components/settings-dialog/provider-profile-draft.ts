import {
  DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
  type ProviderProfile,
} from '../../utils/settings-manager';

export function createProviderProfileDraft(
  index: number,
  id: string
): ProviderProfile {
  return {
    id,
    name: `供应商 ${index}`,
    iconUrl: '',
    homepageUrl: '',
    providerType: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    authType: 'bearer',
    imageApiCompatibility: DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
    enabled: true,
    capabilities: {
      supportsModelsEndpoint: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: true,
      supportsAudio: true,
      supportsTools: true,
    },
  };
}
