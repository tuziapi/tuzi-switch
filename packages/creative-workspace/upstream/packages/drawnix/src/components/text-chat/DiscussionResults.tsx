import React, { useEffect, useState } from "react";
import { LocateFixed, RotateCcw } from "lucide-react";
import type { DiscussionLink } from "../../services/text-chat/conversation";
import { taskQueueService } from "../../services/task-queue";
import { TaskStatus } from "../../types/task.types";
import { workspaceService } from "../../services/workspace-service";
import { useDrawnix } from "../../hooks/use-drawnix";
import { WorkflowResultImage } from "../chat-drawer/WorkflowResultImage";
import { useMediaUrl } from "../../hooks/useMediaCache";
import { textChatRuntime } from "../../services/text-chat/runtime";
import { discussionTargetLabels } from "../../services/text-chat/discussion-plan";
import { TextMarkdown, copyChatText } from "./TextMarkdown";
import { scrollToPoint } from "../../utils/selection-utils";

function DiscussionMedia({
  taskId,
  source,
  audio,
}: {
  taskId: string;
  source: string;
  audio?: boolean;
}) {
  const { url, isLoading } = useMediaUrl(taskId, source);
  if (audio)
    return url ? (
      <audio src={url} controls preload="none" aria-label="生成音频" />
    ) : (
      <span>
        {isLoading ? "正在读取音频…" : "音频缓存不可用，请在任务列表查看。"}
      </span>
    );
  return url ? (
    <video src={url} controls preload="none" aria-label="生成视频" />
  ) : (
    <span>
      {isLoading ? "正在读取视频…" : "视频缓存不可用，请在任务列表查看。"}
    </span>
  );
}

