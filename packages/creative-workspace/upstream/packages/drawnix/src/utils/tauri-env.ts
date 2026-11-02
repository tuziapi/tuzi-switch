/**
 * Tauri 环境检测工具
 */

/**
 * 检测是否在 Tauri 桌面环境中运行
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TUZI_CREATIVE_NATIVE__;
}
