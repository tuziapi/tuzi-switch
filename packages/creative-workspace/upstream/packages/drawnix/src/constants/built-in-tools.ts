import {
  DEFAULT_TOOL_CONFIG,
  TOOL_CATEGORY_LABELS,
  TOOL_CATEGORY_ORDER,
  getToolCategoryOrder,
  sortToolCategories,
} from './toolbox-shared';

export const BUILT_IN_TOOL_IDS = new Set([
  'comic-creator',
  'video-analyzer',
  'mv-creator',
  'batch-image',
  'music-analyzer',
  'chat-mj',
  'model-benchmark',
  'prompt-history',
  'banana-prompt',
  'pose-library',
  'knowledge-base',
  'music-player',
]);

export function isBuiltInToolId(toolId: string): boolean {
  return BUILT_IN_TOOL_IDS.has(toolId);
}

/**
 * 默认工具配置
 */
export {
  DEFAULT_TOOL_CONFIG,
  TOOL_CATEGORY_LABELS,
  TOOL_CATEGORY_ORDER,
  getToolCategoryOrder,
  sortToolCategories,
} from './toolbox-shared';