export function DiscussionResults({
  link,
  onLocate,
  sessionId,
  messageId,
  busy,
}: {
  link: DiscussionLink;
  onLocate?: () => void;
  sessionId?: string;
  messageId?: string;
  busy?: boolean;
}) {
  const read = () =>
    taskQueueService
      .getAllTasks()
      .filter(
        (t) =>
          t.params.conversationLink?.runId === link.runId &&
          t.params.conversationLink?.boardId === link.boardId,
      );
  const [tasks, setTasks] = useState(read);
  const [notice, setNotice] = useState("");
  const { board } = useDrawnix();
  useEffect(() => {
    setTasks(read());
    const sub = taskQueueService.observeTaskUpdates().subscribe(({ task }) => {
      if (task.params.conversationLink?.runId === link.runId) setTasks(read());
    });
    return () => sub.unsubscribe();
  }, [link.runId]);
  const action = (taskId: string, locate: boolean) => {
    if (workspaceService.getState().currentBoardId !== link.boardId) {
      setNotice("请先返回这段讨论所属的画板，再定位或同步结果。");
      return;
    }
    if (!locate) {
      window.dispatchEvent(
        new CustomEvent("aitu:discussion-sync", { detail: { taskId } }),
      );
      setNotice("正在同步已有结果，不会重新生成。");
      return;
    }
    const task = tasks.find((t) => t.id === taskId);
    const urls = task?.result?.urls || [task?.result?.url];
    const element = board?.children.find(
      (e) => e.generationTaskId === taskId || urls.includes(e.url as string),
    );
    if (element?.points?.[0]) {
      onLocate?.();
      requestAnimationFrame(() => {
        if (workspaceService.getState().currentBoardId === link.boardId)
          scrollToPoint(board!, element.points[0]);
      });
    } else setNotice("画布中未找到该作品，可能已被删除。聊天记录仍保留。");
  };
  const decide = async (execute: boolean) => {
    if (!sessionId || !messageId) return;
    if (
      execute &&
      workspaceService.getState().currentBoardId !== link.boardId
    ) {
      setNotice("请先返回这段讨论所属的画板再执行。");
      return;
    }
    try {
      await textChatRuntime.decidePlan(sessionId, messageId, execute);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  if (!tasks.length && !link.plan) return null;
  return (
    <section className="discussion-results" aria-label="讨论生成任务">
      {link.plan && (
        <div className="discussion-plan" data-testid="discussion-plan">
          <div className="discussion-plan__heading">
            <strong>
              {link.plan.status === "ready"
                ? "待确认的生成计划"
                : link.plan.status === "cancelled"
                  ? "计划已取消"
                  : "已提交的生成计划"}
            </strong>
            <span>
              {link.plan.steps.reduce((n, s) => n + s.count, 0)} 个任务
            </span>
          </div>
          <ol>
            {link.plan.steps.map((step, i) => (
              <li key={i}>
                <div>
                  <strong>
                    {discussionTargetLabels[step.type]} {i + 1}
                    {step.count > 1 ? ` · 同一提示词 × ${step.count}` : ""}
                  </strong>
                  <small title={step.model}>{step.model}</small>
                </div>
                <p>{step.prompt}</p>
              </li>
            ))}
          </ol>
          {link.plan.status === "ready" && (
            <>
              <small>
                {link.plan.steps.some((step) => step.type === "image")
                  ? "每条图片提示词描述一张作品；同一提示词的多张变体分别生成。"
                  : "使用计划中的模型执行。"}
                调整底部模型后，请重新讨论生成计划。
              </small>
              <div className="discussion-plan__actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(false)}
                >
                  取消计划
                </button>
                <button
                  type="button"
                  className="discussion-plan__execute"
                  disabled={busy}
                  onClick={() => void decide(true)}
                >
                  执行 {link.plan.steps.reduce((n, s) => n + s.count, 0)} 个任务
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {tasks.length > 0 && (
        <div className="text-chat-status">
          生成任务 ·{" "}
          {tasks.filter((t) => t.status === TaskStatus.COMPLETED).length}/
          {tasks.length} 完成
        </div>
      )}
      {tasks.map((task) => (
        <div className="discussion-result" key={task.id} data-task-id={task.id}>
          <div className="discussion-result-media">
            {(task.result?.urls?.length
              ? task.result.urls
              : task.result?.url
                ? [task.result.url]
                : []
            ).map((url, i) =>
              task.type === "video" || task.type === "audio" ? (
                <DiscussionMedia
                  key={url}
                  taskId={task.id}
                  source={url}
                  audio={task.type === "audio"}
                />
              ) : (
                <WorkflowResultImage
                  key={url}
                  url={url}
                  thumbnailUrl={task.result?.thumbnailUrls?.[i]}
                  index={i}
                  onPreview={() => action(task.id, true)}
                />
              ),
            )}
          </div>
          {(task.result?.chatResponse || task.result?.lyricsText) && (
            <div className="discussion-result-text">
              <TextMarkdown
                content={
                  task.result.chatResponse || task.result.lyricsText || ""
                }
              />
              <button
                type="button"
                onClick={() =>
                  void copyChatText(
                    task.result?.chatResponse || task.result?.lyricsText || "",
                  )
                    .then(() => setNotice("已复制文本"))
                    .catch((e) => setNotice(e.message))
                }
              >
                复制文本
              </button>
            </div>
          )}
          <small>
            {task.params.model} ·{" "}
            {task.status === TaskStatus.COMPLETED
              ? task.insertedToCanvas
                ? "已放入画布"
                : task.type === "chat"
                  ? "已生成 · 保留在讨论中"
                  : "已生成 · 等待画布同步"
              : task.status === TaskStatus.FAILED
                ? "生成失败，请在任务列表查看详情"
                : task.status === TaskStatus.CANCELLED
                  ? "已停止"
                  : "生成中"}
          </small>
          {task.status === TaskStatus.COMPLETED && (
            <button
              type="button"
              onClick={() => action(task.id, Boolean(task.insertedToCanvas))}
            >
              {task.insertedToCanvas ? (
                <LocateFixed size={13} />
              ) : (
                <RotateCcw size={13} />
              )}
              {task.insertedToCanvas
                ? "定位画布"
                : task.type === "chat"
                  ? "放入画布"
                  : "同步到画布"}
            </button>
          )}
        </div>
      ))}
      {notice && (
        <div className="text-chat-status" role="status">
          {notice}
        </div>
      )}
    </section>
  );
}
