/**
 * ToolItem Component
 *
 * 单个工具项组件 - 展示工具信息和图标
 */

import React, { useCallback, useMemo } from 'react';
import { Button } from 'tdesign-react';
import { JumpIcon, DeleteIcon } from 'tdesign-icons-react';
import { InsertToCanvasIcon } from '../icons';
import { ToolDefinition } from '../../types/toolbox.types';
import { toolRegistry } from '../../tools/registry';
import { isAssistantExternalTool } from '../../services/assistant-account';
import { HoverTip } from '../shared';

export interface ToolItemProps {
  /** 工具定义 */
  tool: ToolDefinition;
  /** 插入到画布回调 */
  onInsert?: (tool: ToolDefinition) => void;
  /** 在窗口中打开回调 */
  onOpenWindow?: (tool: ToolDefinition) => void;
  /** 删除回调（仅自定义工具） */
  onDelete?: (tool: ToolDefinition) => void;
}

/**
 * 渲染图标组件，支持字符串和 React 组件
 */
const renderIcon = (icon: any) => {
  if (!icon) return '🔧';
  if (typeof icon === 'function') {
    const IconComponent = icon;
    return <IconComponent />;
  }
  return icon;
};

/**
 * 工具项组件
 */
export const ToolItem: React.FC<ToolItemProps> = ({
  tool,
  onInsert,
  onOpenWindow,
  onDelete,
}) => {
  // 判断是否为内置工具（内置工具不能编辑/删除）
  const isBuiltInTool = toolRegistry.isBuiltInTool(tool.id);
  const isCustomTool = !isBuiltInTool;
  const baseTrackParams = useMemo(
    () => ({
      area: 'toolbox',
      control: 'tool_item',
      source: 'toolbox_drawer',
      toolId: tool.id,
      tool_id: tool.id,
      toolName: tool.name,
      tool_name: tool.name,
      category: tool.category,
      isCustomTool,
      is_custom_tool: isCustomTool,
    }),
    [isCustomTool, tool.category, tool.id, tool.name]
  );
  const cardTrackParams = useMemo(
    () =>
      JSON.stringify({
        ...baseTrackParams,
        action: 'card_click',
        usageType: 'window',
        usage_type: 'window',
      }),
    [baseTrackParams]
  );
  const insertTrackParams = useMemo(
    () =>
      JSON.stringify({
        ...baseTrackParams,
        action: 'insert_click',
        usageType: 'insert',
        usage_type: 'insert',
      }),
    [baseTrackParams]
  );
  const openWindowTrackParams = useMemo(
    () =>
      JSON.stringify({
        ...baseTrackParams,
        action: 'open_window_click',
        usageType: 'window',
        usage_type: 'window',
      }),
    [baseTrackParams]
  );
  const deleteTrackParams = useMemo(
    () =>
      JSON.stringify({
        ...baseTrackParams,
        action: 'delete_click',
      }),
    [baseTrackParams]
  );

  /**
   * 处理删除按钮点击
   */
  const handleDelete = useCallback(() => {
    onDelete?.(tool);
  }, [tool, onDelete]);

  /**
   * 处理插入到画布按钮点击
   */
  const handleInsert = useCallback(() => {
    onInsert?.(tool);
  }, [tool, onInsert]);

  /**
   * 处理在窗口中打开按钮点击
   */
  const handleOpenWindow = useCallback(() => {
    onOpenWindow?.(tool);
  }, [tool, onOpenWindow]);

  /**
   * 点击卡片整体，默认以弹窗方式打开
   */
  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      // 如果点击的是操作按钮区域，不触发卡片点击
      if ((e.target as HTMLElement).closest('.tool-item__actions')) return;
      onOpenWindow?.(tool);
    },
    [tool, onOpenWindow]
  );

  return (
    <div
      className="tool-item"
      data-track="toolbox_click_tool"
      data-track-params={cardTrackParams}
      data-tool-id={tool.id}
      onClick={handleCardClick}
    >
      <div className="tool-item__icon">{renderIcon(tool.icon)}</div>
      <div className="tool-item__content">
        <div className="tool-item__name">{tool.name}</div>
        {tool.description && (
          <div className="tool-item__description">{tool.description}</div>
        )}
      </div>

      {/* 操作按钮 - 始终显示 */}
      <div className="tool-item__actions">
        {isCustomTool && onDelete && (
          <HoverTip content="删除工具" placement="left">
            <Button
              variant="text"
              size="small"
              shape="square"
              icon={<DeleteIcon />}
              onClick={handleDelete}
              className="tool-item__action-btn tool-item__action-btn--delete"
              data-track="toolbox_click_delete_tool"
              data-track-params={deleteTrackParams}
            />
          </HoverTip>
        )}
        {!isAssistantExternalTool(tool.id) && <HoverTip content="插入到画布" placement="left">
          <Button
            variant="text"
            size="small"
            shape="square"
            icon={<InsertToCanvasIcon size={16} />}
            onClick={handleInsert}
            className="tool-item__action-btn tool-item__action-btn--insert"
            data-track="toolbox_click_insert_tool"
            data-track-params={insertTrackParams}
          />
        </HoverTip>}
        <HoverTip content={isAssistantExternalTool(tool.id) ? "在系统浏览器打开" : "在窗口中打开"} placement="left">
          <Button
            variant="outline"
            size="small"
            shape="square"
            icon={<JumpIcon />}
            onClick={handleOpenWindow}
            className="tool-item__action-btn tool-item__action-btn--open-window"
            aria-label={isAssistantExternalTool(tool.id) ? `在系统浏览器打开${tool.name}` : `在窗口中打开${tool.name}`}
            data-track="toolbox_click_open_window_tool"
            data-track-params={openWindowTrackParams}
          />
        </HoverTip>
      </div>
    </div>
  );
};
