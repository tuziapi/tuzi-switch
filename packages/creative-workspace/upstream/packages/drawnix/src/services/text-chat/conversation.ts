import type { ChatSession } from "../../types/chat.types";
import type { TextSnapshot, TextTurn } from "./protocol";
import { validateAttachmentRefs, type TextAttachmentRef } from "./attachments";

import { validateDiscussionPlan, type DiscussionPlan } from "./discussion-plan";

export interface DiscussionLink {
  plan?: DiscussionPlan;
  boardId: string;
  runId: string;
  taskIds: string[];
  /** Persisted before any media tool can run; absent on legacy messages. */
  submission?: "not_started" | "started";
}
export interface TextMessage extends TextSnapshot {
  origin?: "canvas" | "sidebar";
  discussion?: DiscussionLink;
  attachments?: TextAttachmentRef[];
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  status:
    | "pending"
    | "streaming"
    | "complete"
    | "stopped"
    | "interrupted"
    | "error";
  model?: string;
  replyTo?: string;
  error?: string;
}
export interface TextConversationState {
  version: 1;
  executionMode?: "chat" | "agent";
  linkedBoardId?: string;
  messages: TextMessage[];
  draft: string;
  draftAttachments?: TextAttachmentRef[];
  systemPrompt: string;
  maxOutput?: number;
}
export interface TextConversation extends ChatSession {
  kind: "text";
  textChat: TextConversationState;
}
export function newTextState(): TextConversationState {
  return { version: 1, messages: [], draft: "", systemPrompt: "" };
}
export function restoreTextConversation(
  session: ChatSession,
): TextConversation {
  if (
    session.kind !== "text" ||
    session.textChat?.version !== 1 ||
    !Array.isArray(session.textChat.messages) ||
    typeof session.id !== "string" ||
    typeof session.title !== "string" ||
    typeof (session.textChat.draft ?? "") !== "string" ||
    typeof (session.textChat.systemPrompt ?? "") !== "string" ||
    session.textChat.messages.some(
      (m) =>
        !m ||
        typeof m.id !== "string" ||
        !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string" ||
        ![
          "pending",
          "streaming",
          "complete",
          "stopped",
          "interrupted",
          "error",
        ].includes(m.status),
    )
  )
    throw new Error("文本会话格式或版本不受支持，请保留原数据并更新客户端。");
  const state = session.textChat;
  if ((state.executionMode !== undefined && !["chat", "agent"].includes(state.executionMode)) ||
      (state.linkedBoardId !== undefined && (typeof state.linkedBoardId !== "string" || !state.linkedBoardId.trim())) ||
      (state.executionMode === "agent" && !state.linkedBoardId))
    throw new Error("讨论会话画板绑定无效，请保留原数据。");
  for (const m of state.messages) {
    if (m.discussion?.plan !== undefined) {
      validateDiscussionPlan(m.discussion.plan);
      if ((m.discussion.plan.status === "ready" && (m.discussion.submission !== "not_started" || m.discussion.taskIds.length)) ||
          (m.discussion.plan.status === "started" && m.discussion.submission !== "started")) throw new Error("讨论计划提交状态无效。");
    }
    if (m.origin !== undefined && !["canvas", "sidebar"].includes(m.origin)) throw new Error("消息来源无效。");
    if (m.discussion !== undefined && (!m.discussion || typeof m.discussion.boardId !== "string" || !m.discussion.boardId ||
        typeof m.discussion.runId !== "string" || !m.discussion.runId ||
        m.discussion.boardId !== state.linkedBoardId || !Array.isArray(m.discussion.taskIds) ||
        (m.discussion.submission !== undefined && !["not_started", "started"].includes(m.discussion.submission)) ||
        (m.discussion.submission === "not_started" && m.discussion.taskIds.length > 0) ||
        m.discussion.taskIds.length > 10 || m.discussion.taskIds.some(id => typeof id !== "string" || !id)))
      throw new Error("讨论任务引用无效，请保留原数据。");
  }
  if (session.textChat.draftAttachments !== undefined)
    validateAttachmentRefs(session.textChat.draftAttachments);
  session.textChat.messages.forEach((m) => {
    if (m.attachments !== undefined) validateAttachmentRefs(m.attachments);
  });
  return {
    ...session,
    kind: "text",
    textChat: {
      ...newTextState(),
      ...session.textChat,
      draft: session.textChat.draft ?? "",
      systemPrompt: session.textChat.systemPrompt ?? "",
      messages: session.textChat.messages.map((m) => ({
        ...m,
        reasoning: m.reasoning || "",
        ...(["pending", "streaming"].includes(m.status)
          ? {
              status: "interrupted" as const,
              error: "上次回复未完成，已恢复收到的内容。",
            }
          : {}),
      })),
    },
  };
}
/** One latest usable answer per user turn. Regeneration never deletes prior answers. */
export function conversationContext(
  messages: TextMessage[],
  userId: string,
): TextTurn[] {
  const turns: TextTurn[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    turns.push({
      role: "user",
      content: message.content,
      ...(message.attachments?.length
        ? { attachments: message.attachments }
        : {}),
    });
    if (message.id === userId) return turns;
    const answer = messages
      .filter(
        (m) =>
          m.role === "assistant" &&
          m.replyTo === message.id &&
          m.status === "complete" &&
          m.content.trim(),
      )
      .at(-1);
    if (answer) turns.push({ role: "assistant", content: answer.content });
  }
  throw new Error("没有找到要回复的原始消息。");
}

/** Only explicit, durable pre-submission failures can be replayed. */
export function canRetryDiscussion(message: TextMessage): boolean {
  return Boolean(!message.discussion?.plan && message.discussion?.submission === "not_started" &&
    message.discussion.taskIds.length === 0 &&
    ["error", "interrupted", "stopped"].includes(message.status));
}
