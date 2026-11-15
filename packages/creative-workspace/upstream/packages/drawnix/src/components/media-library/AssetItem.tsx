/**
 * Asset Item
 * 统一素材项组件 - 支持网格、紧凑、列表三种视图模式
 * 切换视图模式时组件不销毁，只更新样式，避免图片重新加载
 */

import { memo, useCallback } from 'react';
import {
  getAssetRuntimeUrl,
  isDesktopAssetUrl,
} from '../../utils/desktop-asset-url';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  Plus,
  Cloud,
  Heart,
  UserRound,
} from 'lucide-react';
import { Checkbox } from 'tdesign-react';
import { formatDate, formatFileSize } from '../../utils/asset-utils';
import { useAssetSize } from '../../hooks/useAssetSize';
import { LazyImage } from '../lazy-image';
import { useThumbnailUrl } from '../../hooks/useThumbnailUrl';
import { useUnifiedCache } from '../../hooks/useUnifiedCache';
import { VideoPosterPreview } from '../shared/VideoPosterPreview';
import { HoverTip } from '../shared/hover';
import {
  AssetCategory,
  type Asset,
  type ViewMode,
} from '../../types/asset.types';
import './AssetItem.scss';

function getDisplayUrl(asset: Asset): string {
  return getAssetRuntimeUrl(asset);
}

function getAssetDisplayKey(asset: Asset): string {
  return [
    asset.id,
    asset.type,
    asset.name,
    asset.url,
    asset.filePath || '',
    asset.thumbnail || '',
    asset.size ?? '',
    asset.mimeType,
    asset.category || '',
    asset.contentHash || '',
    asset.characterMeta?.name || '',
    asset.cacheWarning?.reasonCode || '',
    asset.cacheWarning?.message || '',
  ].join('|');
}

export interface AssetItemProps {
  asset: Asset;
  viewMode: ViewMode;
  isSelected: boolean;
  onSelect: (assetId: string, event?: React.MouseEvent) => void;
  onDoubleClick?: (asset: Asset) => void;
  onPreview?: (asset: Asset) => void;
  onContextMenu?: (asset: Asset, event: React.MouseEvent) => void;
  isInSelectionMode?: boolean;
  isSynced?: boolean; // 是否已同步到 Gist
  isFavorite?: boolean;
  onToggleFavorite?: (asset: Asset, event: React.MouseEvent) => void;
}

