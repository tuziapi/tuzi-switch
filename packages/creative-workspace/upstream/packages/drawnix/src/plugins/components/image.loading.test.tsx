import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Image as CanvasImage } from './image';
import { Video } from './video';
import { unifiedCacheService } from '../../services/unified-cache-service';
import { getCanvasImageError, isCanvasImageReady, retryCanvasImage } from '../../services/canvas-image-readiness';

vi.mock('../../mcp/tools/image-generation', () => ({ generateImage: vi.fn() }));
vi.mock('../../services/ppt', () => ({ getImageRegion: vi.fn() }));
vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedImageBlobWithThumbnailFallback: vi.fn(),
    getCachedBlob: vi.fn(async () => null),
  },
}));

const props = {
  board: { viewport: { zoom: 1 } },
  imageItem: { url: '/__aitu_cache__/image/a.png', width: 100, height: 100 },
  element: { id: 'a', type: 'image', url: '/__aitu_cache__/image/a.png', points: [[0, 0], [100, 100]] },
  isFocus: false,
  isSelected: false,
} as any;

describe('canvas image automatic loading', () => {
  const readCache = vi.mocked(unifiedCacheService.getCachedImageBlobWithThumbnailFallback);
  const observe = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    readCache.mockReset().mockResolvedValue(null);
    vi.stubGlobal('IntersectionObserver', class {
      observe = observe;
      disconnect = vi.fn();
    });
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:cached-image');
      static revokeObjectURL = revokeObjectURL;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads an unselected image from cache without any visibility callback or click', async () => {
    readCache.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    const { unmount } = render(<CanvasImage {...props} />);
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:cached-image'));
    expect(readCache).toHaveBeenCalledWith(props.imageItem.url);
    expect(document.querySelector('img')?.getAttribute('loading')).toBe('eager');
    expect(observe).not.toHaveBeenCalled();
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-image');
  });

  it('uses the original signed URL immediately when no cached image exists', async () => {
    const url = 'https://cdn.example.com/image.png?signature=original';
    render(<CanvasImage {...props} imageItem={{ ...props.imageItem, url }} />);
    const image = document.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(url);
    expect(image.getAttribute('loading')).toBe('eager');
    await waitFor(() => expect(readCache).toHaveBeenCalledWith(url));
    expect(image.getAttribute('src')).toBe(url);
    expect(image.style.opacity).toBe('1');
  });

  it('keeps the original image available when cache reading fails', async () => {
    readCache.mockRejectedValue(new Error('cache unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<CanvasImage {...props} />);
    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(document.querySelector('img')?.getAttribute('src')).toBe(props.imageItem.url);
    expect(document.querySelector('img')?.getAttribute('loading')).toBe('eager');
  });

  it('loads a changed source without requiring selection', async () => {
    const { rerender } = render(<CanvasImage {...props} />);
    const url = '/__aitu_cache__/image/b.png';
    rerender(<CanvasImage {...props} imageItem={{ ...props.imageItem, url }} />);
    expect(document.querySelector('img')?.getAttribute('src')).toBe(url);
    await waitFor(() => expect(readCache).toHaveBeenCalledWith(url));
    expect(observe).not.toHaveBeenCalled();
  });

  it('acknowledges the actual canvas load, invalidates changed sources and cleans up on unmount', async () => {
    const { rerender, unmount } = render(<CanvasImage {...props} />);
    const image = screen.getByRole('presentation');
    await waitFor(() => expect(readCache).toHaveBeenCalled());
    expect(isCanvasImageReady(props.board, 'a', props.imageItem.url)).toBe(false);
    fireEvent.load(image);
    expect(isCanvasImageReady(props.board, 'a', props.imageItem.url)).toBe(true);

    const url = '/__aitu_cache__/image/changed.png';
    rerender(<CanvasImage {...props} imageItem={{ ...props.imageItem, url }} />);
    expect(isCanvasImageReady(props.board, 'a', props.imageItem.url)).toBe(false);
    expect(isCanvasImageReady(props.board, 'a', url)).toBe(false);
    fireEvent.load(image);
    expect(isCanvasImageReady(props.board, 'a', url)).toBe(true);
    unmount();
    expect(isCanvasImageReady(props.board, 'a', url)).toBe(false);
  });

  it('does not acknowledge a failed canvas image', async () => {
    render(<CanvasImage {...props} imageItem={{ ...props.imageItem, url: 'data:image/png;base64,bad' }} />);
    fireEvent.error(screen.getByRole('presentation'));
    expect(isCanvasImageReady(props.board, 'a', 'data:image/png;base64,bad')).toBe(false);
  });

  it('ends a hung generated image load and reloads the same canvas result on retry', async () => {
    vi.useFakeTimers();
    const element = { ...props.element, generationTaskId: 'task-1' };
    const { unmount } = render(<CanvasImage {...props} element={element} />);
    const image = screen.getByRole('presentation');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(isCanvasImageReady(props.board, 'a', props.imageItem.url)).toBe(false);
    expect(getCanvasImageError(props.board, 'a', props.imageItem.url)).toContain('加载超时');
    act(() => { expect(retryCanvasImage(props.board, 'a', props.imageItem.url)).toBe(true); });
    const retriedImage = screen.getByRole('presentation');
    expect(retriedImage).not.toBe(image);
    expect(retriedImage.getAttribute('src')).toBe(props.imageItem.url);
    expect(getCanvasImageError(props.board, 'a', props.imageItem.url)).toBeUndefined();
    fireEvent.load(retriedImage);
    expect(isCanvasImageReady(props.board, 'a', props.imageItem.url)).toBe(true);
    unmount();
    await act(async () => undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers when the original generated image finishes after its loading deadline', async () => {
    vi.useFakeTimers();
    render(<CanvasImage {...props} element={{ ...props.element, generationTaskId: 'task-1' }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getCanvasImageError(props.board, 'a', props.imageItem.url)).toBeTruthy();
    fireEvent.load(screen.getByRole('presentation'));
    expect(isCanvasImageReady(props.board, 'a', props.imageItem.url)).toBe(true);
    expect(getCanvasImageError(props.board, 'a', props.imageItem.url)).toBeUndefined();
  });

  it('reports a failed generated image immediately rather than waiting for the deadline', () => {
    const url = 'data:image/png;base64,bad';
    render(<CanvasImage {...props} imageItem={{ ...props.imageItem, url }} element={{ ...props.element, generationTaskId: 'task-1' }} />);
    fireEvent.error(screen.getByRole('presentation'));
    expect(getCanvasImageError(props.board, 'a', url)).toContain('加载失败');
  });

  it('does not let the old source deadline fail a replacement image', async () => {
    vi.useFakeTimers();
    const element = { ...props.element, generationTaskId: 'task-1' };
    const { rerender } = render(<CanvasImage {...props} element={element} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const url = '/__aitu_cache__/image/replacement.png';
    rerender(<CanvasImage {...props} element={{ ...element, url }} imageItem={{ ...props.imageItem, url }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getCanvasImageError(props.board, 'a', url)).toBeUndefined();
    fireEvent.load(screen.getByRole('presentation'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(isCanvasImageReady(props.board, 'a', url)).toBe(true);
    expect(getCanvasImageError(props.board, 'a', url)).toBeUndefined();
  });

  it('acknowledges an image already decoded by the browser without waiting for another load event', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1920);
    render(<CanvasImage {...props} />);
    await waitFor(() => expect(isCanvasImageReady(props.board, 'a', props.imageItem.url)).toBe(true));
  });

  it('preserves an opaque video URL and the poster stored on its element', () => {
    const url = '/media/opaque-id';
    render(<CanvasImage {...props} imageItem={{ ...props.imageItem, url }}
      element={{ ...props.element, url, isVideo: true, poster: '/cover.png' }} />);
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/cover.png');
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    expect(document.querySelector('video')?.getAttribute('src')).toBe(url);
  });

  it('plays from the central button without opening canvas details or dragging', async () => {
    const canvasClick = vi.fn();
    const canvasPointer = vi.fn();
    render(<div onClick={canvasClick} onPointerDown={canvasPointer}>
      <Video videoItem={{ url: '/video.mp4' }} />
    </div>);
    const video = document.querySelector('video')!;
    fireEvent.loadedMetadata(video);
    const play = screen.getByRole('button', { name: '播放视频' });
    expect(Number(play.style.zIndex)).toBeGreaterThan(Number(document.querySelector<HTMLElement>('[data-canvas-media-drag]')!.style.zIndex));
    fireEvent.pointerDown(play);
    fireEvent.click(play);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(canvasClick).not.toHaveBeenCalled();
    expect(canvasPointer).not.toHaveBeenCalled();
    fireEvent.play(video);
    expect(screen.queryByRole('button', { name: '播放视频' })).toBeNull();
    fireEvent.pause(video);
    expect(screen.getByRole('button', { name: '播放视频' })).toBeTruthy();
  });

  it('allows a denied playback to be retried on the same video', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Playback denied'));
    render(<Video videoItem={{ url: '/video.mp4' }} />);
    const video = document.querySelector('video');
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试播放视频' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(document.querySelector('video')).toBe(video);
  });
});
