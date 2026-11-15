/**
 * Media Library Inspector
 * 素材库详情面板组件
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Dialog, Input, MessagePlugin } from 'tdesign-react';
import {
  Download,
  Trash2,
  Edit2,
  CheckCircle,
  Copy,
  UserRound,
  FileWarning,
} from 'lucide-react';
import { copyToClipboard } from '../../utils/runtime-helpers';
import { formatDate, formatFileSize } from '../../utils/asset-utils';
import { useAssetSize } from '../../hooks/useAssetSize';
import { isCacheUrl, countElementsByAssetUrls } from '../../utils/asset-cleanup';
import { useDrawnix } from '../../hooks/use-drawnix';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { RetryImage } from '../retry-image';
import { VideoPosterPreview } from '../shared/VideoPosterPreview';
import { HoverTip } from '../shared/hover';
import type { MediaLibraryInspectorProps } from '../../types/asset.types';
import { AssetCategory, AssetType } from '../../types/asset.types';
import {
  convertLocalFilePathToAssetUrl,
  isDesktopAssetUrl,
} from '../../utils/desktop-asset-url';
import './MediaLibraryInspector.scss';

function isDataURL(value: string): boolean {
  return value.trim().startsWith('data:');
}

function normalizeImageDataUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed;
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length >= 32) {
    return `data:image/png;base64,${trimmed}`;
  }
  return trimmed;
}

/**
 * 获取预览图 URL（通过添加查询参数）
 * @param originalUrl 原始 URL
 * @param size 预览图尺寸（默认 small）
 */
function getThumbnailUrl(originalUrl: string, size: 'small' | 'large' = 'small'): string {
  const normalizedUrl = normalizeImageDataUrl(originalUrl);
  if (
    normalizedUrl.startsWith('http://') ||
    normalizedUrl.startsWith('https://') ||
    normalizedUrl.startsWith('blob:') ||
    isDataURL(normalizedUrl) ||
    isDesktopAssetUrl(normalizedUrl)
  ) {
    return normalizedUrl;
  }

  try {
    const url = new URL(normalizedUrl, window.location.origin);
    url.searchParams.set('thumbnail', size);
    return url.toString();
  } catch {
    // 如果 URL 解析失败，直接拼接参数
    const separator = normalizedUrl.includes('?') ? '&' : '?';
    return `${normalizedUrl}${separator}thumbnail=${size}`;
  }
}

