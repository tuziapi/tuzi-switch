import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProviderCatalog,
  ProviderProfile,
} from '../utils/settings-manager';
import {
  discoverProviderModels,
  MODEL_METADATA_WAIT_MS,
} from './provider-model-catalog';
import { runtimeModelDiscovery } from '../utils/runtime-model-discovery';

const mocks = vi.hoisted(() => ({
  profiles: [] as ProviderProfile[],
  catalogs: [] as ProviderCatalog[],
  fetchAndCache: vi.fn(),
  resolvePricingConfig: vi.fn(),
}));

vi.mock('../utils/model-pricing-service', () => ({
  resolveProviderPricingConfig: mocks.resolvePricingConfig,
  modelPricingService: { fetchAndCache: mocks.fetchAndCache },
}));

vi.mock('../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
  providerCatalogsSettings: {
    get: () => mocks.catalogs,
    addListener: vi.fn(),
    update: vi.fn(async (catalogs: ProviderCatalog[]) => {
      mocks.catalogs = catalogs;
    }),
  },
  providerProfilesSettings: { get: () => mocks.profiles, addListener: vi.fn() },
  invocationPresetsSettings: { addListener: vi.fn() },
  settingsManager: { getSetting: () => [], addListener: vi.fn() },
}));
vi.mock('./tuzi-embedded-config', () => ({
  isTuziEmbeddedMode: () => false,
  tuziEmbeddedConfig: { enabled: false, apiBaseUrl: '' },
}));
vi.mock('./tuzi-provider-reuse-state', () => ({
  isCurrentTuziEndpoint: () => false,
  isVerifiedTuziProvider: () => true,
  TUZI_PROVIDER_REUSE_EVENT: 'test-provider-reuse',
}));
vi.mock('./tuzi-postmessage-bridge', () => ({
  requestTuziParentContext: vi.fn(),
  TUZI_BRIDGE_EVENT: 'test-bridge',
}));

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'tuzi-token-default',
    name: 'Tuzi default',
    apiKey: 'test-key',
    baseUrl: 'https://api.tu-zi.com/v1',
    enabled: true,
    capabilities: { supportsModelsEndpoint: true },
    ...overrides,
  } as ProviderProfile;
}

