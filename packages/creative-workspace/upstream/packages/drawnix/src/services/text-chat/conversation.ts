import type { ChatSession } from "../../types/chat.types";
import type { TextSnapshot, TextTurn } from "./protocol";

export interface TextMessage extends TextSnapshot {
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
  messages: TextMessage[];
  draft: string;
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
    turns.push({ role: "user", content: message.content });
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
