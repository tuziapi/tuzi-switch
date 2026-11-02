import { PlaitBoard, Point, Transforms } from '@plait/core';
import { PlaitTool } from '../../types/toolbox.types';

export function isToolElement(element: any): element is PlaitTool {
  return element && element.type === 'tool';
}

function generateId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export const ToolTransforms = {
  insertTool(
    board: PlaitBoard,
    toolId: string,
    url: string | undefined,
    position: Point,
    size: { width: number; height: number },
    metadata?: PlaitTool['metadata']
  ): PlaitTool {
    if (!position || position.length !== 2) {
      console.error('Invalid position:', position);
      position = [0, 0];
    }
    if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') {
      console.error('Invalid size:', size);
      size = { width: 400, height: 300 };
    }

    const toolElement: PlaitTool = {
      id: generateId(),
      type: 'tool',
      toolId,
      url: url as any,
      component: metadata?.component as any,
      points: [
        position,
        [position[0] + size.width, position[1] + size.height],
      ],
      angle: 0,
      metadata,
    } as any;

    Transforms.insertNode(board, toolElement, [board.children.length]);
    return toolElement;
  },

  resizeTool(
    board: PlaitBoard,
    element: PlaitTool,
    newSize: { width: number; height: number }
  ): void {
    const [start] = element.points;
    const newElement: Partial<PlaitTool> = {
      points: [start, [start[0] + newSize.width, start[1] + newSize.height]],
    };

    const path = board.children.findIndex((el: any) => el.id === element.id);
    if (path >= 0) {
      Transforms.setNode(board, newElement, [path]);
    }
  },

  moveTool(board: PlaitBoard, element: PlaitTool, newPosition: Point): void {
    const [start, end] = element.points;
    const width = Math.abs(end[0] - start[0]);
    const height = Math.abs(end[1] - start[1]);

    const newElement: Partial<PlaitTool> = {
      points: [
        newPosition,
        [newPosition[0] + width, newPosition[1] + height],
      ],
    };

    const path = board.children.findIndex((el: any) => el.id === element.id);
    if (path >= 0) {
      Transforms.setNode(board, newElement, [path]);
    }
  },

  rotateTool(board: PlaitBoard, element: PlaitTool, angle: number): void {
    const newElement: Partial<PlaitTool> = {
      angle,
    };

    const path = board.children.findIndex((el: any) => el.id === element.id);
    if (path >= 0) {
      Transforms.setNode(board, newElement, [path]);
    }
  },

  removeTool(board: PlaitBoard, elementId: string): void {
    const path = board.children.findIndex((el: any) => el.id === elementId);
    if (path >= 0) {
      Transforms.removeNode(board, [path]);
    }
  },

  updateToolUrl(board: PlaitBoard, elementId: string, newUrl: string): void {
    const path = board.children.findIndex((el: any) => el.id === elementId);
    if (path >= 0) {
      Transforms.setNode(board, { url: newUrl } as Partial<PlaitTool>, [path]);
    }
  },

  updateToolMetadata(
    board: PlaitBoard,
    elementId: string,
    metadata: Partial<PlaitTool['metadata']>
  ): void {
    const element = board.children.find((el: any) => el.id === elementId) as PlaitTool;
    if (element && element.type === 'tool') {
      const newMetadata = {
        ...element.metadata,
        ...metadata,
      };

      const path = board.children.findIndex((el: any) => el.id === elementId);
      if (path >= 0) {
        Transforms.setNode(
          board,
          { metadata: newMetadata } as Partial<PlaitTool>,
          [path]
        );
      }
    }
  },

  getAllTools(board: PlaitBoard): PlaitTool[] {
    return board.children.filter((el: any) => el.type === 'tool') as PlaitTool[];
  },

  getToolById(board: PlaitBoard, elementId: string): PlaitTool | null {
    const element = board.children.find((el: any) => el.id === elementId);
    return element && isToolElement(element) ? element : null;
  },
};
