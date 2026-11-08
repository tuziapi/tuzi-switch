import { chatStorageService as storage } from "../chat-storage-service";
import { requestTextChat, type TextChatRequest } from "./request";
import {
  conversationContext,
  newTextState,
  restoreTextConversation,
  type TextConversation,
  type TextMessage,
} from "./conversation";
import type { ModelRef } from "../../utils/settings-manager";

interface Snapshot {
  sessions: TextConversation[];
  ready: boolean;
  error: string | null;
  running: ReadonlySet<string>;
  saveErrors: ReadonlySet<string>;
}
type Storage = Pick<
  typeof storage,
  | "getAllSessions"
  | "saveTextSession"
  | "deleteSession"
  | "generateId"
  | "generateTitle"
>;
export class TextChatRuntime {
  private snapshot: Snapshot = {
    sessions: [],
    ready: false,
    error: null,
    running: new Set(),
    saveErrors: new Set(),
  };
  private listeners = new Set<() => void>();
  private init?: Promise<void>;
  private requests = new Map<string, AbortController>();
  private saves = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private epoch = 0;
  constructor(
    private db: Storage = storage,
    private request: (
      r: TextChatRequest,
    ) => ReturnType<typeof requestTextChat> = requestTextChat,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  initialize = () => (this.init ??= this.load());
  private async load() {
    const epoch = this.epoch;
    try {
      const sessions = (await this.db.getAllSessions())
        .filter((s) => s.kind === "text")
        .map(restoreTextConversation);
      if (epoch === this.epoch)
        this.emit({ sessions, ready: true, error: null });
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.emit({
        ready: true,
        error:
          error instanceof Error ? error.message : "读取会话失败，请重试。",
      });
      this.init = undefined;
    }
  }
  private get(id: string) {
    const session = this.snapshot.sessions.find((s) => s.id === id);
    if (!session) throw new Error("会话已不存在。");
    return session;
  }
  private replace(session: TextConversation) {
    this.emit({
      sessions: this.snapshot.sessions.map((s) =>
        s.id === session.id ? session : s,
      ),
    });
  }
  private updateMessage(
    id: string,
    messageId: string,
    patch: Partial<TextMessage>,
  ) {
    const session = this.get(id);
    this.replace({
      ...session,
      textChat: {
        ...session.textChat,
        messages: session.textChat.messages.map((m) =>
          m.id === messageId ? { ...m, ...patch } : m,
        ),
      },
    });
  }
  save = async (id: string): Promise<void> => {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const session = this.get(id),
      epoch = this.epoch;
    const prior = this.saves.get(id) ?? Promise.resolve();
    const next = prior
      .catch(() => {})
      .then(async () => {
        if (epoch !== this.epoch) return;
        await this.db.saveTextSession(session);
      });
    this.saves.set(id, next);
    try {
      await next;
      if (epoch !== this.epoch) return;
      const saveErrors = new Set(this.snapshot.saveErrors);
      saveErrors.delete(id);
      this.emit({ saveErrors });
    } catch {
      if (epoch !== this.epoch) return;
      const saveErrors = new Set(this.snapshot.saveErrors);
      saveErrors.add(id);
      this.emit({ saveErrors });
      throw new Error(
        "会话保存失败。内容仍保留在当前窗口，请重试保存后再关闭。",
      );
    } finally {
      if (this.saves.get(id) === next) this.saves.delete(id);
    }
  };
  private scheduleSave(id: string) {
    if (this.timers.has(id)) return;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.save(id).catch(() => {});
      }, 700),
    );
  }
  create = async (model: ModelRef | null): Promise<string> => {
    await this.initialize();
    if (this.snapshot.error) throw new Error(this.snapshot.error);
    const now = Date.now();
    const session: TextConversation = {
      id: this.db.generateId(),
      title: "新对话",
      kind: "text",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      sessionModel: model?.modelId || undefined,
      sessionModelRef: model,
      textChat: newTextState(),
    };
    this.emit({ sessions: [session, ...this.snapshot.sessions] });
    await this.save(session.id);
    return session.id;
  };
  configure = (
    id: string,
    patch: Partial<
      Pick<TextConversation, "title" | "sessionModel" | "sessionModelRef">
    >,
    textPatch: Partial<
      Omit<TextConversation["textChat"], "messages" | "version">
    > = {},
  ) => {
    const current = this.get(id);
    this.replace({
      ...current,
      ...patch,
      textChat: { ...current.textChat, ...textPatch },
    });
    this.scheduleSave(id);
  };
  remove = async (id: string) => {
    if (this.requests.has(id))
      throw new Error("请先停止当前会话的生成，再删除会话。");
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    await this.saves.get(id)?.catch(() => {});
    await this.db.deleteSession(id);
    const saveErrors = new Set(this.snapshot.saveErrors);
    saveErrors.delete(id);
    this.emit({
      sessions: this.snapshot.sessions.filter((s) => s.id !== id),
      saveErrors,
    });
  };
  stop = (id: string) => this.requests.get(id)?.abort();
  send = async (id: string, content: string, regenerateUserId?: string) => {
    if (this.requests.has(id)) return;
    const session = this.get(id);
    const text = content.trim();
    if (!regenerateUserId && !text) return;
    if (text.length > 200000) throw new Error("单条消息过长，请分段发送。");
    const now = Date.now();
    const user: TextMessage = regenerateUserId
      ? session.textChat.messages.find(
          (m) => m.id === regenerateUserId && m.role === "user",
        )!
      : {
          id: this.db.generateId(),
          role: "user",
          content: text,
          reasoning: "",
          createdAt: now,
          status: "complete",
        };
    if (!user) throw new Error("原始消息不存在。");
    const messages = regenerateUserId
      ? [...session.textChat.messages]
      : [...session.textChat.messages, user];
    const turns = conversationContext(messages, user.id);
    if (session.textChat.systemPrompt.trim())
      turns.unshift({ role: "system", content: session.textChat.systemPrompt });
    if (turns.reduce((n, t) => n + t.content.length, 0) > 800000)
      throw new Error("当前对话上下文较长，请新建对话或缩短内容。");
    const assistant: TextMessage = {
      id: this.db.generateId(),
      role: "assistant",
      content: "",
      reasoning: "",
      createdAt: now + 1,
      status: "pending",
      replyTo: user.id,
      model: session.sessionModel,
    };
    messages.push(assistant);
    const controller = new AbortController();
    this.requests.set(id, controller);
    this.emit({ running: new Set(this.requests.keys()) });
    this.replace({
      ...session,
      updatedAt: now,
      title: session.textChat.messages.length
        ? session.title
        : this.db.generateTitle(user.content),
      messageCount: messages.length,
      textChat: { ...session.textChat, draft: "", messages },
    });
    const epoch = this.epoch;
    let pending: Partial<TextMessage> | undefined,
      renderTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(renderTimer);
      renderTimer = undefined;
      if (pending && epoch === this.epoch) {
        this.updateMessage(id, assistant.id, pending);
        pending = undefined;
        this.scheduleSave(id);
      }
    };
    try {
      // Never submit a paid request before the user turn is durably saved.
      await this.save(id);
      controller.signal.throwIfAborted();
      const result = await this.request({
        model:
          session.sessionModelRef ||
          (session.sessionModel
            ? { profileId: null, modelId: session.sessionModel }
            : null),
        turns,
        maxOutput: session.textChat.maxOutput,
        signal: controller.signal,
        onUpdate: (data) => {
          if (epoch !== this.epoch || controller.signal.aborted) return;
          pending = { ...data, status: "streaming" };
          if (!renderTimer) renderTimer = setTimeout(flush, 40);
        },
      });
      flush();
      if (epoch === this.epoch)
        this.updateMessage(id, assistant.id, {
          ...result,
          status: controller.signal.aborted ? "stopped" : "complete",
        });
    } catch (error) {
      flush();
      if (epoch === this.epoch)
        this.updateMessage(id, assistant.id, {
          status: controller.signal.aborted ? "stopped" : "error",
          error: controller.signal.aborted
            ? undefined
            : error instanceof Error
              ? error.message
              : "回复失败，请重试。",
        });
    } finally {
      clearTimeout(renderTimer);
      if (epoch === this.epoch) {
        this.requests.delete(id);
        this.emit({ running: new Set(this.requests.keys()) });
        await this.save(id).catch(() => {});
      }
    }
  };
  flush = async () => {
    await Promise.all(
      [
        ...new Set([
          ...this.timers.keys(),
          ...this.requests.keys(),
          ...this.saves.keys(),
          ...this.snapshot.saveErrors,
        ]),
      ].map((id) => this.save(id)),
    );
  };
  reload = async () => {
    if (this.requests.size)
      throw new Error("请先停止文本回复，再恢复会话备份。");
    this.reset();
    this.init = undefined;
    this.emit({ ready: false });
    await this.initialize();
  };
  reset = () => {
    this.epoch++;
    this.requests.forEach((c) => c.abort());
    this.requests.clear();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.emit({
      sessions: [],
      ready: true,
      running: new Set(),
      saveErrors: new Set(),
      error: null,
    });
  };
}
export const textChatRuntime = new TextChatRuntime();
if (typeof window !== "undefined") {
  window.addEventListener("aitu-chat-cleared", textChatRuntime.reset);
  window.addEventListener("pagehide", () => {
    void textChatRuntime.flush().catch(() => {});
  });
}
