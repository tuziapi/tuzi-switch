import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsManager } from '../upstream/packages/drawnix/src/utils/settings-manager';
import { providerTransport } from '../upstream/packages/drawnix/src/services/provider-routing';
import { decomposeWithConfiguredImageProvider } from '../upstream/packages/drawnix/src/services/layer-decomposition/provider';
import { SEEDREAM55_MODEL_ID } from '../upstream/packages/drawnix/src/services/model-adapters/seedream55';

const capabilities = { supportsModelsEndpoint: true, supportsText: false, supportsImage: true, supportsVideo: false, supportsAudio: false, supportsTools: false };
const request = { image: 'data:image/png;base64,c3ludGhldGlj', maxLayers: 2, size: '1K' as const, textRecognition: true };
const options = { modelId: SEEDREAM55_MODEL_ID, profileId: 'synthetic-source' };
const response = { data: [0, 1, 2].map(z => ({
  url: 'https://example.test/layer.png', z_index: z,
  bounding_box: { absolute: [0, 0, 100, 100], normalized: [0, 0, 1000, 1000] },
  name: `layer-${z}`, background: z ? 'transparent' : 'opaque',
})) };

describe('layer source provider isolation with real settings routing', () => {
  beforeEach(async () => {
    await settingsManager.waitForInitialization();
    await settingsManager.updateSettings({
      gemini: { ...settingsManager.getSettings().gemini, baseUrl: 'https://legacy.example.test/v1', apiKey: 'sk-SYNTHETIC-LEGACY' },
      providerProfiles: [
        { id: 'synthetic-default', name: 'Unrelated default', providerType: 'openai-compatible', authType: 'bearer', capabilities, baseUrl: 'https://wrong.example.test/v1', apiKey: 'sk-SYNTHETIC-WRONG', enabled: true },
        { id: 'synthetic-source', name: 'Source provider', providerType: 'openai-compatible', authType: 'bearer', capabilities, baseUrl: 'https://source.example.test/v1', apiKey: 'sk-SYNTHETIC-SOURCE', enabled: true },
      ],
      invocationPresets: [{ id: 'synthetic', name: 'Synthetic', isDefault: true,
        image: { defaultModelRef: { profileId: 'synthetic-default', modelId: 'gpt-image-2.5-sunburst' } },
        text: { defaultModelRef: null }, audio: { defaultModelRef: null }, video: { defaultModelRef: null },
      }],
      activePresetId: 'synthetic',
    });
    vi.spyOn(providerTransport, 'send').mockResolvedValue(new Response(JSON.stringify(response)));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['', 'sk-SYNTHETIC-WRONG'])('uses the source provider with an unrelated default key %s', async defaultKey => {
    await settingsManager.updateSettings({ providerProfiles: settingsManager.getSettings().providerProfiles.map(
      profile => profile.id === 'synthetic-default' ? { ...profile, apiKey: defaultKey } : profile
    ) });
    const result = await decomposeWithConfiguredImageProvider(request, options);
    expect(result?.layers).toHaveLength(2);
    expect(providerTransport.send).toHaveBeenCalledTimes(1);
    const [context, sent] = vi.mocked(providerTransport.send).mock.calls[0];
    expect(context).toMatchObject({ baseUrl: 'https://source.example.test/v1', apiKey: 'sk-SYNTHETIC-SOURCE' });
    expect(JSON.parse(sent.body as string)).toMatchObject({ model: SEEDREAM55_MODEL_ID, size: '1K', layer_decomposition_options: { max_images: 3, text_recognition: true } });
  });

  it.each(['missing', 'disabled', 'without-key'])('refuses a %s source profile without falling back or submitting', async state => {
    const profiles = settingsManager.getSettings().providerProfiles;
    await settingsManager.updateSettings({ providerProfiles: state === 'missing'
      ? profiles.filter(p => p.id !== options.profileId)
      : profiles.map(p => p.id !== options.profileId ? p : { ...p, ...(state === 'disabled' ? { enabled: false } : { apiKey: '' }) }) });
    await expect(decomposeWithConfiguredImageProvider(request, options)).rejects.toThrow(/图片服务/);
    expect(providerTransport.send).not.toHaveBeenCalled();
  });
});
