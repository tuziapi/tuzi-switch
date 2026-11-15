import React, { useCallback, useSyncExternalStore } from "react";
import {
  ChevronUp,
  ChevronDown,
  Loader2,
  MessageCircle,
  Check,
  CircleAlert,
  ListChecks,
  Square,
} from "lucide-react";
import { textChatRuntime as runtime } from "../../services/text-chat/runtime";
import { taskQueueService } from "../../services/task-queue";

export function DiscussionStrip({
  boardId,
  onOpen,
  enabled,
  onDeactivate,
  expanded = false,
}: {
  boardId: string | null;
  onOpen: () => void;
  enabled?: boolean;
  onDeactivate?: () => void;
  expanded?: boolean;
}) {
  // A primitive snapshot keeps token updates local and avoids re-rendering the canvas/composer.
  const read = useCallback(() => {
    const state = runtime.getSnapshot();
    const sessions = state.sessions.filter(
      (s) =>
        s.textChat.executionMode === "agent" &&
        s.textChat.linkedBoardId === boardId,
    );
    const session =
      sessions.find((s) => s.id === state.activeId) || sessions[0];
    const message = session?.textChat.messages
      .filter((m) => m.role === "assistant")
      .at(-1);
    const tasks = message?.discussion
      ? taskQueueService
          .getAllTasks()
          .filter(
            (t) =>
              t.params.conversationLink?.runId === message.discussion!.runId,
          )
      : [];
    const busy = Boolean(session && state.running.has(session.id));
    const pending = tasks.filter((t) =>
      ["pending", "processing"].includes(t.status),
    ).length;
    const complete = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) =>
      ["failed", "cancelled"].includes(t.status),
    ).length;
    const status = tasks.length
      ? pending
        ? `生成作品 ${complete}/${tasks.length}`
        : failed
          ? `${complete}/${tasks.length} 完成 · ${failed} 个未完成`
          : `${complete} 个作品已生成${tasks.every((t) => t.insertedToCanvas) ? " · 已放入画布" : " · 等待同步"}`
      : message?.discussion?.plan?.status === "ready"
        ? "生成计划待确认 · 点击预览"
        : message?.status === "error"
          ? "讨论遇到问题 · 点击查看"
          : message?.status === "stopped"
            ? "已停止"
            : busy
              ? message?.reasoning && !message.content
                ? `正在思考 · ${message.reasoning.replace(/\s+/g, " ").slice(-90)}`
                : "正在回复"
              : message
                ? "讨论已完成"
                : "用文本模型讨论，再预览并批量生成";
    const phase = busy || pending
      ? "working"
      : failed || message?.status === "error"
        ? "error"
        : message?.discussion?.plan?.status === "ready"
          ? "ready"
          : complete || message?.status === "complete"
            ? "complete"
            : "idle";
    return JSON.stringify([session?.id, busy, status, phase]);
  }, [boardId]);
  const subscribe = useCallback(
    (notify: () => void) => {
      const off = runtime.subscribe(notify);
      const sub = taskQueueService
        .observeTaskUpdates()
        .subscribe(({ task }) => {
          if (task.params.conversationLink?.boardId === boardId) notify();
        });
      return () => {
        off();
        sub.unsubscribe();
      };
    },
    [boardId],
  );
  const [id, busy, status, phase] = JSON.parse(
    useSyncExternalStore(subscribe, read),
  ) as [string | undefined, boolean, string, string];
  return (
    <div
      className="discussion-strip"
      data-testid="discussion-strip"
      data-phase={phase}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        // Keep the composer from shrinking between mouse down and click.
        if (event.button === 0) event.preventDefault();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="discussion-strip__open"
        onClick={onOpen}
        aria-expanded={expanded}
        aria-controls="attached-discussion-panel"
        aria-label={`${expanded ? "收起" : "打开"}讨论：${status}`}
      >
        <span className="discussion-strip__icon" aria-hidden="true">
          {phase === "working" ? (
            <Loader2 size={14} className="discussion-strip__spin" />
          ) : phase === "error" ? (
            <CircleAlert size={14} />
          ) : phase === "ready" ? (
            <ListChecks size={14} />
          ) : phase === "complete" ? (
            <Check size={14} />
          ) : (
            <MessageCircle size={14} />
          )}
        </span>
        <span className="discussion-strip__label">创作讨论</span>
        <span className="discussion-strip__status" title={status}>{status}</span>
        <span className="discussion-strip__toggle" aria-hidden="true">
          <span>{expanded ? "收起" : "展开"}</span>
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>
      {enabled && onDeactivate && (
        <button
          type="button"
          className="discussion-strip__direct"
          onClick={onDeactivate}
          title="主输入框恢复直接生成；后台任务继续执行"
        >
          直接生成
        </button>
      )}
      {busy && id && (
        <button
          type="button"
          className="discussion-strip__stop"
          aria-label="停止讨论任务"
          onClick={() => runtime.stop(id)}
        >
          <Square size={11} />
        </button>
      )}
    </div>
  );
}