export function MediaLibraryInspector({
  asset,
  selectedAssets = [],
  isSelectionMode = false,
  onRename,
  onDelete,
  onDownload,
  onMarkAsSubject,
  onSelect,
  onSelectMultiple,
  showSelectButton,
  selecting = false,
  selectButtonText = '使用',
}: MediaLibraryInspectorProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [subjectDialogVisible, setSubjectDialogVisible] = useState(false);
  const [subjectName, setSubjectName] = useState('');
  const [subjectPrompt, setSubjectPrompt] = useState('');
  const [isSavingSubject, setIsSavingSubject] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const { board } = useDrawnix();

  useEffect(() => {
    setPreviewFailed(false);
  }, [asset?.id]);

  // 获取实际文件大小（支持从缓存获取）
  const displaySize = useAssetSize(asset?.id, asset?.url, asset?.size);

  const selectedAssetCount = selectedAssets.length;
  const selectedImageCount = selectedAssets.filter(
    (item) => item.type === AssetType.IMAGE
  ).length;
  const selectedVideoCount = selectedAssets.filter(
    (item) => item.type === AssetType.VIDEO
  ).length;
  const selectedAudioCount = selectedAssets.filter(
    (item) => item.type === AssetType.AUDIO
  ).length;
  const selectedTotalSize = selectedAssets.reduce(
    (sum, item) => sum + (item.size || 0),
    0
  );

  // 检查素材是否为缓存类型（合并图片/视频），并统计画布中使用该素材的元素数量
  const { isCacheAsset, canvasElementCount } = useMemo(() => {
    if (!asset || !board) {
      return { isCacheAsset: false, canvasElementCount: 0 };
    }
    const isCache = isCacheUrl(asset.url);
    const count = isCache ? countElementsByAssetUrls(board, asset.dedupeUrls || [asset.url]) : 0;
    return { isCacheAsset: isCache, canvasElementCount: count };
  }, [asset, board]);
  const inspectorTrackParams = useMemo(() => {
    if (!asset) {
      return undefined;
    }

    return JSON.stringify({
      assetId: asset.id,
      assetType: asset.type,
      assetSource: asset.source,
    });
  }, [asset]);

  // 开始重命名
  const handleStartRename = useCallback(() => {
    if (asset) {
      setNewName(asset.name);
      setIsRenaming(true);
    }
  }, [asset]);

  // 确认重命名（blur 或 Enter 时触发）
  const handleConfirmRename = useCallback(async () => {
    if (!asset) {
      setIsRenaming(false);
      return;
    }
    
    const trimmedName = newName.trim();
    // 如果名称为空或没有变化，取消编辑
    if (!trimmedName || trimmedName === asset.name) {
      setIsRenaming(false);
      setNewName('');
      return;
    }

    try {
      await onRename(asset.id, trimmedName);
      setIsRenaming(false);
      // Toast 已在 Context 中显示，这里不重复
    } catch (error) {
      // 错误已在Context中处理
      setIsRenaming(false);
    }
  }, [asset, newName, onRename]);

  // 处理键盘事件（Escape 取消）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsRenaming(false);
      setNewName('');
    }
  }, []);

  // 打开删除确认对话框
  const handleOpenDeleteDialog = useCallback(() => {
    setDeleteDialogVisible(true);
  }, []);

  // 确认删除（成功提示由 AssetContext 统一展示，此处不再重复）
  const handleConfirmDelete = useCallback(async () => {
    if (!asset) return;

    try {
      await onDelete(asset.id);
      setDeleteDialogVisible(false);
    } catch (error) {
      // 错误已在Context中处理
    }
  }, [asset, onDelete]);

  // 下载素材
  const handleDownload = useCallback(() => {
    if (asset) {
      onDownload(asset);
      MessagePlugin.success('开始下载');
    }
  }, [asset, onDownload]);

  // 使用到画板
  const handleSelect = useCallback(() => {
    if (asset && onSelect && !selecting) {
      onSelect(asset);
    }
  }, [asset, onSelect, selecting]);

  const handleSelectMultiple = useCallback(async () => {
    if (!onSelectMultiple || selectedAssets.length === 0 || selecting) {
      return;
    }

    await onSelectMultiple(selectedAssets);
  }, [onSelectMultiple, selectedAssets, selecting]);

  // 复制提示词
  const handleCopyPrompt = useCallback(async () => {
    if (asset?.prompt) {
      try {
        await copyToClipboard(asset.prompt);
        MessagePlugin.success('提示词已复制');
      } catch {
        MessagePlugin.error('复制失败');
      }
    }
  }, [asset?.prompt]);

  const handleOpenSubjectDialog = useCallback(() => {
    if (!asset) return;
    setSubjectName(asset.characterMeta?.name || '');
    setSubjectPrompt(asset.characterMeta?.prompt || asset.prompt || '');
    setSubjectDialogVisible(true);
  }, [asset]);

  const handleCloseSubjectDialog = useCallback(() => {
    if (isSavingSubject) return;
    setSubjectDialogVisible(false);
  }, [isSavingSubject]);

  const handleSubmitSubjectDialog = useCallback(async () => {
    if (!asset || !onMarkAsSubject || isSavingSubject) return;
    const trimmedName = subjectName.trim();
    const trimmedPrompt = subjectPrompt.trim();

    if (!trimmedName) {
      MessagePlugin.warning('请先给主体起一个名字');
      return;
    }

    try {
      setIsSavingSubject(true);
      await onMarkAsSubject(asset, {
        name: trimmedName,
        ...(trimmedPrompt && { prompt: trimmedPrompt }),
      });
      setSubjectDialogVisible(false);
    } catch (error) {
      console.error('[MediaLibraryInspector] Failed to mark subject:', error);
      MessagePlugin.error('设置主体失败');
    } finally {
      setIsSavingSubject(false);
    }
  }, [
    asset,
    isSavingSubject,
    onMarkAsSubject,
    subjectName,
    subjectPrompt,
  ]);

  if (isSelectionMode) {
    return (
      <div className="media-library-inspector media-library-inspector--selection">
        <div className="media-library-inspector__selection-card">
          <div className="media-library-inspector__selection-icon">
            <CheckCircle size={22} />
          </div>
          <div className="media-library-inspector__selection-copy">
            <span className="media-library-inspector__selection-kicker">
              批量选择
            </span>
            <h3 className="media-library-inspector__selection-title">
              已选 {selectedAssetCount} 个素材
            </h3>
            <p className="media-library-inspector__selection-desc">
              右侧操作会应用到当前筛选结果中已勾选的素材。
            </p>
          </div>
        </div>

        <div className="media-library-inspector__selection-summary">
          <div className="media-library-inspector__meta-item">
            <span className="media-library-inspector__meta-label">图片</span>
            <span className="media-library-inspector__meta-value">
              {selectedImageCount}
            </span>
          </div>
          <div className="media-library-inspector__meta-item">
            <span className="media-library-inspector__meta-label">视频</span>
            <span className="media-library-inspector__meta-value">
              {selectedVideoCount}
            </span>
          </div>
          <div className="media-library-inspector__meta-item">
            <span className="media-library-inspector__meta-label">音频</span>
            <span className="media-library-inspector__meta-value">
              {selectedAudioCount}
            </span>
          </div>
          <div className="media-library-inspector__meta-item">
            <span className="media-library-inspector__meta-label">总大小</span>
            <span className="media-library-inspector__meta-value">
              {selectedTotalSize > 0 ? formatFileSize(selectedTotalSize) : '-'}
            </span>
          </div>
        </div>

        <div className="media-library-inspector__actions media-library-inspector__actions--batch">
          {showSelectButton && onSelectMultiple && (
            <Button
              theme="primary"
              block
              icon={<CheckCircle size={16} />}
              onClick={() => {
                void handleSelectMultiple();
              }}
              loading={selecting}
              disabled={selecting || selectedAssetCount === 0}
              data-track="inspector_batch_use_assets"
              className="inspector-btn-select"
            >
              {selectButtonText}
              {selectedAssetCount > 0 ? ` (${selectedAssetCount})` : ''}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="media-library-inspector media-library-inspector--empty">
        <p>选择素材查看详情</p>
      </div>
    );
  }

  const displayAssetUrl = asset.filePath
    ? convertLocalFilePathToAssetUrl(asset.filePath)
    : asset.url;
  const normalizedAssetUrl =
    asset.type === 'IMAGE' ? normalizeImageDataUrl(displayAssetUrl) : displayAssetUrl;
  const isSubjectAsset = asset.category === AssetCategory.CHARACTER;
  const showSubjectAction = asset.type === AssetType.IMAGE && !!onMarkAsSubject;

  return (
    <div className="media-library-inspector">
      {/* 预览 */}
      <div className="media-library-inspector__preview">
        {asset.type === 'AUDIO' ? (
          <div className="media-library-inspector__audio-preview">
            {asset.thumbnail && (
              <RetryImage
                src={asset.thumbnail}
                alt={asset.name}
                className="media-library-inspector__audio-cover"
                showSkeleton={false}
                eager
              />
            )}
            <audio
              src={normalizedAssetUrl}
              controls
              className="media-library-inspector__audio"
              onError={() => setPreviewFailed(true)}
            />
          </div>
        ) : asset.type === 'IMAGE' ? (
          <RetryImage
            src={getThumbnailUrl(normalizedAssetUrl, 'large')}
            alt={asset.name}
            className="media-library-inspector__image"
            fallback={
              <RetryImage
                src={normalizedAssetUrl}
                alt={asset.name}
                className="media-library-inspector__image"
                showSkeleton={false}
                eager
                onLoadFailure={() => setPreviewFailed(true)}
                fallback={<div />}
              />
            }
            showSkeleton={false}
            eager
          />
        ) : (
          <VideoPosterPreview
            src={normalizedAssetUrl}
            alt={asset.name}
            className="media-library-inspector__video"
            poster={asset.thumbnail}
            thumbnailSize="large"
            activateVideoOnClick
            playOnActivate
            videoProps={{
              controls: true,
              preload: 'metadata',
              onError: () => setPreviewFailed(true),
            }}
          />
        )}
        {previewFailed && (
          <div className="media-library-inspector__preview-error" role="status">
            <FileWarning size={20} />
            <span>本地素材不可用或文件已损坏</span>
          </div>
        )}
      </div>

      {/* 名称编辑 */}
      <div className="media-library-inspector__name-section">
        {isRenaming ? (
          <div className="media-library-inspector__name-edit">
            <Input
              value={newName}
              onChange={(value) => setNewName(value as string)}
              autofocus
              onBlur={handleConfirmRename}
              {...{onEnter: handleConfirmRename} as any}
              onKeydown={handleKeyDown}
              placeholder="输入名称，按 Enter 或点击外部保存"
            />
          </div>
        ) : (
          <div className="media-library-inspector__name-display">
            <HoverTip content={asset.name} showArrow={false}>
              <h3 className="media-library-inspector__name">{asset.name}</h3>
            </HoverTip>
            <Button
              size="small"
              variant="text"
              icon={<Edit2 size={14} />}
              onClick={handleStartRename}
              data-track="inspector_rename_start"
            />
          </div>
        )}
      </div>

      {/* 元数据 */}
      <div className="media-library-inspector__metadata">
        <div className="media-library-inspector__meta-item">
          <span className="media-library-inspector__meta-label">类型</span>
          <span className="media-library-inspector__meta-value">
            {asset.type === 'IMAGE' ? '图片' : asset.type === 'AUDIO' ? '音频' : '视频'}
          </span>
        </div>
        <div className="media-library-inspector__meta-item">
          <span className="media-library-inspector__meta-label">来源</span>
          <span className="media-library-inspector__meta-value">
            {asset.source === 'AI_GENERATED' ? 'AI生成' : '本地上传'}
          </span>
        </div>
        {isSubjectAsset && (
          <>
            <div className="media-library-inspector__meta-item">
              <span className="media-library-inspector__meta-label">类别</span>
              <span className="media-library-inspector__meta-value">主体</span>
            </div>
            {asset.characterMeta?.name && (
              <div className="media-library-inspector__meta-item">
                <span className="media-library-inspector__meta-label">主体名</span>
                <span className="media-library-inspector__meta-value">
                  {asset.characterMeta.name}
                </span>
              </div>
            )}
          </>
        )}
        <div className="media-library-inspector__meta-item">
          <span className="media-library-inspector__meta-label">创建时间</span>
          <span className="media-library-inspector__meta-value">
            {formatDate(asset.createdAt)}
          </span>
        </div>
        {displaySize && (
          <div className="media-library-inspector__meta-item">
            <span className="media-library-inspector__meta-label">文件大小</span>
            <span className="media-library-inspector__meta-value">
              {formatFileSize(displaySize)}
            </span>
          </div>
        )}
      </div>

      {/* 提示词区域 - 仅 AI 生成的素材显示 */}
      {asset.prompt && (
        <div className="media-library-inspector__prompt-section">
          <div className="media-library-inspector__prompt-header">
            <span className="media-library-inspector__prompt-label">提示词</span>
            <Button
              size="small"
              variant="text"
              icon={<Copy size={12} />}
              onClick={handleCopyPrompt}
              data-track="inspector_copy_prompt"
            >
              复制
            </Button>
          </div>
          <div className="media-library-inspector__prompt-content">
            {asset.prompt}
          </div>
        </div>
      )}

      {asset.characterMeta?.prompt &&
        asset.characterMeta.prompt !== asset.prompt && (
          <div className="media-library-inspector__prompt-section media-library-inspector__prompt-section--compact">
            <div className="media-library-inspector__prompt-header">
              <span className="media-library-inspector__prompt-label">主体提示词</span>
            </div>
            <div className="media-library-inspector__prompt-content">
              {asset.characterMeta.prompt}
            </div>
          </div>
        )}

      {/* 操作按钮 */}
      <div
        className={`media-library-inspector__actions ${
          showSelectButton && onSelect && showSubjectAction
            ? 'media-library-inspector__actions--with-select-subject'
            : showSelectButton && onSelect
            ? 'media-library-inspector__actions--with-select'
            : showSubjectAction
            ? 'media-library-inspector__actions--with-subject'
            : 'media-library-inspector__actions--no-select'
        }`}
      >
        {showSelectButton && onSelect && (
          <Button
            theme="primary"
            block
            icon={<CheckCircle size={16} />}
            onClick={handleSelect}
            loading={selecting}
            disabled={selecting}
            data-track="inspector_use_asset"
            data-track-params={inspectorTrackParams}
            className="inspector-btn-select"
          >
            {selectButtonText}
          </Button>
        )}
        {showSubjectAction && (
          <Button
            variant="outline"
            block
            icon={<UserRound size={16} />}
            onClick={handleOpenSubjectDialog}
            data-track="inspector_mark_subject"
            data-track-params={inspectorTrackParams}
            className="inspector-btn-subject"
          >
            {isSubjectAsset ? '编辑主体' : '设为主体'}
          </Button>
        )}
        <Button
          variant="outline"
          block
          icon={<Download size={16} />}
          onClick={handleDownload}
          data-track="inspector_download"
          data-track-params={inspectorTrackParams}
          className="inspector-btn-download"
        >
          下载
        </Button>
        <Button
          theme="danger"
          variant="outline"
          block
          icon={<Trash2 size={16} />}
          onClick={handleOpenDeleteDialog}
          data-track="inspector_delete"
          data-track-params={inspectorTrackParams}
          className="inspector-btn-delete"
        >
          删除
        </Button>
      </div>

      <Dialog
        visible={subjectDialogVisible}
        header={isSubjectAsset ? '编辑主体信息' : '设为主体'}
        onClose={handleCloseSubjectDialog}
        onConfirm={() => void handleSubmitSubjectDialog()}
        confirmBtn={isSavingSubject ? '保存中...' : '保存'}
        cancelBtn="取消"
      >
        <div className="media-library-inspector__subject-dialog">
          <label className="media-library-inspector__subject-label">
            主体名
            <Input
              value={subjectName}
              onChange={(value) => setSubjectName(String(value))}
              placeholder="例如：Lily / 银色耳机 / 红色跑车"
              autofocus
              disabled={isSavingSubject}
            />
          </label>
          <p className="media-library-inspector__subject-hint">
            主体名用于脚本复用，不会修改素材标题。
          </p>
          <label className="media-library-inspector__subject-label">
            主体提示词
            <textarea
              className="media-library-inspector__subject-textarea"
              value={subjectPrompt}
              onChange={(event) => setSubjectPrompt(event.target.value)}
              placeholder="可选；用于回填脚本中的主体提示词"
              rows={4}
              disabled={isSavingSubject}
            />
          </label>
        </div>
      </Dialog>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteDialogVisible}
        title="确认删除"
        confirmText="删除"
        cancelText="取消"
        danger
        onOpenChange={setDeleteDialogVisible}
        onConfirm={handleConfirmDelete}
      >
        <p>删除后无法恢复，确认删除该素材？</p>
        <p style={{ marginTop: '8px', color: 'var(--td-text-color-secondary)' }}>
          素材名称: <strong>{asset.name}</strong>
        </p>
        {isCacheAsset && canvasElementCount > 0 && (
          <p style={{ marginTop: '8px', color: 'var(--td-error-color)' }}>
            ⚠️ 画布中有 <strong>{canvasElementCount}</strong> 个元素正在使用此素材，删除后这些元素也将被移除！
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
