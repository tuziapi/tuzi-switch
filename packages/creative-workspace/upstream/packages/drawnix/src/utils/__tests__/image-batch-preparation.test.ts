import { describe, it, expect, vi, afterEach } from "vitest";
import { PlaitBoard, createBoard, RectangleClient } from "@plait/core";
import {
  createImageBatchPreparation,
  yieldBatchPreparationPaint,
} from "../image-batch-preparation";
import { getBatchReservations } from "../image-batch-reservations";
import {
  resolveImageLineagePositions,
  placeImageColumn,
} from "../image-generation-lineage-placement";
import { resolveImageGenerationBatchAnchorPositions } from "../image-generation-anchor-placement";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup() {
  const board = createBoard([]);
  board.getRectangle = (el) =>
    RectangleClient.getRectangleByPoints(el.points || []);
  const host = document.createElementNS("http://www.w3.org/2000/svg", "g");
  vi.spyOn(PlaitBoard, "getElementHost").mockReturnValue(host);
  return { board, host };
}

describe("batch preparation without speculative canvas records", () => {
  it.each([1, 3, 4, 10, 20])(
    "shows all %i slots synchronously and cleans up without saving or changing existing content",
    (count) => {
      const { board, host } = setup();
      const snapshot = board.children;
      const preview = createImageBatchPreparation(board, {
        count,
        sourceIds: [],
        emptyPosition: [0, 0],
      });
      expect(host.querySelectorAll(".batch-preparation-slot")).toHaveLength(
        count,
      );
      expect(preview.positions).toEqual(
        Array.from({ length: count }, (_, i) => [
          (i % 3) * 440,
          Math.floor(i / 3) * 640,
        ]),
      );
      expect(board.children).toBe(snapshot);
      expect(getBatchReservations(board)).toHaveLength(1);
      preview.dispose();
      preview.dispose();
      expect(host.children).toHaveLength(0);
      expect(getBatchReservations(board)).toEqual([]);
      expect(board.children).toBe(snapshot);
    },
  );

  it("reserves the entire region against asynchronously inserted reference images", () => {
    const { board } = setup();
    const preview = createImageBatchPreparation(board, {
      count: 4,
      sourceIds: [],
      emptyPosition: [0, 0],
    });
    const [reference] = placeImageColumn(
      board,
      [0, 0],
      [{ width: 400, height: 400 }],
    );
    expect(reference[1]).toBeGreaterThanOrEqual(1240);
    preview.dispose();
    expect(
      placeImageColumn(board, [0, 0], [{ width: 400, height: 400 }])[0],
    ).toEqual([0, 0]);
  });

  it("moves a three-column group together around existing content including frame-adjacent batches", () => {
    const { board } = setup();
    board.children.push({
      id: "obstacle",
      type: "image",
      points: [
        [440, 0],
        [840, 400],
      ],
    });
    const positions = resolveImageLineagePositions(
      board,
      [],
      { width: 400, height: 600 },
      4,
      [0, 0],
      "grid",
    );
    expect(positions[1]).toEqual([positions[0][0] + 440, positions[0][1]]);
    expect(positions[3]).toEqual([positions[0][0], positions[0][1] + 640]);
    const frame = resolveImageGenerationBatchAnchorPositions(
      board,
      [0, 0],
      { width: 400, height: 600 },
      4,
      { frameRect: { x: 0, y: 0, width: 400, height: 400 } },
    );
    expect(frame[2]).toEqual([frame[0][0] + 880, frame[0][1]]);
    expect(frame[3]).toEqual([frame[0][0], frame[0][1] + 640]);
  });

  it("releases the reservation if its host is unavailable", () => {
    const { board } = setup();
    vi.spyOn(PlaitBoard, "getElementHost").mockImplementation(() => {
      throw Error("unmounted");
    });
    expect(() =>
      createImageBatchPreparation(board, {
        count: 3,
        sourceIds: [],
        emptyPosition: [0, 0],
      }),
    ).toThrow("unmounted");
    expect(getBatchReservations(board)).toEqual([]);
  });

  it("does not hang preparation in a hidden window with suspended animation frames", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const ready = vi.fn();
    const painting = yieldBatchPreparationPaint().then(ready);
    await vi.advanceTimersByTimeAsync(100);
    await painting;
    expect(ready).toHaveBeenCalledOnce();
  });
});
