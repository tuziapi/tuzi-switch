import { PlaitBoard, type Point } from "@plait/core";
import { parseSizeToPixels } from "./size-ratio";
import { resolveImageLineagePositions } from "./image-generation-lineage-placement";
import { resolveImageGenerationBatchAnchorPositions } from "./image-generation-anchor-placement";
import {
  reserveImageBatch,
  type BatchReservation,
} from "./image-batch-reservations";

// Preparation is visual only: never save speculative tasks or React roots to the board.
export function createImageBatchPreparation(
  board: PlaitBoard,
  options: {
    count: number;
    requestedSize?: string;
    sourceIds: string[];
    emptyPosition: Point;
    frameRect?: BatchReservation;
    hasUnplacedReferences?: boolean;
  },
) {
  const size = parseSizeToPixels(options.requestedSize);
  const reservedSize = {
    width: Math.max(400, size.width),
    height: Math.max(600, size.height),
  };
  const origin: Point =
    options.hasUnplacedReferences && !options.sourceIds.length
      ? [options.emptyPosition[0] + 520, options.emptyPosition[1]]
      : options.emptyPosition;
  const positions = options.frameRect
    ? resolveImageGenerationBatchAnchorPositions(
        board,
        origin,
        reservedSize,
        options.count,
        { frameRect: options.frameRect },
      )
    : resolveImageLineagePositions(
        board,
        options.sourceIds,
        reservedSize,
        options.count,
        origin,
        "grid",
      );
  const columns = Math.min(3, options.count);
  const rows = Math.ceil(options.count / columns);
  const release = reserveImageBatch(board, {
    x: positions[0][0],
    y: positions[0][1],
    width: columns * reservedSize.width + (columns - 1) * 40,
    height: rows * reservedSize.height + (rows - 1) * 40,
  });
  const ns = "http://www.w3.org/2000/svg";
  const layer = document.createElementNS(ns, "g");
  layer.classList.add("image-batch-preparation");
  layer.setAttribute("pointer-events", "none");
  for (const [index, [x, y]] of positions.entries()) {
    const slot = document.createElementNS(ns, "g");
    slot.classList.add("batch-preparation-slot");
    slot.setAttribute("aria-label", `准备生成 ${index + 1}/${options.count}`);
    const rect = document.createElementNS(ns, "rect");
    for (const [key, value] of Object.entries({
      x,
      y,
      width: size.width,
      height: size.height,
      rx: 16,
      fill: "#f8fafc",
      stroke: "#cbd5e1",
      "stroke-width": 1,
    }))
      rect.setAttribute(key, String(value));
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(x + size.width / 2));
    label.setAttribute("y", String(y + size.height / 2));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "#64748b");
    label.setAttribute("font-size", "16");
    label.textContent = `准备生成 · ${index + 1}/${options.count}`;
    slot.append(rect, label);
    layer.append(slot);
  }
  try {
    PlaitBoard.getElementHost(board).append(layer);
  } catch (error) {
    release();
    throw error;
  }
  let disposed = false;
  return {
    count: options.count,
    positions,
    size,
    reservedSize,
    dispose() {
      if (!disposed) {
        disposed = true;
        layer.remove();
        release();
      }
    },
  };
}

// Two frames allow a complete SVG preview to be painted before async preparation.
// Hidden windows use a bounded timer so background submission cannot hang.
export function yieldBatchPreparationPaint(): Promise<void> {
  return new Promise((resolve) => {
    let frame = 0;
    const finish = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resolve();
    };
    const timer = setTimeout(finish, 100);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish);
    });
  });
}
