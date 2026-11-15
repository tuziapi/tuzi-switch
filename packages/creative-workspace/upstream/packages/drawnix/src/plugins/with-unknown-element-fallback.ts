import { CommonElementFlavour } from '@plait/common';
import { PlaitBoard, PlaitPlugin, PlaitPluginElementContext } from '@plait/core';

/**
 * 空壳组件：不渲染任何内容，不响应交互
 * 元素数据保留在 board.children 中，升级到支持该类型的版本后可正常渲染
 */
class UnknownElementComponent extends CommonElementFlavour {
  initialize(): void {
    super.initialize();
  }
}

/**
 * 容错插件：捕获 drawElement 链中未识别的元素类型，返回空壳组件避免崩溃。
 * 必须放在插件数组最后一个（最先被调用），包裹整条插件链。
 */
export const withUnknownElementFallback: PlaitPlugin = (board: PlaitBoard) => {
  const { drawElement } = board;

  board.drawElement = (context: PlaitPluginElementContext) => {
    try {
      return drawElement(context);
    } catch {
      console.warn(
        `[Drawnix] Unknown element type "${context.element.type}" — may be from a newer version, hidden but preserved.`
      );
      return UnknownElementComponent;
    }
  };

  return board;
};
