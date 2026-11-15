import { canRetryDiscussion } from "./conversation";
import { ensureAssistantCreationConfigured } from '../assistant-creation-setup';
import { chatStorageService as storage } from "../chat-storage-service";
import { requestTextChat, type TextChatRequest } from "./request";
import { localCodex } from "./local-codex";
import {
  conversationContext,
  newTextState,
  restoreTextConversation,
  type TextConversation,
  type TextMessage,
} from "./conversation";
import type { DiscussionSubmission } from "./discussion";
import type { ModelRef } from "../../utils/settings-manager";
import {
  validateAttachmentRefs,
  removeTextAttachment,
  type TextAttachmentRef,
} from "./attachments";

interface Snapshot {
  sessions: TextConversation[];
  activeId?: string | null;
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
  private discussionCreation = new Map<string, Promise<string>>();
  select = (id: string | null) => {
    if (id) this.get(id);
    this.emit({ activeId: id });
    storage.setDrawerState?.({ textActiveSessionId: id });
  };
  ensureDiscussion = (boardId: string, model: ModelRef | null): Promise<string> => {
    if (!boardId) return Promise.reject(new Error("请先打开画板。"));
    const pending = this.discussionCreation.get(boardId);
    if (pending) return pending;
    const epoch = this.epoch;
    const create = (async () => {
      await this.initialize();
      if (epoch !== this.epoch) throw new Error("会话已重置。");
      const active = this.snapshot.sessions.find(s => s.id === this.snapshot.activeId && s.textChat.linkedBoardId === boardId && s.textChat.executionMode === "agent");
      const existing = active || this.snapshot.sessions.find(s => s.textChat.linkedBoardId === boardId && s.textChat.executionMode === "agent");
      if (existing) return existing.id;
      const id = await this.create(model);
      if (epoch !== this.epoch) throw new Error("会话已重置。");
      this.configure(id, {}, { executionMode: "agent", linkedBoardId: boardId });
      await this.save(id);
      return id;
    })();
    this.discussionCreation.set(boardId, create);
    void create.finally(() => { if (this.discussionCreation.get(boardId) === create) this.discussionCreation.delete(boardId); }).catch(() => {});
    return create;
  };
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
      if (this.snapshot.saveErrors.has(id)) {
        const saveErrors = new Set(this.snapshot.saveErrors);
        saveErrors.delete(id);
        this.emit({ saveErrors });
      }
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
  addDraftAttachment = async (id: string, ref: TextAttachmentRef) => {
    const refs = [...(this.get(id).textChat.draftAttachments || []), ref];
    validateAttachmentRefs(refs);
    this.configure(id, {}, { draftAttachments: refs });
    await this.save(id);
  };
  removeDraftAttachment = async (id: string, attachmentId: string) => {
    const current = this.get(id);
    this.configure(
      id,
      {},
      {
        draftAttachments: (current.textChat.draftAttachments || []).filter(
          (a) => a.id !== attachmentId,
        ),
      },
    );
    // Keep the payload if durable removal fails, so the previous saved draft is recoverable.
    await this.save(id);
    if (
      !this.get(id).textChat.messages.some((m) =>
        m.attachments?.some((a) => a.id === attachmentId),
      )
    )
      await removeTextAttachment(attachmentId);
  };
  canSend = (id: string): boolean => {
    const session = this.get(id);
    const discussion = session.textChat.executionMode === 'agent' && session.textChat.linkedBoardId;
    return ensureAssistantCreationConfigured('text', session.sessionModelRef || session.sessionModel,
      Boolean(discussion && localCodex.selection()));
  };
  send = async (id: string, content: string, regenerateUserId?: string, submission: DiscussionSubmission = {}) => {
    if (this.requests.has(id)) return;
    if (!this.canSend(id)) return;
    const session = this.get(id);
    const discussion = session.textChat.executionMode === "agent" && session.textChat.linkedBoardId;
    const codex = discussion ? localCodex.selection() : undefined;
    if (discussion && regenerateUserId) {
      const previous = session.textChat.messages.filter(m => m.replyTo === regenerateUserId).at(-1);
      const original = session.textChat.messages.find(m => m.id === regenerateUserId);
      if (!previous || !canRetryDiscussion(previous) || original?.origin === "canvas")
        throw new Error("此讨论不能直接重试，请发送新消息并重新选择画布引用，避免重复提交生成任务。");
    }
    const text = content.trim();
    const attachments = submission.origin === "canvas" ? [] : session.textChat.draftAttachments || [];
    validateAttachmentRefs(attachments);
    if (!regenerateUserId && !text && !attachments.length) return;
    if (text.length > 200000) throw new Error("单条消息过长，请分段发送。");
    const now = Date.now();
    const user: TextMessage = regenerateUserId
      ? session.textChat.messages.find(
          (m) => m.id === regenerateUserId && m.role === "user",
        )!
      : {
          id: this.db.generateId(),
          role: "user",
          ...(discussion ? { origin: submission.origin || "sidebar" } : {}),
          content: text,
          reasoning: "",
          createdAt: now,
          status: "complete",
          ...(attachments.length ? { attachments } : {}),
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
      model: codex ? `Codex · ${codex.model}` : session.sessionModel,
      ...(discussion ? { discussion: { boardId: discussion, runId: this.db.generateId(), taskIds: [], submission: "not_started" } } : {}),
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
        : this.db.generateTitle(
            user.content || user.attachments?.[0]?.name || "附件对话",
          ),
      messageCount: messages.length,
      textChat: {
        ...session.textChat,
        draft: regenerateUserId || submission.origin === "canvas" ? session.textChat.draft : "",
        draftAttachments: regenerateUserId || submission.origin === "canvas"
          ? session.textChat.draftAttachments
          : [],
        messages,
      },
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
      const request: TextChatRequest = {
        codex,
        sessionId: id,
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
      };
      const result = assistant.discussion
        ? await (await import("./discussion")).requestDiscussion({
            ...request, link: assistant.discussion, messageId: assistant.id, context: submission.context,
            onPlan: async (plan) => {
              controller.signal.throwIfAborted();
              if (epoch !== this.epoch) throw new DOMException("讨论已切换", "AbortError");
              this.updateMessage(id, assistant.id, { discussion: { ...assistant.discussion!, plan } });
              await this.save(id);
            },
            onBeforeSubmit: async () => {
              controller.signal.throwIfAborted();
              if (epoch !== this.epoch) throw new DOMException("讨论已切换", "AbortError");
              this.updateMessage(id, assistant.id, { discussion: { ...assistant.discussion!, submission: "started" } });
              await this.save(id);
              controller.signal.throwIfAborted();
            },
            onTasks: async (taskIds) => {
              if (epoch !== this.epoch) return;
              this.updateMessage(id, assistant.id, { discussion: { ...assistant.discussion!, taskIds, submission: "started" } });
              await this.save(id);
            },
          })
        : await this.request(request);
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
  decidePlan = async (id: string, messageId: string, execute: boolean) => {
    if (this.requests.has(id)) return;
    const message = this.get(id).textChat.messages.find(m => m.id === messageId);
    const link = message?.discussion;
    if (!link?.plan || link.plan.status !== "ready" || link.submission !== "not_started" || link.taskIds.length)
      throw new Error("此计划已经提交或不可执行。");
    if (!execute) {
      this.updateMessage(id, messageId, { discussion: { ...link, plan: { ...link.plan, status: "cancelled" } } });
      await this.save(id);
      return;
    }
    const controller = new AbortController();
    this.requests.set(id, controller);
    this.emit({ running: new Set(this.requests.keys()) });
    const epoch = this.epoch;
    let currentLink = link;
    try {
      const { workspaceService } = await import('../workspace-service');
      if (workspaceService.getState().currentBoardId !== link.boardId) throw new Error("请先返回这段讨论所属的画板再执行。");
      const { executeDiscussionPlan } = await import('./discussion');
      await executeDiscussionPlan({
        sessionId: id, messageId, link, signal: controller.signal,
        onBeforeSubmit: async () => {
          controller.signal.throwIfAborted();
          if (epoch !== this.epoch) throw new DOMException("讨论已切换", "AbortError");
          currentLink = { ...currentLink, submission: "started", plan: { ...link.plan!, status: "started" } };
          this.updateMessage(id, messageId, { discussion: currentLink, status: "streaming", error: undefined });
          await this.save(id);
          controller.signal.throwIfAborted();
        },
        onTasks: async (taskIds) => {
          if (epoch !== this.epoch) return;
          currentLink = { ...currentLink, taskIds };
          this.updateMessage(id, messageId, { discussion: currentLink });
          await this.save(id);
        },
      }, link.plan);
      if (epoch === this.epoch) this.updateMessage(id, messageId, { status: "complete" });
    } catch (e) {
      if (epoch === this.epoch) this.updateMessage(id, messageId, { status: controller.signal.aborted ? "stopped" : "error", error: controller.signal.aborted ? undefined : (e as Error).message });
    } finally {
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
    this.discussionCreation.clear();
    this.requests.forEach((c) => c.abort());
    this.requests.clear();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.emit({
      sessions: [],
      activeId: null,
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
