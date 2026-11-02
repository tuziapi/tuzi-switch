/**
 * 用户消息气泡组件
 * 
 * 支持显示用户输入的文本和图片
 * 支持文本选择和复制（不会取消画布选中态）
 */

import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { copyToClipboard } from '../../utils/runtime-helpers';
import type { Message } from '../../types/chat-ui.types';
import { ServiceIcon, LayersIcon, ImageIcon, BulletpointIcon } from 'tdesign-icons-react';
import type { MediaItem as UnifiedMediaItem } from '../shared/media-preview';
import './user-message-bubble.scss';

interface UserMessageBubbleProps {
  message: Message;
  className?: string;
  onPreviewImages?: (
    items: UnifiedMediaItem[],
    initialIndex: number
  ) => void;
}

interface ImageData {
  url: string;
  filename: string;
}

interface MetaItem {
  label: string;
  icon: React.ReactNode;
}

export const UserMessageBubble: React.FC<UserMessageBubbleProps> = ({
  message,
  className = '',
  onPreviewImages,
}) => {
  const textRef = useRef<HTMLDivElement>(null);

  // 解析消息内容
  const { text, meta, images } = useMemo(() => {
    let textContent = '';
    const imageList: ImageData[] = [];

    for (const part of message.parts) {
      if (part.type === 'text') {
        textContent += (part as { type: 'text'; text: string }).text;
      } else if (part.type === 'data-file') {
        const data = (part as any).data;
        if (data?.mediaType?.startsWith('image/') || data?.url?.startsWith('data:image/')) {
          imageList.push({
            url: data.url,
            filename: data.filename || 'image',
          });
        }
      }
    }

    // 1. 优先使用消息中存储的 aiContext（结构化数据）
    const chatMessage = message as any;
    if (chatMessage.aiContext) {
      const context = chatMessage.aiContext;
      const metaItems: MetaItem[] = [];
      
      // 提取模型信息
      if (context.model?.id) {
        metaItems.push({ label: context.model.id, icon: <ServiceIcon size="12px" /> });
      }
      
      // 提取数量信息
      if (context.params?.count > 1) {
        metaItems.push({ label: `${context.params.count} 张`, icon: <ImageIcon size="12px" /> });
      }
      
      // 提取其他关键参数
      if (context.params?.size) {
        metaItems.push({ label: context.params.size, icon: <LayersIcon size="12px" /> });
      }

      // 如果有选中的文本
      if (context.selection?.texts?.length > 0) {
        metaItems.push({ label: `${context.selection.texts.length} 段文本`, icon: <BulletpointIcon size="12px" /> });
      }

      return {
        text: context.userInstruction || context.finalPrompt || textContent,
        meta: metaItems,
        images: imageList
      };
    }

    // 2. 兜底方案：解析文本内容（兼容历史数据）
    let mainText = textContent;
    const metaItems: MetaItem[] = [];

    // 尝试匹配新格式的分隔符
    if (mainText.includes('\n---\n')) {
      const parts = mainText.split('\n---\n');
      mainText = parts[0];
      const metaContent = parts[1];
      metaContent.split('  •  ').forEach(t => {
        const label = t.replace(/模型:\s*/, '').replace(/数量:\s*/, '').replace(/尺寸:\s*/, '').trim();
        if (label) {
          let icon = <ServiceIcon size="12px" />;
          if (t.includes('数量')) icon = <ImageIcon size="12px" />;
          if (t.includes('尺寸')) icon = <LayersIcon size="12px" />;
          metaItems.push({ label, icon });
        }
      });
    } else {
      // 兼容旧格式：按行解析并提取关键词
      const lines = mainText.split('\n');
      const remainingLines: string[] = [];

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('模型:') || trimmedLine.startsWith('数量:') || trimmedLine.startsWith('提示词:')) {
          const label = trimmedLine.replace(/.*:\s*/, '').trim();
          let icon = <ServiceIcon size="12px" />;
          if (trimmedLine.includes('数量')) icon = <ImageIcon size="12px" />;
          metaItems.push({ label, icon });
        } else if (trimmedLine.startsWith('📝 选中的文本:')) {
          metaItems.push({ label: trimmedLine.replace('📝 ', '').trim(), icon: <BulletpointIcon size="12px" /> });
        } else if (trimmedLine && !trimmedLine.startsWith('💬 用户指令:')) {
          remainingLines.push(line);
        }
      }
      mainText = remainingLines.join('\n').trim();
    }

    // 如果清洗后 mainText 为空，但有 metaItems，说明可能是纯指令（如只有 #模型）
    if (!mainText && metaItems.length > 0) {
      const match = textContent.match(/💬 用户指令:\s*([\s\S]*?)(?=\n模型:|\n数量:|$)/);
      if (match && match[1].trim()) {
        mainText = match[1].trim();
      }
    }

    return { 
      text: mainText || textContent, 
      meta: metaItems,
      images: imageList 
    };
  }, [message.parts, (message as any).aiContext]);

  // 阻止事件冒泡，防止取消画布选中态
  const handleStopPropagation = useCallback((e: Event) => {
    e.stopPropagation();
  }, []);

  // 处理复制快捷键
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isCopyShortcut = (e.ctrlKey || e.metaKey) && e.key === 'c';
    if (isCopyShortcut) {
      const selection = window.getSelection();
      const selectedText = selection?.toString();
      if (selectedText) {
        copyToClipboard(selectedText).catch(err => {
          console.error('Failed to copy text:', err);
        });
        e.stopPropagation();
      }
    }
  }, []);

  // 添加事件监听器
  useEffect(() => {
    const element = textRef.current;
    if (!element) return;

    element.addEventListener('pointerdown', handleStopPropagation);
    element.addEventListener('pointerup', handleStopPropagation);
    element.addEventListener('mousedown', handleStopPropagation);
    element.addEventListener('mouseup', handleStopPropagation);
    element.addEventListener('click', handleStopPropagation);
    element.addEventListener('keydown', handleKeyDown as EventListener);

    return () => {
      element.removeEventListener('pointerdown', handleStopPropagation);
      element.removeEventListener('pointerup', handleStopPropagation);
      element.removeEventListener('mousedown', handleStopPropagation);
      element.removeEventListener('mouseup', handleStopPropagation);
      element.removeEventListener('click', handleStopPropagation);
      element.removeEventListener('keydown', handleKeyDown as EventListener);
    };
  }, [handleStopPropagation, handleKeyDown]);

  // 判断是否为纯文字消息（无图片、无元数据）
  const isTextOnly = images.length === 0 && (!meta || meta.length === 0);
  const previewItems: UnifiedMediaItem[] = useMemo(
    () =>
      images.map((img, index) => ({
        id: `${message.id || 'user'}-image-${index}`,
        url: img.url,
        type: 'image',
        alt: img.filename,
      })),
    [images, message.id]
  );

  const handleImageClick = useCallback((index: number, event?: React.MouseEvent) => {
    event?.stopPropagation();
    onPreviewImages?.(previewItems, index);
  }, [onPreviewImages, previewItems]);

  return (
    <>
      <div className={`user-bubble chat-message chat-message--user ${isTextOnly ? 'user-bubble--text-only' : ''} ${className}`}>
        <div className="chat-message-avatar">
          <span>👤</span>
        </div>
        <div className="user-bubble__content chat-message-content">
          {/* 图片网格 */}
          {images.length > 0 && (
            <div className={`user-bubble__images user-bubble__images--${Math.min(images.length, 4)}`}>
              {images.map((img, index) => (
                <div
                  key={index}
                  className="user-bubble__image-wrapper"
                  onClick={(event) => handleImageClick(index, event)}
                >
                  <img
                    src={img.url}
                    alt={img.filename}
                    className="user-bubble__image"
                    loading="lazy"
                    draggable={false}
                  />
                </div>
              ))}
            </div>
          )}

          {/* 文本内容 - 仅展示清洗后的用户输入 */}
          {text && (
            <div
              ref={textRef}
              className="user-bubble__text user-bubble__text--selectable"
            >
              {text}
            </div>
          )}

          {/* 元数据标签 - 独立节点展示 */}
          {meta && meta.length > 0 && (
            <div className="user-bubble__meta-tags">
              {meta.map((item, index) => (
                <div key={index} className="user-bubble__meta-tag">
                  <span className="user-bubble__meta-icon">{item.icon}</span>
                  <span className="user-bubble__meta-label">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default UserMessageBubble;
