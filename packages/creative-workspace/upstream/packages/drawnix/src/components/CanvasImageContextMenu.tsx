import { useEffect, useRef } from "react";
import {
  Copy,
  Download,
  FolderOpen,
  ScanSearch,
  TextQuote,
} from "lucide-react";
import {
  PlaitBoard,
  getHitElementByPoint,
  toHostPoint,
  toViewBoxPoint,
} from "@plait/core";
import { PlaitDrawElement } from "@plait/draw";
import {
  ContextMenu,
  useContextMenuState,
  type ContextMenuEntry,
} from "./shared/ContextMenu";
import { getAssistantAccount } from "../services/assistant-account";
import {
  copyImagePrompt,
  runCanvasImageAction,
  type CanvasImageAction,
} from "../utils/canvas-image-actions";
import { MessagePlugin } from "../utils/message-plugin";
import { isVideoElement } from "../plugins/with-video";
import { isAudioElement } from "../data/audio";
import { useI18n } from "../i18n";
import "./canvas-image-context-menu.scss";

type Target = { id: string; url: string; prompt: string };

export function CanvasImageContextMenu({
  board,
  onPreview,
}: {
  board: PlaitBoard | null;
  onPreview: (id: string) => void;
}) {
  const { language } = useI18n();
  const zh = language === "zh";
  const { contextMenu, openAt, close } = useContextMenuState<Target>();
  const busy = useRef(false);
  useEffect(() => {
    if (!board) return;
    const host = PlaitBoard.getBoardContainer(board);
    const imageAt = (event: MouseEvent) => {
      const target = event.target as Element;
      if (
        !target.closest(".board-host-svg, .board-active-svg") ||
        target.closest(
          'input, textarea, [contenteditable="true"], .plait-tool-container',
        )
      )
        return;
      const hit = getHitElementByPoint(
        board,
        toViewBoxPoint(board, toHostPoint(board, event.clientX, event.clientY)),
      );
      if (
        !hit ||
        !PlaitDrawElement.isDrawElement(hit) ||
        !PlaitDrawElement.isImage(hit) ||
        isVideoElement(hit) ||
        isAudioElement(hit)
      )
        return;
      if ((hit as any).pptImagePlaceholder || !hit.url) return;
      return hit;
    };
    const blockDrawing = (event: MouseEvent) => {
      if (event.button !== 2 || !imageAt(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const handler = (event: MouseEvent) => {
      const hit = imageAt(event);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      const metadata = hit as any;
      const prompt =
        [metadata.generationPrompt, metadata.aiPrompt, metadata.prompt].find(
          (value) => typeof value === "string" && value.trim(),
        ) || "";
      // Bind actions to the right-clicked element, never the previous selection.
      openAt(event.clientX, event.clientY, {
        id: hit.id,
        url: hit.url,
        prompt,
      });
    };
    const pointerEvents = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
    ] as const;
    for (const name of pointerEvents)
      host.addEventListener(name, blockDrawing, true);
    host.addEventListener("contextmenu", handler, true);
    return () => {
      for (const name of pointerEvents)
        host.removeEventListener(name, blockDrawing, true);
      host.removeEventListener("contextmenu", handler, true);
      close();
    };
  }, [board, openAt, close]);

  useEffect(() => {
    if (!contextMenu) return;
    const getItems = () => [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".canvas-image-menu button:not(:disabled)",
      ),
    ];
    const frame = requestAnimationFrame(() => getItems()[0]?.focus());
    const navigate = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (["Delete", "Backspace"].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = getItems();
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      const current = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[index].focus();
    };
    document.addEventListener("keydown", navigate, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", navigate, true);
    };
  }, [contextMenu, close]);

  const run = async (action: CanvasImageAction | "prompt", target: Target) => {
    if (busy.current) return;
    busy.current = true;
    const message = MessagePlugin.loading(
      zh ? "正在处理图片…" : "Processing image…",
      0,
    );
    try {
      const result =
        action === "prompt"
          ? (await copyImagePrompt(target.prompt), "copied")
          : await runCanvasImageAction(
              action,
              target.url,
              `image-${target.id}`,
            );
      if (result !== "cancelled")
        MessagePlugin.success(
          result === "copied"
            ? zh
              ? "已复制，可直接粘贴"
              : "Copied, ready to paste"
            : result === "revealed"
              ? zh
                ? "已在文件管理器中显示图片"
                : "Image revealed in file manager"
              : result === "download-started"
                ? zh
                  ? "已发起下载"
                  : "Download started"
                : zh
                  ? "图片已保存"
                  : "Image saved",
        );
    } catch (error) {
      MessagePlugin.error(
        error instanceof Error
          ? error.message
          : zh
            ? "图片操作失败，请重试"
            : "Image operation failed",
      );
    } finally {
      MessagePlugin.close(message);
      busy.current = false;
    }
  };
  const items: ContextMenuEntry<Target>[] = [
    {
      key: "copy",
      label: zh ? "复制图片" : "Copy image",
      icon: <Copy size={16} />,
      onSelect: (t) => void run("copy", t),
    },
    {
      key: "save",
      label: zh ? "图片另存为…" : "Save image as…",
      icon: <Download size={16} />,
      onSelect: (t) => void run("save", t),
    },
    {
      key: "reveal",
      label: zh ? "显示图片文件" : "Show image file",
      icon: <FolderOpen size={16} />,
      disabled: !getAssistantAccount()?.imageAction,
      onSelect: (t) => void run("reveal", t),
    },
    { key: "divider", type: "divider" },
    {
      key: "preview",
      label: zh ? "预览原图" : "Preview image",
      icon: <ScanSearch size={16} />,
      onSelect: (t) => onPreview(t.id),
    },
    {
      key: "prompt",
      label: zh ? "复制提示词" : "Copy prompt",
      icon: <TextQuote size={16} />,
      disabled: (t) => !t.prompt,
      onSelect: (t) => void run("prompt", t),
    },
  ];
  return (
    <ContextMenu
      state={contextMenu}
      items={items}
      onClose={close}
      className="canvas-image-menu"
    />
  );
}