export const AssetItem = memo<AssetItemProps>(
  ({
    asset,
    viewMode,
    isSelected,
    onSelect,
    onDoubleClick,
    onPreview,
    onContextMenu,
    isInSelectionMode,
    isSynced,
    isFavorite,
    onToggleFavorite,
  }) => {
    // 获取实际文件大小（支持从缓存获取）
    const displayUrl = getDisplayUrl(asset);
    const displaySize = useAssetSize(asset.id, displayUrl, asset.size);

    // 根据视图模式选择预览图尺寸
    // 网格视图（120-180px）使用大尺寸预览图，紧凑/列表视图（60-80px）使用小尺寸预览图
    const thumbnailSize = viewMode === 'grid' ? 'large' : 'small';
    const thumbnailUrl = useThumbnailUrl(
      displayUrl,
      asset.type === 'IMAGE' ? 'image' : undefined,
      thumbnailSize
    );
    const { isCached, cacheWarning: detectedCacheWarning } = useUnifiedCache(
      (asset.type === 'IMAGE' || asset.type === 'VIDEO') &&
        !isDesktopAssetUrl(displayUrl)
        ? displayUrl
        : undefined
    );
    const cacheWarning =
      (asset.type === 'IMAGE' || asset.type === 'VIDEO') && !isCached
        ? detectedCacheWarning || asset.cacheWarning
        : undefined;
    const cacheWarningTip = cacheWarning
      ? `${cacheWarning.message}${cacheWarning.expiresHint ? `\n${cacheWarning.expiresHint}` : ''}`
      : '';

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        onSelect(asset.id, e);
      },
      [asset.id, onSelect]
    );

    const handleDoubleClick = useCallback(() => {
      // 双击预览
      if (onPreview && !isInSelectionMode) {
        onPreview(asset);
      }
    }, [asset, onPreview, isInSelectionMode]);

    const handleCheckboxClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(asset.id, e);
      },
      [asset.id, onSelect]
    );

    const ignoreCheckboxChange = useCallback(() => undefined, []);

    // 插入功能（原来的双击功能）
    const handleInsertClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onDoubleClick?.(asset);
      },
      [asset, onDoubleClick]
    );

    const handleContextMenu = useCallback(
      (event: React.MouseEvent) => {
        onContextMenu?.(asset, event);
      },
      [asset, onContextMenu]
    );

    const handleFavoriteClick = useCallback(
      (event: React.MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
        onToggleFavorite?.(asset, event);
      },
      [asset, onToggleFavorite]
    );

    const itemClassName = [
      'asset-item',
      `asset-item--${viewMode}`,
      isSelected ? 'asset-item--selected' : '',
      isInSelectionMode ? 'asset-item--selection-mode' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const isListMode = viewMode === 'list';
    const isCompactMode = viewMode === 'compact';
    const isSubjectAsset = asset.category === AssetCategory.CHARACTER;

    return (
      <div
        className={itemClassName}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        role="button"
        tabIndex={0}
        data-track={`asset_item_click_${viewMode}`}
      >
        {/* 列表模式：左侧复选框 */}
        {isListMode && isInSelectionMode && (
          <div
            className="asset-item__checkbox asset-item__checkbox--left"
            onClick={handleCheckboxClick}
          >
            <Checkbox
              checked={isSelected}
              onChange={ignoreCheckboxChange}
              data-track="asset_item_checkbox"
            />
          </div>
        )}

        {/* 缩略图容器 - 所有模式共享，切换时不销毁 */}
        <div className="asset-item__thumbnail">
          {asset.type === 'AUDIO' ? (
            asset.thumbnail ? (
              <LazyImage
                src={asset.thumbnail}
                alt={asset.name}
                className="asset-item__image"
                rootMargin="100px"
              />
            ) : (
              <div className="asset-item__audio-preview">
                <Music size={32} />
              </div>
            )
          ) : asset.type === 'IMAGE' ? (
            <LazyImage
              src={thumbnailUrl || displayUrl}
              alt={asset.name}
              className="asset-item__image"
              rootMargin="100px"
            />
          ) : (
            <VideoPosterPreview
              src={displayUrl}
              className="asset-item__video"
              alt={asset.name}
              poster={asset.thumbnail}
              thumbnailSize={thumbnailSize}
              videoProps={{
                muted: true,
                preload: 'metadata',
              }}
            />
          )}

          {/* 网格/紧凑模式：徽章 */}
          {!isListMode && !isCompactMode && (
            <div className="asset-item__badges">
              <div className="asset-item__type-badge">
                {asset.type === 'AUDIO' ? (
                  <Music />
                ) : asset.type === 'IMAGE' ? (
                  <ImageIcon />
                ) : (
                  <VideoIcon />
                )}
              </div>
              {asset.source === 'AI_GENERATED' && (
                <div className="asset-item__ai-badge">AI</div>
              )}
              {isSubjectAsset && (
                <HoverTip
                  content={asset.characterMeta?.name || '主体'}
                  showArrow={false}
                >
                  <div className="asset-item__subject-badge">
                    <UserRound size={10} />
                    <span>主体</span>
                  </div>
                </HoverTip>
              )}
              {isSynced && (
                <HoverTip content="已同步到云端" showArrow={false}>
                  <div className="asset-item__synced-badge">
                    <Cloud size={10} />
                  </div>
                </HoverTip>
              )}
              {cacheWarning && (
                <HoverTip content={cacheWarningTip} showArrow={false}>
                  <div className="asset-item__cache-warning-badge">
                    需下载
                  </div>
                </HoverTip>
              )}
            </div>
          )}

          {asset.type === 'AUDIO' && !isInSelectionMode && (
            <button
              type="button"
              className={`asset-item__favorite-btn ${
                isFavorite ? 'asset-item__favorite-btn--active' : ''
              }`}
              onClick={handleFavoriteClick}
              aria-label={isFavorite ? '取消收藏' : '加入收藏'}
            >
              <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
          )}

          {/* 网格模式：选择复选框 */}
          {!isListMode && isInSelectionMode && (
            <div
              className="asset-item__checkbox asset-item__checkbox--overlay"
              onClick={handleCheckboxClick}
            >
              <Checkbox
                checked={isSelected}
                onChange={ignoreCheckboxChange}
                data-track="asset_item_checkbox"
              />
            </div>
          )}

          {/* 插入按钮 - 统一渲染，显示由 CSS 控制 */}
          {!isListMode && !isInSelectionMode && onDoubleClick && (
            <HoverTip content="插入到画布" showArrow={false}>
              <button
                type="button"
                className="asset-item__preview-btn"
                onClick={handleInsertClick}
                aria-label="插入到画布"
                data-track="asset_item_insert"
              >
                <Plus size={16} />
              </button>
            </HoverTip>
          )}

          {/* 网格模式：渐变遮罩和名称 */}
          {!isListMode && !isCompactMode && (
            <>
              <div className="asset-item__overlay" />
              <HoverTip content={asset.name} showArrow={false}>
                <div className="asset-item__name-overlay">
                  {asset.name}
                </div>
              </HoverTip>
            </>
          )}
        </div>

        {/* 列表模式：信息区域 */}
        {isListMode && (
          <div className="asset-item__info">
            <HoverTip content={asset.name} showArrow={false}>
              <div className="asset-item__name">
                {asset.name}
              </div>
            </HoverTip>
            <div className="asset-item__meta">
              <span className="asset-item__type">
                {asset.type === 'IMAGE' ? (
                  <ImageIcon size={12} />
                ) : (
                  <VideoIcon size={12} />
                )}
                {asset.type === 'IMAGE' ? '图片' : '视频'}
              </span>
              {displaySize && (
                <span className="asset-item__size">
                  {formatFileSize(displaySize)}
                </span>
              )}
              <span className="asset-item__date">
                {formatDate(asset.createdAt)}
              </span>
            </div>
          </div>
        )}

        {isListMode && asset.type === 'AUDIO' && !isInSelectionMode && (
          <button
            type="button"
            className={`asset-item__favorite-btn asset-item__favorite-btn--list ${
              isFavorite ? 'asset-item__favorite-btn--active' : ''
            }`}
            onClick={handleFavoriteClick}
            aria-label={isFavorite ? '取消收藏' : '加入收藏'}
          >
            <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}

        {/* 列表模式：AI 标识 */}
        {isListMode && asset.source === 'AI_GENERATED' && (
          <div className="asset-item__ai-badge asset-item__ai-badge--list">
            AI
          </div>
        )}

        {isListMode && isSubjectAsset && (
          <HoverTip
            content={asset.characterMeta?.name || '主体'}
            showArrow={false}
          >
            <div className="asset-item__subject-badge asset-item__subject-badge--list">
              <UserRound size={12} />
              <span>主体</span>
            </div>
          </HoverTip>
        )}

        {/* 列表模式：已同步标识 */}
        {isListMode && isSynced && (
          <HoverTip content="已同步到云端" showArrow={false}>
            <div className="asset-item__synced-badge asset-item__synced-badge--list">
              <Cloud size={12} />
            </div>
          </HoverTip>
        )}

        {isListMode && cacheWarning && (
          <HoverTip content={cacheWarningTip} showArrow={false}>
            <div className="asset-item__cache-warning-badge asset-item__cache-warning-badge--list">
              需下载
            </div>
          </HoverTip>
        )}

        {/* 列表模式：插入按钮 */}
        {isListMode && !isInSelectionMode && onDoubleClick && (
          <HoverTip content="插入到画布" showArrow={false}>
            <button
              type="button"
              className="asset-item__preview-btn"
              onClick={handleInsertClick}
              aria-label="插入到画布"
              data-track="asset_item_insert"
            >
              <Plus size={16} />
            </button>
          </HoverTip>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数：只有关键属性变化时才重新渲染
    return (
      getAssetDisplayKey(prevProps.asset) === getAssetDisplayKey(nextProps.asset) &&
      prevProps.viewMode === nextProps.viewMode &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isInSelectionMode === nextProps.isInSelectionMode &&
      prevProps.onDoubleClick === nextProps.onDoubleClick &&
      prevProps.isSynced === nextProps.isSynced &&
      prevProps.isFavorite === nextProps.isFavorite
    );
  }
);

AssetItem.displayName = 'AssetItem';
