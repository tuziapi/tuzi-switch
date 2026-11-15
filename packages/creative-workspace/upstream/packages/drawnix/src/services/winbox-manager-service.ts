/**
 * WinBox Window Manager Service
 *
 * 统一管理所有 WinBox 窗口的 z-index 层级。
 * 所有 WinBoxWindow 实例在挂载时注册、卸载时注销，
 * 由 Manager 内部按激活顺序紧凑分配 z-index。
 */

import { Z_INDEX } from '../constants/z-index';

interface WinBoxEntry {
  windowId: string;
  activationOrder: number;
  element: HTMLDivElement | null;
}

const BASE_Z_INDEX = Z_INDEX.DIALOG_AI_IMAGE;

class WinBoxManagerService {
  private static instance: WinBoxManagerService;
  private windows = new Map<string, WinBoxEntry>();
  private counter = 0;

  private constructor() {}

  static getInstance(): WinBoxManagerService {
    if (!WinBoxManagerService.instance) {
      WinBoxManagerService.instance = new WinBoxManagerService();
    }
    return WinBoxManagerService.instance;
  }

  /**
   * 注册窗口，分配最高激活顺序（自动置顶）
   */
  register(windowId: string, element: HTMLDivElement | null): void {
    const existing = this.windows.get(windowId);
    if (existing) {
      // 重新注册（如 keepAlive 窗口恢复显示），更新元素并置顶
      existing.element = element;
      existing.activationOrder = ++this.counter;
    } else {
      this.windows.set(windowId, {
        windowId,
        activationOrder: ++this.counter,
        element,
      });
    }
    this.applyAllZIndexes();
  }

  /**
   * 注销窗口
   */
  unregister(windowId: string): void {
    if (this.windows.delete(windowId)) {
      this.applyAllZIndexes();
    }
  }

  /**
   * 将指定窗口置顶
   */
  bringToFront(windowId: string): void {
    const entry = this.windows.get(windowId);
    if (!entry) return;

    // 已经是最顶层，跳过
    if (this.isTopWindow(windowId)) return;

    entry.activationOrder = ++this.counter;
    this.applyAllZIndexes();
  }

  /**
   * 更新窗口的 DOM 元素引用
   */
  updateElement(windowId: string, element: HTMLDivElement | null): void {
    const entry = this.windows.get(windowId);
    if (!entry) return;
    entry.element = element;
    this.applyZIndex(entry, this.getPositionIndex(windowId));
  }

  /**
   * 获取当前顶层窗口 ID
   */
  getTopWindowId(): string | null {
    let topId: string | null = null;
    let maxOrder = -1;
    this.windows.forEach((entry) => {
      if (entry.activationOrder > maxOrder) {
        maxOrder = entry.activationOrder;
        topId = entry.windowId;
      }
    });
    return topId;
  }

  private isTopWindow(windowId: string): boolean {
    return this.getTopWindowId() === windowId;
  }

  private getPositionIndex(windowId: string): number {
    const sorted = this.getSortedEntries();
    return sorted.findIndex((e) => e.windowId === windowId);
  }

  private getSortedEntries(): WinBoxEntry[] {
    return Array.from(this.windows.values()).sort(
      (a, b) => a.activationOrder - b.activationOrder
    );
  }

  /**
   * 按激活顺序紧凑分配 z-index: BASE+0, BASE+1, BASE+2...
   */
  private applyAllZIndexes(): void {
    const sorted = this.getSortedEntries();
    sorted.forEach((entry, index) => {
      this.applyZIndex(entry, index);
    });
  }

  private applyZIndex(entry: WinBoxEntry, index: number): void {
    if (!entry.element || index < 0) return;
    entry.element.style.setProperty(
      '--aitu-winbox-z-index',
      String(BASE_Z_INDEX + index)
    );
  }
}

export const winboxManagerService = WinBoxManagerService.getInstance();
