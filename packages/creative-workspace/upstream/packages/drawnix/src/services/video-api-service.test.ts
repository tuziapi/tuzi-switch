import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providerTransport } from './provider-routing/provider-transport';
import { unifiedCacheService } from './unified-cache-service';
import { videoAPIService } from './video-api-service';

const serviceMocks = vi.hoisted(() => ({
  resolveInvocationPlanFromRoute: vi.fn(),
  startLLMApiLog: vi.fn(() => 'video-log-1'),
  completeLLMApiLog: vi.fn(),
  failLLMApiLog: vi.fn(),
  updateLLMApiLogMetadata: vi.fn(),
}));

vi.mock('./provider-routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./provider-routing')>();
  return {
    ...actual,
    resolveInvocationPlanFromRoute:
      serviceMocks.resolveInvocationPlanFromRoute,
  };
});

vi.mock('./media-executor/llm-api-logger', () => ({
  startLLMApiLog: serviceMocks.startLLMApiLog,
  completeLLMApiLog: serviceMocks.completeLLMApiLog,
  failLLMApiLog: serviceMocks.failLLMApiLog,
  updateLLMApiLogMetadata: serviceMocks.updateLLMApiLogMetadata,
}));

const testProvider = {
  profileId: 'profile-minimax',
  profileName: 'MiniMax 测试供应商',
  providerType: 'openai-compatible',
  baseUrl: 'https://video.example.com/v1',
  apiKey: 'test-key',
  authType: 'bearer' as const,
};

describe('VideoAPIService Tuzi JSON submission', () => {
  beforeEach(() => {
    serviceMocks.resolveInvocationPlanFromRoute.mockReturnValue({
      provider: testProvider,
      binding: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['gemini-omni-1.2-flash', 'wan3.0-video', 'kling-4.0', 'happyhorse-1.1-t2v', 'happyhorse-1.1-i2v', 'happyhorse-1.1-r2v'])
  ('sends the documented JSON contract in the main-thread path: %s', async (model) => {
    const send = vi.spyOn(providerTransport, 'send').mockResolvedValue(
      new Response(JSON.stringify({ id: 'task', status: 'queued' }))
    );
    await videoAPIService.submitVideoGeneration({
      model, prompt: 'animate',
      inputReferences: model.endsWith('-i2v') || model.endsWith('-r2v')
        ? [{ slot: 0, url: 'https://images.example.test/a.png', name: 'a.png' }] : [],
    });
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][1];
    expect(request.path).toBe('/videos');
    expect(request.baseUrlStrategy).toBe('ensure-v1');
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe(model);
    if (model === 'wan3.0-video') expect(body).toMatchObject({ duration: 5, resolution: '1080P', ratio: 'adaptive' });
    if (model.startsWith('happyhorse')) expect(body.parameters).toMatchObject({ duration: 5, resolution: '1080P' });
    if (model === 'gemini-omni-1.2-flash') expect(body.seconds).toBe('10');
    if (model === 'kling-4.0') expect(body.settings).toEqual({ duration: 10, resolution: '1080p', aspect_ratio: 'adaptive' });
  });

  it('submits Kling reference images as native contents in the main-thread path', async () => {
    const send = vi.spyOn(providerTransport, 'send').mockResolvedValue(
      new Response(JSON.stringify({ id: 'task', status: 'queued' }))
    );
    await videoAPIService.submitVideoGeneration({
      model: 'kling-4.0', prompt: 'animate', seconds: '3', size: '720p',
      params: { watermark: 'false', ratio: '21:9' },
      inputReferences: [
        { slot: 1, url: 'https://images.example.test/b.png', name: 'b.png' },
        { slot: 0, url: 'https://images.example.test/a.png', name: 'a.png' },
      ],
    });
    expect(JSON.parse(String(send.mock.calls[0][1].body))).toEqual({
      model: 'kling-4.0',
      contents: [
        { type: 'prompt', text: 'animate' },
        { type: 'refer_image', url: 'https://images.example.test/a.png', id: 'image_1' },
        { type: 'refer_image', url: 'https://images.example.test/b.png', id: 'image_2' },
      ],
      settings: { duration: 3, resolution: '720p', aspect_ratio: '21:9' },
      options: { watermark_info: { enabled: false } },
    });
  });

  it('reads an original cached Gemini image and submits native Base64 from the main thread', async () => {
    const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAZAAAAGQCAIAAAAP3aGbAAAFMElEQVR4nO3UMQ0AMAzAsPIn3VLYN0WyEeTKLEDE/A4AeGVYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARmGBWQYFpBhWECGYQEZhgVkGBaQYVhAhmEBGYYFZBgWkGFYQIZhARkHfD8adYB8frcAAAAASUVORK5CYII=';
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    vi.spyOn(unifiedCacheService, 'getCachedBlob').mockResolvedValue({ size: bytes.length, type: 'image/png', arrayBuffer: async () => bytes.buffer } as Blob);
    const send = vi.spyOn(providerTransport, 'send').mockResolvedValue(new Response(JSON.stringify({ id: 'task_local', status: 'queued' })));
    await videoAPIService.submitVideoGeneration({ model: 'gemini-omni-1.2-flash', prompt: '', size: '720p', params: { ratio: '9:16' },
      inputReferences: [{ slot: 0, url: '/asset-library/local.png', name: 'local.png' }] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(send.mock.calls[0][1].body))).toEqual({ model: 'gemini-omni-1.2-flash', seconds: '10', size: '720x1280',
      input: [{ type: 'image', mime_type: 'image/png', data: encoded }] });
  });

  it('rejects a Wan tail frame without a first frame in the main-thread path', async () => {
    const send = vi.spyOn(providerTransport, 'send');
    await expect(videoAPIService.submitVideoGeneration({
      model: 'wan3.0-video', prompt: 'animate',
      inputReferences: [{ slot: 1, url: 'https://images.example.test/last.png', name: 'last.png' }],
    })).rejects.toThrow('尾帧需要同时提供首帧');
    expect(send).not.toHaveBeenCalled();
  });

});
