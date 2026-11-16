import { beforeEach, expect, it, vi } from "vitest";
import {
  createTestingBoard,
  withHistory,
  RectangleClient,
  IS_BOARD_ALIVE,
  addSelectedElement,
} from "@plait/core";
const state = vi.hoisted(() => ({ currentBoardId: "board" }));
vi.mock("../workspace-service", () => ({
  workspaceService: { getState: () => state },
}));
vi.mock("../../utils/selection-utils", () => ({ scrollToPoint: vi.fn() }));
vi.mock("../../plugins/with-video", () => ({
  isVideoElement: (e: any) => e.isVideo === true,
}));
vi.mock("../../data/audio", () => ({
  isAudioElement: (e: any) =>
    e.type === "audio" || e.isAudio || Boolean(e.audioUrl),
}));
import { setCanvasBoard } from "../canvas-operations/canvas-board-ref";
import {
  canvasRevision,
  snapshotCanvas,
  executeCanvasEdits,
} from "./canvas-control";
import {
  needsCanvasConfirmation,
  validateCanvasPlan,
  type CanvasAction,
} from "./canvas-schema";
const picture = (id: string, x = 0) => ({
  id,
  type: "image",
  url: "https://synthetic.invalid/" + id,
  points: [
    [x, 0],
    [x + 100, 100],
  ],
});
function setup() {
  const board = createTestingBoard(
    [withHistory],
    [
      picture("a"),
      picture("b", 200),
      {
        id: "text",
        type: "geometry",
        shape: "text",
        points: [
          [0, 200],
          [200, 240],
        ],
        text: { children: [{ text: "original" }] },
      },
    ],
  );
  IS_BOARD_ALIVE.set(board, true);
  setCanvasBoard(board, "board");
  return board;
}
function plan(board: ReturnType<typeof setup>, actions: CanvasAction[]) {
  return {
    version: 1 as const,
    boardId: "board",
    revision: canvasRevision(board.children),
    status: "ready" as const,
    actions,
  };
}
beforeEach(() => {
  state.currentBoardId = "board";
});
it("reads selected and unselected elements, text, positions and explicit truncation", () => {
  const board = setup();
  addSelectedElement(board, board.children[0]);
  const snapshot = snapshotCanvas("board");
  expect(snapshot.elements).toHaveLength(3);
  expect(snapshot.elements[0]).toMatchObject({
    id: "a",
    selected: true,
    editable: true,
  });
  expect(snapshot.elements[1]).toMatchObject({
    id: "b",
    selected: false,
    points: [
      [200, 0],
      [300, 100],
    ],
  });
  expect(snapshot.elements[2]).toMatchObject({
    text: "original",
    textTruncated: false,
  });
});
it("applies a multi-action batch and one real Plait undo restores exact contents", async () => {
  const board = setup(),
    original = structuredClone(board.children);
  executeCanvasEdits(
    plan(board, [
      { op: "move", ids: ["a", "b"], dx: 10, dy: 20 },
      { op: "arrange", ids: ["a", "b"], columns: 1, gap: 15 },
      { op: "scale", ids: ["a", "b"], scale: 2 },
      { op: "copy", ids: ["b"], dx: 300, dy: 0 },
      { op: "set_text", ids: ["text"], text: "changed" },
    ]),
  );
  expect(board.children).toHaveLength(4);
  expect(board.children[0].points).toEqual([
    [10, 20],
    [210, 220],
  ]);
  expect(board.children[1].points).toEqual([
    [10, 250],
    [210, 450],
  ]);
  expect(board.children[2].text.children[0].text).toBe("changed");
  await Promise.resolve();
  board.undo();
  expect(board.children).toEqual(original);
});
it.each(["stale", "switched", "locked", "missing", "overflow"])(
  "rejects %s edits without partial mutation",
  (kind) => {
    const board = setup(),
      p = plan(board, [
        { op: "move", ids: ["a"], dx: 10, dy: 0 },
        { op: "move", ids: ["b"], dx: 20, dy: 0 },
      ]);
    if (kind === "stale") board.children[0].url = "changed";
    if (kind === "switched") state.currentBoardId = "other";
    if (kind === "locked") {
      board.children[1].locked = true;
      p.revision = canvasRevision(board.children);
    }
    if (kind === "missing") p.actions[1].ids = ["missing"];
    if (kind === "overflow") {
      board.children[0].points = [
        [9999999, 0],
        [10000000, 100],
      ];
      p.revision = canvasRevision(board.children);
    }
    const before = structuredClone(board.children);
    expect(() => executeCanvasEdits(p)).toThrow();
    expect(board.children).toEqual(before);
  },
);
it("always confirms destructive operations and advisory language", () => {
  expect(
    needsCanvasConfirmation([{ op: "delete", ids: ["a"] }], "删除图片"),
  ).toBe(true);
  expect(
    needsCanvasConfirmation(
      [{ op: "replace", ids: ["a"], sourceId: "b" }],
      "替换",
    ),
  ).toBe(true);
  expect(
    needsCanvasConfirmation(
      [{ op: "move", ids: ["a"], dx: 1, dy: 0 }],
      "怎么移动它？",
    ),
  ).toBe(true);
  expect(
    needsCanvasConfirmation(
      [{ op: "move", ids: ["a"], dx: 1, dy: 0 }],
      "把图片向右移动",
    ),
  ).toBe(false);
});
it("replacement clears stale media metadata and delete is undoable", async () => {
  const board = setup();
  board.children[0].poster = "old";
  board.children[0].generationTaskId = "old-task";
  const original = structuredClone(board.children);
  executeCanvasEdits(
    plan(board, [
      { op: "replace", ids: ["a"], sourceId: "b" },
      { op: "delete", ids: ["b"] },
    ]),
  );
  expect(board.children[0]).toMatchObject({
    id: "a",
    url: "https://synthetic.invalid/b",
    points: original[0].points,
  });
  expect(board.children[0].poster).toBeUndefined();
  expect(board.children[0].generationTaskId).toBeUndefined();
  expect(board.children.find((e) => e.id === "b")).toBeUndefined();
  await Promise.resolve();
  board.undo();
  expect(board.children).toEqual(original);
});
it("rejects unknown fields and replayed plans", () => {
  const board = setup(),
    p = plan(board, [{ op: "move", ids: ["a"], dx: 1, dy: 0 }]);
  expect(() =>
    validateCanvasPlan({
      ...p,
      actions: [{ ...p.actions[0], url: "https://untrusted.invalid" }],
    }),
  ).toThrow();
  expect(() => executeCanvasEdits({ ...p, status: "applied" })).toThrow();
});

