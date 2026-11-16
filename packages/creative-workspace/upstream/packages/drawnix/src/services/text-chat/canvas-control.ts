import {
  getSelectedElements,
  PlaitHistoryBoard,
  Transforms,
} from "@plait/core";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { getCanvasBoardBinding } from "../canvas-operations/canvas-board-ref";
import { workspaceService } from "../workspace-service";
import { scrollToPoint } from "../../utils/selection-utils";
import { isVideoElement } from "../../plugins/with-video";
import { isAudioElement } from "../../data/audio";

import { validateCanvasPlan, type CanvasEditPlan } from "./canvas-schema";
export { validateCanvasPlan, needsCanvasConfirmation } from "./canvas-schema";
export type { CanvasAction, CanvasEditPlan } from "./canvas-schema";
export const canvasRevision = (children: unknown) =>
  bytesToHex(sha256(JSON.stringify(children)));
function current(boardId: string) {
  const binding = getCanvasBoardBinding();
  if (
    !binding ||
    binding.boardId !== boardId ||
    workspaceService.getState().currentBoardId !== boardId
  )
    throw new Error("画板已切换，请返回本次讨论的画板后重新发送。");
  return binding.board;
}
function textOf(value: any): string {
  if (!value) return "";
  if (typeof value.text === "string") return value.text;
  return Array.isArray(value.children)
    ? value.children.map(textOf).join("\n")
    : "";
}
function editable(e: any) {
  return (
    Array.isArray(e.points) &&
    e.points.length === 2 &&
    !e.isLocked &&
    !e.locked &&
    !e.groupId &&
    !e.frameId &&
    !e.generationNode &&
    !e.generationInput &&
    !e.generationTaskId?.startsWith("pending") &&
    !e.primaryTaskId &&
    !isAudioElement(e) &&
    ["image", "geometry"].includes(e.type)
  );
}
export function snapshotCanvas(boardId: string) {
  const board = current(boardId);
  const selected = new Set(getSelectedElements(board).map((e) => e.id));
  // Refuse silently truncated boards: an omitted element must never be mistaken for absent.
  if (board.children.length > 500)
    throw new Error(
      "当前画布超过 500 个元素，请拆分画板后讨论，避免遗漏内容。",
    );
  let remainingText = 60000;
  const elements = board.children.map((e: any, index) => {
    const fullText = textOf(e.text || e),
      text = fullText.slice(0, Math.min(2000, remainingText));
    remainingText -= text.length;
    return {
      id: e.id,
      order: index + 1,
      type: isAudioElement(e) ? "audio" : isVideoElement(e) ? "video" : e.type,
      selected: selected.has(e.id),
      points: e.points,
      editable: editable(e),
      text,
      textTruncated: text.length < fullText.length,
      label: String(e.name || e.title || e.generationPrompt || "").slice(
        0,
        300,
      ),
    };
  });
  return { board, revision: canvasRevision(board.children), elements };
}
export function executeCanvasEdits(plan: CanvasEditPlan) {
  validateCanvasPlan(plan);
  if (plan.status !== "ready")
    throw new Error("此画布操作已处理，不能重复执行。");
  const board = current(plan.boardId);
  if (canvasRevision(board.children) !== plan.revision)
    throw new Error("画布内容已变化，本次未修改，请重新发送指令。");
  // Prepare the complete result before emitting any operation. Failure is all-or-nothing.
  const next = structuredClone(board.children) as any[];
  const locate: string[] = [];
  for (const a of plan.actions) {
    const targets = a.ids.map((id) => {
      const e = next.find((e) => e.id === id);
      if (!e) throw new Error("操作引用了不存在的画布元素。");
      if (a.op !== "locate" && !editable(e))
        throw new Error("该元素属于组合、框架或生成卡片，请在画布中直接编辑。");
      return e;
    });
    if (a.op === "locate") {
      locate.push(...a.ids);
      continue;
    }
    if (a.op === "delete") {
      for (const e of targets) next.splice(next.indexOf(e), 1);
      continue;
    }
    if (a.op === "replace") {
      const source = next.find((e) => e.id === a.sourceId);
      if (
        !source?.url ||
        isAudioElement(source) ||
        source.type !== "image" ||
        targets[0].type !== "image" ||
        Boolean(isVideoElement(source)) !== Boolean(isVideoElement(targets[0]))
      )
        throw new Error("替换必须引用画布上同类型的图片或视频。");
      const target = targets[0];
      const replacement = {
        ...structuredClone(source),
        id: target.id,
        points: target.points,
        angle: target.angle,
      };
      for (const key of [
        "generationTaskId",
        "generationNodeId",
        "primaryTaskId",
      ])
        delete replacement[key];
      next[next.indexOf(target)] = replacement;
      continue;
    }
    if (a.op === "set_text") {
      const e = targets[0];
      if (!e.text?.children || e.url)
        throw new Error("该元素不是可编辑的文字。");
      e.text = { ...e.text, children: [{ text: a.text }] };
      continue;
    }
    const minX = Math.min(
      ...targets.map((e) => Math.min(e.points[0][0], e.points[1][0])),
    );
    const minY = Math.min(
      ...targets.map((e) => Math.min(e.points[0][1], e.points[1][1])),
    );
    const width = Math.max(
      ...targets.map((e) => Math.abs(e.points[1][0] - e.points[0][0])),
    );
    const height = Math.max(
      ...targets.map((e) => Math.abs(e.points[1][1] - e.points[0][1])),
    );
    targets.forEach((target, index) => {
      const e = a.op === "copy" ? structuredClone(target) : target;
      if (a.op === "copy") {
        e.id = crypto.randomUUID();
        delete e.generationTaskId;
        delete e.generationNodeId;
        next.push(e);
      }
      const dx =
        a.op === "arrange"
          ? minX +
            (index % a.columns!) * (width + a.gap!) -
            Math.min(...e.points.map((p: number[]) => p[0]))
          : a.dx || 0;
      const dy =
        a.op === "arrange"
          ? minY +
            Math.floor(index / a.columns!) * (height + a.gap!) -
            Math.min(...e.points.map((p: number[]) => p[1]))
          : a.dy || 0;
      e.points = e.points.map(([x, y]: number[]) =>
        a.op === "scale"
          ? [minX + (x - minX) * a.scale!, minY + (y - minY) * a.scale!]
          : [x + dx, y + dy],
      );
    });
  }
  if (
    next.some((e) =>
      e.points?.some((p: number[]) =>
        p.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7),
      ),
    )
  )
    throw new Error("操作后的坐标超出范围，本次未修改。");
  if (next.length > 500) throw new Error("操作后元素超过 500 个，本次未修改。");
  let applyError: unknown;
  PlaitHistoryBoard.withNewBatch(board, () => {
    try {
      for (let index = board.children.length - 1; index >= 0; index--)
        if (!next.some((e) => e.id === board.children[index].id))
          Transforms.removeNode(board, [index]);
      for (const e of next) {
        const index = board.children.findIndex((item) => item.id === e.id);
        if (index < 0) Transforms.insertNode(board, e, [board.children.length]);
        else if (canvasRevision(e) !== canvasRevision(board.children[index])) {
          const patch: Record<string, unknown> = {};
          for (const key of new Set([
            ...Object.keys(board.children[index]),
            ...Object.keys(e),
          ]))
            if (
              key !== "id" &&
              JSON.stringify(e[key]) !==
                JSON.stringify(board.children[index][key])
            )
              patch[key] = e[key];
          Transforms.setNode(board, patch, [index]);
        }
      }
    } catch (error) {
      applyError = error;
    }
  });
  // Keep the history batch flags intact even if an installed plugin rejects an operation.
  if (applyError)
    throw new Error(
      "画布未能完成整批操作，部分修改可能已执行，请使用撤销恢复后重试。",
    );
  const first = board.children.find((e) => e.id === locate[0]);
  if (first?.points?.[0]) {
    try {
      scrollToPoint(board, first.points[0]);
    } catch {
      return "内容操作已完成，可撤销恢复；视口定位失败，请在画布中查找目标。";
    }
  }
  return `已执行 ${plan.actions.length} 项画布操作；内容修改可用撤销恢复。`;
}
