/**
 * PromptListItem 组件
 *
 * 可复用的提示词列表项组件
 * - 支持置顶/取消置顶
 * - 支持删除
 * - 悬停时显示操作按钮
 * - 支持预设标识
 */

import React from 'react';
import { Pin, PinOff, X, Lightbulb } from 'lucide-react';
import type { PromptPreviewExample } from '../../constants/prompts';
import { HoverTip } from './hover';
import { RetryImage } from '../retry-image';
import './prompt-list-item.scss';

export interface PromptPreviewRequest {
  content: string;
  previewExamples: PromptPreviewExample[];
  initialIndex: number;
}

export type PromptListResultPreview =
  | { kind: 'image'; url: string; title?: string }
  | { kind: 'video'; url: string; posterUrl?: string; title?: string; duration?: number }
  | { kind: 'audio'; url?: string; coverUrl?: string; title?: string; text?: string; duration?: number }
  | { kind: 'text'; text: string; title?: string }
  | { kind: 'error'; text: string }
  | { kind: 'none'; text: string };

export interface PromptListItemProps {
  /** 提示词内容 */
  content: string;
  /** 列表展示标题，不影响 content 回填 */
  title?: string;
  /** 实际发送给生成工具的提示词 */
  sentPrompt?: string;
  /** 轻量标签 */
  tags?: string[];
  /** 生成结果预览 */
  resultPreview?: PromptListResultPreview;
  /** 是否已置顶 */
  pinned?: boolean;
  /** 是否是预设提示词 */
  isPreset?: boolean;
  /** 生成类型：image/video/audio/text/agent/ppt-common/ppt-slide */
  modelType?:
    | 'image'
    | 'video'
    | 'audio'
    | 'text'
    | 'agent'
    | 'ppt-common'
    | 'ppt-slide';
  /** 场景描述（用于显示标签） */
  scene?: string;
  /** 悬浮预览示例图 */
  previewExamples?: PromptPreviewExample[];
  /** 点击提示词的回调 */
  onClick?: () => void;
  /** 置顶/取消置顶的回调 */
  onTogglePin?: () => void;
  /** 删除的回调 */
  onDelete?: () => void;
  /** 点击悬浮示例图进行预览 */
  onPreviewExample?: (request: PromptPreviewRequest) => void;
  /** 语言 */
  language?: 'zh' | 'en';
  /** 是否禁用 */
  disabled?: boolean;
}

// 生成类型对应的标签样式
const MODEL_TYPE_STYLES: Record<string, string> = {
  image: 'prompt-list-item__tag--image',
  video: 'prompt-list-item__tag--video',
  audio: 'prompt-list-item__tag--audio',
  text: 'prompt-list-item__tag--text',
  agent: 'prompt-list-item__tag--agent',
  'ppt-common': 'prompt-list-item__tag--ppt-common',
  'ppt-slide': 'prompt-list-item__tag--ppt-slide',
};

