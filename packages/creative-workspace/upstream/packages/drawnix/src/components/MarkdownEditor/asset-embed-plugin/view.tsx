/**
 * assetEmbed NodeView — React 渲染
 *
 * 通过 useSyncExternalStore 订阅 global asset store，
 * 资产加载后自动重新渲染，无需 DOM hack。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { $view } from '@milkdown/kit/utils';
import { normalizeImageDataUrl } from '@aitu/utils';
import { subscribeAssetMap, getAssetMapSnapshot } from '../../../stores/asset-map-store';
import { AssetType } from '../../../types/asset.types';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
} from '../../../types/audio-node.types';
import { MarkdownAudioAssetCard } from '../MarkdownAudioAssetCard';
import {
  clamp,
  clampSizeByHeight,
  clampSizeByWidth,
  normalizeDimension,
} from '../media-size-utils';
import { RetryImage } from '../../retry-image';
import { VideoPosterPreview } from '../../shared/VideoPosterPreview';
import { assetEmbedSchema } from './schema';
import { getAssetRuntimeUrl } from '../../../utils/desktop-asset-url';

interface AssetEmbedViewProps {
  assetId: string;
  assetType: string;
  label: string;
  width: number | null;
  height: number | null;
  selected: boolean;
  readonly: boolean;
  updateAttrs: (attrs: Partial<AssetEmbedAttrs>) => void;
}

interface AssetEmbedAttrs {
  assetId: string;
  assetType: string;
  label: string;
  width: number | null;
  height: number | null;
}

const AUDIO_EMBED_MAX_HEIGHT = Math.round(AUDIO_NODE_DEFAULT_HEIGHT * 1.15);

function resolveAdaptiveAudioHeight(width: number): number {
  return clamp(
    Math.round((width * AUDIO_NODE_DEFAULT_HEIGHT) / AUDIO_NODE_DEFAULT_WIDTH),
    96,
    AUDIO_EMBED_MAX_HEIGHT
  );
}

const AssetEmbedView: React.FC<AssetEmbedViewProps> = ({
  assetId,
  assetType,
  label,
  width,
  height,
  selected,
  readonly,
  updateAttrs,
}) => {
  const assetMap = useSyncExternalStore(subscribeAssetMap, getAssetMapSnapshot);
  const asset = assetMap.get(assetId);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [draftSize, setDraftSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setDraftSize(null);
  }, [width, height]);

  const explicitWidth = draftSize?.width ?? normalizeDimension(width);
  const explicitHeight = draftSize?.height ?? normalizeDimension(height);
  const audioWidth = explicitWidth ?? AUDIO_NODE_DEFAULT_WIDTH;
  const adaptiveAudioHeight = resolveAdaptiveAudioHeight(audioWidth);
  const hasCorruptedAudioHeight = assetType === AssetType.AUDIO
    && typeof explicitHeight === 'number'
    && (
      explicitHeight > 240 ||
      explicitHeight > audioWidth * 0.75
    );
  const resolvedAudioHeight = assetType === AssetType.AUDIO
    ? clamp(
        hasCorruptedAudioHeight
          ? adaptiveAudioHeight
          : (explicitHeight ?? adaptiveAudioHeight),
        96,
        AUDIO_EMBED_MAX_HEIGHT
      )
    : explicitHeight;

  const frameStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {};
    if (explicitWidth) {
      style.width = `${explicitWidth}px`;
    } else if (assetType === AssetType.AUDIO) {
      style.width = 'min(100%, 560px)';
    } else {
      style.maxWidth = assetType === AssetType.AUDIO ? 'min(100%, 560px)' : 'min(100%, 520px)';
    }

    if (assetType === AssetType.AUDIO) {
      style.height = `${resolvedAudioHeight}px`;
    } else if (explicitHeight) {
      style.height = `${explicitHeight}px`;
    }
    return style;
  }, [assetType, explicitHeight, explicitWidth, resolvedAudioHeight]);

  const startResize = useCallback((handle: 'right' | 'bottom' | 'corner') => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readonly) {
      return;
    }

    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const editorRoot = frame.closest('.ProseMirror');
    const maxWidth = Math.max(160, (editorRoot?.getBoundingClientRect().width ?? rect.width) - 32);
    const maxHeight = assetType === AssetType.AUDIO ? AUDIO_EMBED_MAX_HEIGHT : 1600;
    const minWidth = 120;
    const minHeight = assetType === AssetType.AUDIO ? 96 : 80;
    const startState = {
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
    };

    let nextSize = {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startState.x;
      const dy = moveEvent.clientY - startState.y;
      const keepAspectRatio =
        assetType !== AssetType.AUDIO &&
        moveEvent.shiftKey &&
        startState.width > 0 &&
        startState.height > 0;

      const widthValue = handle === 'bottom'
        ? startState.width
        : clamp(startState.width + dx, minWidth, maxWidth);
      const heightValue = handle === 'right'
        ? startState.height
        : clamp(startState.height + dy, minHeight, maxHeight);

      if (assetType === AssetType.AUDIO) {
        const nextWidth = handle === 'bottom'
          ? clamp(Math.round(heightValue * (AUDIO_NODE_DEFAULT_WIDTH / AUDIO_NODE_DEFAULT_HEIGHT)), 120, maxWidth)
          : Math.round(widthValue);
        const nextHeight = resolveAdaptiveAudioHeight(nextWidth);
        nextSize = {
          width: nextWidth,
          height: nextHeight,
        };
        setDraftSize(nextSize);
        return;
      }

      if (keepAspectRatio) {
        const aspectRatio = startState.width / startState.height;
        const bounds = {
          minWidth,
          maxWidth,
          minHeight,
          maxHeight,
        };

        if (handle === 'right') {
          nextSize = clampSizeByWidth(widthValue, aspectRatio, bounds);
        } else if (handle === 'bottom') {
          nextSize = clampSizeByHeight(heightValue, aspectRatio, bounds);
        } else {
          const widthScale = widthValue / startState.width;
          const heightScale = heightValue / startState.height;
          nextSize = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
            ? clampSizeByWidth(widthValue, aspectRatio, bounds)
            : clampSizeByHeight(heightValue, aspectRatio, bounds);
        }

        nextSize = {
          width: Math.round(nextSize.width),
          height: Math.round(nextSize.height),
        };
        setDraftSize(nextSize);
        return;
      }

      nextSize = {
        width: Math.round(widthValue),
        height: Math.round(heightValue),
      };
      setDraftSize(nextSize);
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      setDraftSize(nextSize);
      updateAttrs({
        width: nextSize.width,
        height: nextSize.height,
      });
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp, { once: true });
  }, [assetType, readonly, updateAttrs]);

  const mediaFrame = (content: React.ReactNode, caption?: string) => (
    <div
      className={`collimind-asset-embed__shell ${selected ? 'is-selected' : ''}`}
      data-asset-type={assetType}
      data-asset-id={assetId}
    >
      <div ref={frameRef} className="collimind-asset-embed__frame" style={frameStyle}>
        {content}
        {!readonly && selected && (
          <>
            <button
              type="button"
              data-resize-handle="right"
              className="collimind-asset-embed__handle collimind-asset-embed__handle--right"
              onPointerDown={startResize('right')}
              aria-label={`调整${assetType === AssetType.AUDIO ? '音频' : '视频'}宽度`}
            />
            <button
              type="button"
              data-resize-handle="bottom"
              className="collimind-asset-embed__handle collimind-asset-embed__handle--bottom"
              onPointerDown={startResize('bottom')}
              aria-label={`调整${assetType === AssetType.AUDIO ? '音频' : '视频'}高度`}
            />
            <button
              type="button"
              data-resize-handle="corner"
              className="collimind-asset-embed__handle collimind-asset-embed__handle--corner"
              onPointerDown={startResize('corner')}
              aria-label={`同时调整${assetType === AssetType.AUDIO ? '音频' : '视频'}宽高`}
            />
          </>
        )}
      </div>
      {caption && (
        <div className="collimind-asset-embed__caption">{caption}</div>
      )}
    </div>
  );

  // asset map 为空说明资产还在加载中，显示占位而非"已删除"
  if (!asset) {
    if (assetMap.size === 0) {
      return <div className="collimind-asset-embed__loading" style={frameStyle} />;
    }
    return (
      <div className="collimind-asset-embed__missing" style={frameStyle}>
        素材不存在或已删除 ({assetId.slice(0, 8)}…)
      </div>
    );
  }

  if (asset.type === AssetType.IMAGE) {
    const runtimeUrl = getAssetRuntimeUrl(asset);
    return (
      <RetryImage
        className="collimind-asset-embed__image"
        src={normalizeImageDataUrl(runtimeUrl)}
        alt={label || asset.name || '素材图片'}
        showSkeleton={false}
        eager
      />
    );
  }

  if (asset.type === AssetType.VIDEO) {
    const runtimeUrl = getAssetRuntimeUrl(asset);
    return mediaFrame(
      <div className="collimind-asset-embed__video-wrap">
        <VideoPosterPreview
          className="collimind-asset-embed__video"
          src={runtimeUrl}
          poster={asset.thumbnail}
          alt={label || asset.name || '素材视频'}
          thumbnailSize="large"
          activateVideoOnClick
          playOnActivate
          videoProps={{
            controls: true,
            preload: 'metadata',
            playsInline: true,
          }}
        />
      </div>,
      label || asset.name
    );
  }

  if (asset.type === AssetType.AUDIO) {
    return mediaFrame(
      <MarkdownAudioAssetCard asset={asset} style={{ width: '100%', maxHeight: '100%' }} />,
      label || asset.name
    );
  }

  return null;
};

export const assetEmbedView = $view(assetEmbedSchema.node, () => {
  return (initialNode: any, view: any, getPos: () => number | undefined) => {
    const dom = document.createElement('div');
    dom.className = 'collimind-asset-embed';
    dom.setAttribute('data-asset-id', initialNode.attrs.assetId);

    let currentNode = initialNode;
    let selected = false;
    let reactRoot: Root | null = createRoot(dom);

    const updateAttrs = (attrs: Partial<AssetEmbedAttrs>) => {
      if (!view.editable) {
        return;
      }

      const pos = getPos();
      if (pos == null) {
        return;
      }

      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
        ...currentNode.attrs,
        ...attrs,
      }));
    };

    const renderNode = () => {
      reactRoot?.render(
        <AssetEmbedView
          assetId={currentNode.attrs.assetId}
          assetType={currentNode.attrs.assetType}
          label={currentNode.attrs.label}
          width={currentNode.attrs.width ?? null}
          height={currentNode.attrs.height ?? null}
          selected={selected}
          readonly={!view.editable}
          updateAttrs={updateAttrs}
        />
      );
    };
    renderNode();

    return {
      dom,
      update: (updatedNode: any) => {
        if (updatedNode.type !== initialNode.type) return false;
        currentNode = updatedNode;
        renderNode();
        return true;
      },
      stopEvent: (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return false;
        }

        return Boolean(target.closest('[data-resize-handle]'));
      },
      selectNode: () => {
        selected = true;
        dom.classList.add('selected');
        renderNode();
      },
      deselectNode: () => {
        selected = false;
        dom.classList.remove('selected');
        renderNode();
      },
      destroy: () => {
        if (reactRoot) {
          // 延迟 unmount 避免在 React 渲染期间同步卸载
          const root = reactRoot;
          reactRoot = null;
          setTimeout(() => root.unmount(), 0);
        }
      },
    };
  };
});
