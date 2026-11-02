import { ToolCategory } from '../types/toolbox.types';

export const DEFAULT_TOOL_CONFIG = {
  /** 默认宽度（画布单位） */
  defaultWidth: 600,

  /** 默认高度（画布单位） */
  defaultHeight: 400,

  /** 默认 iframe 权限 */
  defaultPermissions: [
    'allow-scripts',
    'allow-same-origin',
    'allow-popups',
    'allow-forms',
    'allow-top-navigation-by-user-activation',
  ] as string[],
};

export const TOOL_CATEGORY_LABELS: Record<string, string> = {
  [ToolCategory.AI_TOOLS]: 'AI 工具',
  [ToolCategory.CONTENT_TOOLS]: '内容工具',
  [ToolCategory.UTILITIES]: '实用工具',
  [ToolCategory.CUSTOM]: '自定义工具',
};

export const TOOL_CATEGORY_ORDER = [
  ToolCategory.AI_TOOLS,
  ToolCategory.CONTENT_TOOLS,
  ToolCategory.UTILITIES,
  ToolCategory.CUSTOM,
] as const;

export function getToolCategoryOrder(category?: string): number {
  const index = TOOL_CATEGORY_ORDER.findIndex((item) => item === category);
  return index >= 0 ? index : TOOL_CATEGORY_ORDER.length;
}

export function sortToolCategories(categories: string[]): string[] {
  return [...categories].sort((left, right) => {
    const orderDiff = getToolCategoryOrder(left) - getToolCategoryOrder(right);
    return orderDiff || left.localeCompare(right);
  });
}