export const PromptListItem: React.FC<PromptListItemProps> = ({
  content,
  title,
  sentPrompt,
  tags,
  resultPreview,
  pinned = false,
  isPreset = false,
  modelType,
  scene,
  previewExamples,
  onClick,
  onTogglePin,
  onDelete,
  onPreviewExample,
  language = 'zh',
  disabled = false,
}) => {
  const handleTogglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin?.();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  const visiblePreviewExamples = previewExamples?.slice(0, 3) ?? [];
  const hasPreviewExamples = visiblePreviewExamples.length > 0;
  const displayTitle = title?.trim() || content;
  const visibleTags = (tags || []).filter(Boolean).slice(0, 4);
  const hasHistoryDetails =
    Boolean(sentPrompt || resultPreview || visibleTags.length > 0) &&
    !hasPreviewExamples;
  const isSinglePreview = visiblePreviewExamples.length === 1;
  const canPreviewExamples = Boolean(onPreviewExample && !disabled);

  const handlePreviewMouseDown =
    (initialIndex: number) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!canPreviewExamples) {
        return;
      }
      onPreviewExample?.({
        content,
        previewExamples: visiblePreviewExamples,
        initialIndex,
      });
    };

  const handlePreviewClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handlePreviewKeyDown =
    (initialIndex: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!canPreviewExamples) {
        return;
      }
      onPreviewExample?.({
        content,
        previewExamples: visiblePreviewExamples,
        initialIndex,
      });
    };

  const container = (
    <div
      className={`prompt-list-item ${
        pinned ? 'prompt-list-item--pinned' : ''
      } ${isPreset ? 'prompt-list-item--preset' : ''} ${
        disabled ? 'prompt-list-item--disabled' : ''
      }`}
      onClick={disabled ? undefined : onClick}
    >
      {/* 置顶标识 */}
      {pinned && (
        <div className="prompt-list-item__pin-badge">
          <Pin size={10} />
        </div>
      )}

      {/* 预设标识 */}
      {isPreset && (
        <div className="prompt-list-item__preset-badge">
          <Lightbulb size={10} />
        </div>
      )}

      {/* 场景标签（使用 scene 显示，modelType 决定样式） */}
      {scene && (
        <span
          className={`prompt-list-item__tag ${
            modelType ? MODEL_TYPE_STYLES[modelType] || '' : ''
          }`}
        >
          {scene}
        </span>
      )}

      {/* 提示词内容 */}
      <span className="prompt-list-item__text">{displayTitle}</span>

      {/* 操作按钮 */}
      <div className="prompt-list-item__actions">
        {/* 置顶/取消置顶按钮 */}
        {onTogglePin && (
          <HoverTip
            content={
              pinned
                ? language === 'zh'
                  ? '取消置顶'
                  : 'Unpin'
                : language === 'zh'
                ? '置顶'
                : 'Pin'
            }
          >
            <button
              type="button"
              className="prompt-list-item__action"
              onClick={handleTogglePin}
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          </HoverTip>
        )}

        {/* 删除按钮 */}
        {onDelete && (
          <HoverTip content={language === 'zh' ? '删除' : 'Delete'}>
            <button
              type="button"
              className="prompt-list-item__action prompt-list-item__action--delete"
              onClick={handleDelete}
            >
              <X size={14} />
            </button>
          </HoverTip>
        )}
      </div>
    </div>
  );

  const previewContent = hasPreviewExamples ? (
    <div className="prompt-list-item__hover-card">
      <div className="prompt-list-item__hover-text">{content}</div>
      <div
        className={`prompt-list-item__hover-gallery ${
          isSinglePreview ? 'prompt-list-item__hover-gallery--single' : ''
        }`}
      >
        {visiblePreviewExamples.map((example, index) => (
          <div
            key={`${example.src}-${example.alt}`}
            className={`prompt-list-item__hover-thumb ${
              isSinglePreview ? 'prompt-list-item__hover-thumb--single' : ''
            }`}
          >
            {canPreviewExamples ? (
              <button
                type="button"
                className="prompt-list-item__hover-thumb-button"
                aria-label={`${
                  language === 'zh' ? '预览示例图' : 'Preview example'
                } ${index + 1}`}
                onMouseDown={handlePreviewMouseDown(index)}
                onClick={handlePreviewClick}
                onKeyDown={handlePreviewKeyDown(index)}
              >
                <RetryImage
                  src={
                    example.kind === 'video'
                      ? example.posterSrc || example.src
                      : example.src
                  }
                  alt={example.alt}
                  showSkeleton={false}
                />
              </button>
            ) : (
              <RetryImage
                src={
                  example.kind === 'video'
                    ? example.posterSrc || example.src
                    : example.src
                }
                alt={example.alt}
                showSkeleton={false}
              />
            )}
          </div>
        ))}
      </div>
      {canPreviewExamples && (
        <div className="prompt-list-item__hover-hint">
          {language === 'zh' ? '点击预览' : 'Click to preview'}
        </div>
      )}
    </div>
  ) : null;

  const resultPreviewContent = resultPreview ? (
    <div className="prompt-list-item__result-preview">
      {(resultPreview.kind === 'image' || resultPreview.kind === 'video') && (
        <div className="prompt-list-item__result-media">
          <RetryImage
            src={
              resultPreview.kind === 'video'
                ? resultPreview.posterUrl || resultPreview.url
                : resultPreview.url
            }
            alt={resultPreview.title || displayTitle}
            showSkeleton={false}
          />
        </div>
      )}
      {resultPreview.kind === 'audio' && (
        <div className="prompt-list-item__result-audio">
          {resultPreview.coverUrl && (
            <RetryImage
              src={resultPreview.coverUrl}
              alt={resultPreview.title || displayTitle}
              showSkeleton={false}
            />
          )}
          <div>
            <div className="prompt-list-item__result-title">
              {resultPreview.title || '音频结果'}
            </div>
            {resultPreview.text && (
              <div className="prompt-list-item__result-text">
                {resultPreview.text}
              </div>
            )}
          </div>
        </div>
      )}
      {(resultPreview.kind === 'text' ||
        resultPreview.kind === 'error' ||
        resultPreview.kind === 'none') && (
        <div
          className={`prompt-list-item__result-text ${
            resultPreview.kind === 'error'
              ? 'prompt-list-item__result-text--error'
              : ''
          }`}
        >
          {resultPreview.kind === 'text' && resultPreview.title && (
            <strong>{resultPreview.title}</strong>
          )}
          {resultPreview.text}
        </div>
      )}
    </div>
  ) : null;

  const historyContent = hasHistoryDetails ? (
    <div className="prompt-list-item__history-card">
      <div className="prompt-list-item__history-title">{displayTitle}</div>
      {sentPrompt && (
        <div className="prompt-list-item__history-section">
          <div className="prompt-list-item__history-label">发送提示词</div>
          <div className="prompt-list-item__history-text">{sentPrompt}</div>
        </div>
      )}
      {visibleTags.length > 0 && (
        <div className="prompt-list-item__history-tags">
          {visibleTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
      {resultPreviewContent && (
        <div className="prompt-list-item__history-section">
          <div className="prompt-list-item__history-label">结果预览</div>
          {resultPreviewContent}
        </div>
      )}
    </div>
  ) : null;

  if (previewContent) {
    return (
      <HoverTip
        content={previewContent}
        placement="right"
        delay={40}
        overlayClassName="prompt-list-item__hover-card-popover"
      >
        {container}
      </HoverTip>
    );
  }

  if (historyContent) {
    return (
      <HoverTip
        content={historyContent}
        placement="right"
        delay={60}
        overlayClassName="prompt-list-item__history-card-popover"
      >
        {container}
      </HoverTip>
    );
  }

  return (
    <HoverTip
      content={displayTitle === content ? content : `${displayTitle}\n\n${content}`}
      placement="right-top"
      delay={80}
      overlayClassName="prompt-list-item__text-tip-popover"
      overlayInnerClassName="prompt-list-item__text-tip"
    >
      {container}
    </HoverTip>
  );
};

export default PromptListItem;