it("keeps reference connections consistent through a discussion move and undo", async () => {
  const {
    withCanvasAssociation,
    createCanvasAssociationLines,
    isCanvasAssociationLine,
  } = await import("../../plugins/canvas-association");
  const { IMAGE_TOOLBAR_PREFERENCES_KEY } = await import(
    "../../utils/image-toolbar-preferences"
  );
  localStorage.setItem(
    IMAGE_TOOLBAR_PREFERENCES_KEY,
    JSON.stringify({ referenceLines: true }),
  );
  const board = createTestingBoard(
    [
      withHistory,
      (b) => {
        b.getRectangle = (e) => RectangleClient.getRectangleByPoints(e.points);
        return b;
      },
      withCanvasAssociation,
    ],
    [picture("a"), picture("b", 300)],
  );
  IS_BOARD_ALIVE.set(board, true);
  setCanvasBoard(board, "board");
  createCanvasAssociationLines(board, {
    boardId: "board",
    sourceElementIds: ["a"],
    resultElementId: "b",
  });
  await new Promise((r) => setTimeout(r, 0));
  const original = structuredClone(board.children);
  executeCanvasEdits(plan(board, [{ op: "move", ids: ["a"], dx: 0, dy: 200 }]));
  await new Promise((r) => setTimeout(r, 0));
  expect(board.children.find(isCanvasAssociationLine)?.points).toEqual([
    [100, 250],
    [300, 50],
  ]);
  board.undo();
  await new Promise((r) => setTimeout(r, 0));
  expect(board.children).toEqual(original);
  localStorage.removeItem(IMAGE_TOOLBAR_PREFERENCES_KEY);
});

it("keeps legacy audio cards read-only and refuses audio-as-image replacement", () => {
  const board = setup();
  board.children[1].isAudio = true;
  board.children[1].audioUrl = "/synthetic.mp3";
  expect(snapshotCanvas("board").elements[1]).toMatchObject({
    type: "audio",
    editable: false,
  });
  const before = structuredClone(board.children);
  expect(() =>
    executeCanvasEdits(
      plan(board, [{ op: "replace", ids: ["a"], sourceId: "b" }]),
    ),
  ).toThrow();
  expect(board.children).toEqual(before);
});
