/**
 * InspirationBoard Component
 *
 * 灵感创意板块主组件，当画板为空时显示创意模版
 */

import React, { useState, useCallback, useEffect } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'tdesign-icons-react';
import { ArrowLeft, Lightbulb, MousePointerClick, Send, X } from 'lucide-react';
import { MessagePlugin } from 'tdesign-react';
import { InspirationCard } from './InspirationCard';
import {
  CATEGORY_COLORS,
  INSPIRATION_TEMPLATES,
  ITEMS_PER_PAGE,
} from './constants';
import type { InspirationBoardProps, InspirationTemplate } from './types';
import { HoverTip } from '../shared/hover';
import './inspiration-board.scss';

const HIDE_INSPIRATION_KEY = 'aitu_hide_inspiration_board';
type InspirationBoardView = 'board' | 'guide';

export const InspirationBoard: React.FC<InspirationBoardProps> = ({
  isCanvasEmpty,
  onSelectPrompt,
  onOpenPromptTool,
  visible = true,
  className = '',
}) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [isHidden, setIsHidden] = useState(false);
  const [viewMode, setViewMode] = useState<InspirationBoardView>('board');
  const [selectedTemplate, setSelectedTemplate] =
    useState<InspirationTemplate | null>(null);

  // 组件加载时从 localStorage 读取用户设置
  useEffect(() => {
    const hidePreference = localStorage.getItem(HIDE_INSPIRATION_KEY);
    if (hidePreference === 'true') {
      setIsHidden(true);
    }
  }, []);

  // 计算总页数
  const totalPages = Math.ceil(INSPIRATION_TEMPLATES.length / ITEMS_PER_PAGE);
  const hasMultiplePages = totalPages > 1;

  // 获取当前页的模版
  const currentTemplates = INSPIRATION_TEMPLATES.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  // 切换到上一页
  const handlePrev = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCurrentPage((prev) => (prev - 1 + totalPages) % totalPages);
    },
    [totalPages]
  );

  // 切换到下一页
  const handleNext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCurrentPage((prev) => (prev + 1) % totalPages);
    },
    [totalPages]
  );

  // 选择模版（灵感创意的模版都是 agent 类型）
  const handleSelectTemplate = useCallback(
    (template: InspirationTemplate) => {
      setSelectedTemplate(template);
      setViewMode('guide');
      onSelectPrompt({
        prompt: template.prompt,
        modelType: 'agent',
        skillId: template.skillId,
        templateId: template.id,
        title: template.title,
        category: template.category,
      });
    },
    [onSelectPrompt]
  );

  const handleBackToBoard = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setViewMode('board');
  }, []);

  // 处理"不再提示"按钮点击
  const handleHide = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setViewMode('board');
    setSelectedTemplate(null);
    setIsHidden(true);
    localStorage.setItem(HIDE_INSPIRATION_KEY, 'true');
  }, []);

  const handleGuidePreviewClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    MessagePlugin.info('请点击右下角真正的发送按钮开始生成');
  }, []);

  // 不显示的条件：画板不为空 或 外部控制隐藏 或 用户选择不再提示
  if (!isCanvasEmpty || !visible || isHidden) {
    return null;
  }

  const isGuideView = viewMode === 'guide' && selectedTemplate;
  const selectedTemplateColors = selectedTemplate
    ? CATEGORY_COLORS[selectedTemplate.category]
    : null;

  return (
    <div
      className={`inspiration-board ${
        isGuideView ? 'inspiration-board--guide' : ''
      } ${className}`}
      data-testid="inspiration-board"
    >
      {/* 头部：标题 + 提示词按钮 + 切换按钮 */}
      <div className="inspiration-board__header">
        {isGuideView ? (
          <div className="inspiration-board__guide-title-group">
            <button
              className="inspiration-board__back-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleBackToBoard}
              aria-label="返回灵感创意"
              data-testid="inspiration-guide-back"
              data-track="inspiration_click_guide_back"
            >
              <ArrowLeft size={15} />
              <span>返回</span>
            </button>
            <h3 className="inspiration-board__title">确认后发送</h3>
          </div>
        ) : (
          <h3 className="inspiration-board__title">灵感创意</h3>
        )}

        {/* 不再提示按钮 */}
        <HoverTip content="不再提示" showArrow={false}>
          <button
            className="inspiration-board__hide-btn"
            onClick={handleHide}
            onMouseDown={(e) => e.preventDefault()}
            data-track="inspiration_click_hide"
          >
            <X size={14} />
            <span>不再提示</span>
          </button>
        </HoverTip>

        {/* 提示词工具按钮 */}
        {!isGuideView && onOpenPromptTool && (
          <HoverTip content="提示词工具" showArrow={false}>
            <button
              className="inspiration-board__prompt-btn"
              onClick={onOpenPromptTool}
              onMouseDown={(e) => e.preventDefault()}
              data-track="inspiration_click_prompt_tool"
            >
              <Lightbulb size={14} />
              <span>提示词</span>
            </button>
          </HoverTip>
        )}

        {!isGuideView && hasMultiplePages && (
          <div className="inspiration-board__pagination">
            <span className="inspiration-board__page-indicator">
              {currentPage + 1} / {totalPages}
            </span>
            <div className="inspiration-board__nav-buttons">
              <button
                className="inspiration-board__nav-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handlePrev}
                aria-label="上一页"
                data-track="inspiration_click_prev"
              >
                <ChevronLeftIcon size={16} />
              </button>
              <button
                className="inspiration-board__nav-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleNext}
                aria-label="下一页"
                data-track="inspiration_click_next"
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {isGuideView ? (
        <div
          className="inspiration-board__guide"
          data-testid="inspiration-send-guide"
        >
          <div className="inspiration-board__guide-main">
            <div className="inspiration-board__guide-summary">
              <img
                src={selectedTemplate.imageUrl}
                alt={selectedTemplate.title}
                className="inspiration-board__guide-image"
                loading="lazy"
              />
              <div className="inspiration-board__guide-content">
                {selectedTemplateColors && (
                  <span
                    className="inspiration-board__guide-badge"
                    style={{
                      backgroundColor: selectedTemplateColors.bg,
                      color: selectedTemplateColors.text,
                    }}
                  >
                    {selectedTemplate.category}
                  </span>
                )}
                <h4 className="inspiration-board__guide-name">
                  {selectedTemplate.title}
                </h4>
                <p className="inspiration-board__guide-description">
                  {selectedTemplate.description}
                </p>
              </div>
            </div>

            <div className="inspiration-board__guide-action">
              <div className="inspiration-board__guide-cue">
                <MousePointerClick
                  className="inspiration-board__guide-pointer"
                  size={26}
                  aria-hidden="true"
                />
                <HoverTip content="请点击右下角真正的发送按钮" showArrow={false}>
                  <button
                    type="button"
                    className="inspiration-board__guide-send-preview"
                    onClick={handleGuidePreviewClick}
                    onMouseDown={(e) => e.preventDefault()}
                    aria-label="示意发送按钮"
                  >
                    <Send size={17} />
                  </button>
                </HoverTip>
              </div>

              <div className="inspiration-board__guide-tip">
                <Send size={16} />
                <span>下一步：点击发送按钮开始生成</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="inspiration-board__grid">
          {currentTemplates.map((template) => (
            <InspirationCard
              key={template.id}
              template={template}
              onClick={() => handleSelectTemplate(template)}
            />
          ))}

          {/* 占位元素，保持网格对齐 */}
          {currentTemplates.length < ITEMS_PER_PAGE &&
            Array.from({
              length: ITEMS_PER_PAGE - currentTemplates.length,
            }).map((_, i) => (
              <div
                key={`placeholder-${i}`}
                className="inspiration-card inspiration-card--placeholder"
              />
            ))}
        </div>
      )}
    </div>
  );
};

export default InspirationBoard;