function mockModels(data: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ data }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('provider model catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profiles = [profile()];
    runtimeModelDiscovery.clear('tuzi-token-default');
    runtimeModelDiscovery.clear('custom-provider');
    mocks.resolvePricingConfig.mockImplementation((value: ProviderProfile) => ({
      pricingUrl: 'https://api.tu-zi.com/api/pricing',
      pricingGroup: value.pricingGroup || 'default',
      cnyPerUsd: 0.7,
    }));
    mocks.fetchAndCache.mockResolvedValue({
      prices: {
        'configured-renderer': { description: 'Marketplace image' },
        'public-only': { description: 'Not available to this key' },
      },
      modelCatalog: {
        'configured-renderer': { category: '生图', owned_by: 'Gemini' },
      },
      modelEndpoints: {
        'configured-renderer': { generate: { path: '/v1/images/generations' } },
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses the current key for discovery and only enriches returned model IDs', async () => {
    const fetchMock = mockModels([
      { id: 'configured-renderer' },
      { id: 'key-only-model' },
    ]);
    const models = await discoverProviderModels(
      profile({ apiKey: ' test-key ' }),
      [],
      {
        forceMarketplaceRefresh: true,
        selectAll: true,
      },
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/models$/),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-key',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
      }),
    );
    expect(models.map((model) => model.id)).toEqual([
      'configured-renderer',
      'key-only-model',
    ]);
    expect(models[0]).toMatchObject({
      type: 'image',
      vendor: 'GOOGLE',
      description: 'Marketplace image',
    });
    expect(
      runtimeModelDiscovery.getSelectedModelIds('tuzi-token-default'),
    ).toEqual(['configured-renderer', 'key-only-model']);
    expect(mocks.fetchAndCache).toHaveBeenCalledWith(
      'tuzi-token-default',
      'https://api.tu-zi.com/api/pricing',
      'test-key',
      'default',
      0.7,
      { force: true },
    );
    expect(
      runtimeModelDiscovery.getState('tuzi-token-default').discoverySource,
    ).toBe('models-endpoint');
  });

  it('refreshes the same profile with the new key instead of reusing its old model list', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url, init: RequestInit) =>
        Response.json({
          data: [
            {
              id:
                (init.headers as Record<string, string>).Authorization ===
                'Bearer key-a'
                  ? 'model-a'
                  : 'model-b',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    for (const key of ['key-a', 'key-b']) {
      const current = profile({ apiKey: key });
      mocks.profiles = [current];
      const models = await discoverProviderModels(current, [], {
        selectAll: true,
      });
      expect(models.map((model) => model.id)).toEqual([
        key === 'key-a' ? 'model-a' : 'model-b',
      ]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      runtimeModelDiscovery.getSelectedModelIds('tuzi-token-default'),
    ).toEqual(['model-b']);
    expect(
      runtimeModelDiscovery.getPinnedSelectableModel('text', 'model-a', {
        profileId: 'tuzi-token-default',
        modelId: 'model-a',
      }),
    ).toBeNull();
  });

  it('rejects invalid keys even when the public marketplace is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: 'Invalid API key' } },
            { status: 401 },
          ),
        ),
    );
    await expect(discoverProviderModels(profile())).rejects.toThrow(
      'Invalid API key',
    );
    expect(
      runtimeModelDiscovery.getDiscoveredModels('tuzi-token-default'),
    ).toEqual([]);
  });

  it('rejects an empty authenticated list instead of filling it from pricing', async () => {
    mockModels([]);
    await expect(discoverProviderModels(profile())).rejects.toThrow(
      '模型列表为空',
    );
  });

  it('continues authenticated discovery when the marketplace fails', async () => {
    mocks.fetchAndCache.mockRejectedValueOnce(
      new Error('Pricing API error: 503'),
    );
    mockModels([{ id: 'key-only-model' }]);
    expect(
      (await discoverProviderModels(profile())).map((model) => model.id),
    ).toEqual(['key-only-model']);
  });

  it.each(['missing', 'empty'])(
    'does not require a %s pricing catalog',
    async (kind) => {
      if (kind === 'missing')
        mocks.resolvePricingConfig.mockReturnValueOnce(null);
      else mocks.fetchAndCache.mockResolvedValueOnce({ prices: {} });
      mockModels([{ id: 'key-only-model' }]);
      expect(
        (await discoverProviderModels(profile())).map((model) => model.id),
      ).toEqual(['key-only-model']);
    },
  );

  it('prefers authenticated metadata over conflicting marketplace metadata', async () => {
    mockModels([
      {
        id: 'configured-renderer',
        category: 'text',
        description: 'Key response',
      },
    ]);
    expect((await discoverProviderModels(profile()))[0]).toMatchObject({
      type: 'text',
      description: 'Key response',
    });
  });

  it('bounds optional pricing latency and never adds public-only models', async () => {
    vi.useFakeTimers();
    mocks.fetchAndCache.mockReturnValueOnce(new Promise(() => {}));
    const fetchMock = mockModels([{ id: 'key-only-model' }]);
    const result = discoverProviderModels(profile());
    await vi.advanceTimersByTimeAsync(MODEL_METADATA_WAIT_MS + 1);
    expect((await result).map((model) => model.id)).toEqual(['key-only-model']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('cancels while waiting for metadata without starting a model request', async () => {
    mocks.fetchAndCache.mockReturnValueOnce(new Promise(() => {}));
    const fetchMock = mockModels([{ id: 'key-only-model' }]);
    const controller = new AbortController();
    const result = discoverProviderModels(profile(), [], {
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toThrow();
    controller.abort();
    await rejected;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['headers', 'body'])(
    'times out a stalled %s even when transport ignores abort, then allows retry',
    async (stage) => {
      vi.useFakeTimers();
      const never = new Promise<Response>(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          stage === 'headers'
            ? never
            : {
                ok: true,
                text: () => new Promise(() => {}),
              },
        )
        .mockResolvedValueOnce(
          Response.json({ data: [{ id: 'recovered-model' }] }),
        );
      vi.stubGlobal('fetch', fetchMock);
      const current = profile({
        id: 'custom-provider',
        baseUrl: 'https://synthetic.invalid/v1',
      });
      mocks.profiles = [current];
      const pending = discoverProviderModels(current);
      const failure = expect(pending).rejects.toThrow('模型列表请求超时');
      await vi.advanceTimersByTimeAsync(15001);
      await failure;
      expect(
        (await discoverProviderModels(current)).map((model) => model.id),
      ).toEqual(['recovered-model']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('ignores a late response after cancellation', async () => {
    let finish!: (value: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(delayed)
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'current-model' }] }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const current = profile({
      id: 'custom-provider',
      baseUrl: 'https://synthetic.invalid/v1',
    });
    mocks.profiles = [current];
    const controller = new AbortController();
    const pending = discoverProviderModels(current, [], {
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await rejected;
    await discoverProviderModels(current);
    finish(Response.json({ data: [{ id: 'stale-model' }] }));
    await Promise.resolve();
    expect(
      runtimeModelDiscovery
        .getDiscoveredModels(current.id)
        .map((model) => model.id),
    ).toEqual(['current-model']);
  });

  it('keeps authenticated discovery for non-Tuzi providers without fetching pricing', async () => {
    const current = profile({
      id: 'custom-provider',
      baseUrl: 'https://models.example.com/v1',
    });
    mocks.profiles = [current];
    const fetchMock = mockModels([{ id: 'custom-model' }]);
    expect(
      (await discoverProviderModels(current)).map((model) => model.id),
    ).toEqual(['custom-model']);
    expect(mocks.fetchAndCache).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://models.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });
});
