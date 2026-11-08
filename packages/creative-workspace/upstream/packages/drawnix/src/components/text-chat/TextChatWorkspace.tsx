import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  ListChecks,
  Loader2,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Rabbit,
  RotateCcw,
  ScanText,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
  Code2,
  Feather,
  Lightbulb,
} from "lucide-react";
import { ModelSelector } from "../chat-drawer/ModelSelector";
import { ConfirmDialog } from "../dialog/ConfirmDialog";
import { useDrawnix } from "../../hooks/use-drawnix";
import { chatStorageService } from "../../services/chat-storage-service";
import { textChatRuntime as runtime } from "../../services/text-chat/runtime";
import {
  newTextState,
  type TextMessage,
} from "../../services/text-chat/conversation";
import {
  settingsManager,
  resolveInvocationRoute,
  createModelRef,
  type ModelRef,
} from "../../utils/settings-manager";
import { quickInsert } from "../../services/canvas-operations/canvas-insertion";
import { TextMarkdown, copyChatText } from "./TextMarkdown";
import "./text-chat.scss";

const completedReasons = new Set(["stop", "end_turn", "STOP", "stop_sequence"]);
const MessageView = memo(function MessageView({
  message,
  retryPrompt,
  busy,
  onRetry,
  onInsert,
}: {
  message: TextMessage;
  retryPrompt?: string;
  busy: boolean;
  onRetry: (userId: string) => void;
  onInsert: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copying = async () => {
    try {
      await copyChatText(message.content);
      setCopied(true);
      setCopyError("");
    } catch (e) {
      setCopyError((e as Error).message);
    }
  };
  if (message.role === "user")
    return (
      <div className="text-chat-user" data-message-id={message.id}>
        {message.content}
      </div>
    );
  const generating = ["pending", "streaming"].includes(message.status);
  return (
    <article
      className="text-chat-answer"
      data-message-id={message.id}
      data-status={message.status}
    >
      <div className="text-chat-author">
        <MessageCircle size={16} />
        <strong>{message.model || "AI 助手"}</strong>
        {generating && (
          <span>
            <Loader2 size={13} className="text-chat-spin" />
            {message.reasoning && !message.content
              ? "正在思考"
              : message.content
                ? "正在回复"
                : "等待回复"}
          </span>
        )}
      </div>
      {retryPrompt && (
        <div className="text-chat-status">重新回复：{retryPrompt}</div>
      )}
      {message.reasoning && (
        <details className="text-chat-reasoning">
          <summary>
            模型推理内容 <ChevronDown size={12} />
          </summary>
          <div>
            <TextMarkdown content={message.reasoning} />
          </div>
        </details>
      )}
      {message.content && <TextMarkdown content={message.content} />}
      {message.status === "stopped" && (
        <div className="text-chat-status">已停止 · 已保留收到的内容</div>
      )}
      {message.error && (
        <div className="text-chat-error" role="status">
          {message.error}
        </div>
      )}
      {message.status === "complete" &&
        message.finishReason &&
        !completedReasons.has(message.finishReason) && (
          <div className="text-chat-status">
            本次回复结束：
            {[
              "length",
              "max_tokens",
              "max_output_tokens",
              "MAX_TOKENS",
            ].includes(message.finishReason)
              ? "达到输出长度上限"
              : message.finishReason}
          </div>
        )}
      {!generating && (
        <div className="text-chat-message-actions">
          <button type="button" onClick={copying} disabled={!message.content}>
            {copied ? <Check /> : <Copy />}
            {copied ? "已复制" : "复制"}
          </button>
          <button
            type="button"
            disabled={busy || !message.replyTo}
            onClick={() => message.replyTo && onRetry(message.replyTo)}
          >
            <RotateCcw />
            {message.status === "error" || message.status === "interrupted"
              ? "重试"
              : "重新生成"}
          </button>
          <button
            type="button"
            disabled={!message.content}
            onClick={() => onInsert(message.content)}
          >
            <PanelLeftClose />
            插入画布
          </button>
          {message.usage?.output !== undefined && (
            <span>{message.usage.output.toLocaleString()} 输出 tokens</span>
          )}
        </div>
      )}
      {copyError && (
        <div role="status" className="text-chat-error">
          {copyError}
        </div>
      )}
    </article>
  );
});

export default function TextChatWorkspace({
  focused,
  selectedText,
  onExitFocus,
}: {
  focused: boolean;
  selectedText: string;
  onExitFocus: () => void;
}) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const [activeId, setActiveId] = useState<string | null>(
    () => chatStorageService.getDrawerState().textActiveSessionId || null,
  );
  const [defaultModel, setDefaultModel] = useState<ModelRef | null>(null);
  const [emptyState, setEmptyState] = useState(newTextState);
  const [search, setSearch] = useState("");
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 761px)").matches,
  );
  const inlineHistory = focused && wide;
  const [historyOpen, setHistoryOpen] = useState(
    () => focused && window.matchMedia("(min-width: 761px)").matches,
  );
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const historySearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 761px)");
    const resize = () => setWide(media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => setHistoryOpen(inlineHistory), [inlineHistory]);
  useEffect(() => {
    if (historyOpen && !inlineHistory) historySearchRef.current?.focus();
  }, [historyOpen, inlineHistory]);
  const closeHistory = () => {
    setHistoryOpen(false);
    historyToggleRef.current?.focus();
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const creatingInitial = useRef(false);
  const [quote, setQuote] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null);
  const followRef = useRef(true),
    submitLock = useRef(false);
  const { board, setAppState } = useDrawnix();
  const boardRef = useRef(board);
  boardRef.current = board;
  const session = snapshot.sessions.find((s) => s.id === activeId);
  const state = session?.textChat || emptyState;
  const retryPrompts = useMemo(() => {
    const users = new Map(
      state.messages
        .filter((m) => m.role === "user")
        .map((m) => [m.id, m.content]),
    );
    const seen = new Set<string>(),
      labels = new Map<string, string>();
    for (const m of state.messages) {
      if (m.role !== "assistant" || !m.replyTo) continue;
      if (seen.has(m.replyTo))
        labels.set(m.id, (users.get(m.replyTo) || "原问题").slice(0, 100));
      seen.add(m.replyTo);
    }
    return labels;
  }, [state.messages]);
  const busy = submitting || snapshot.running.has(activeId || "");
  const model = session?.sessionModelRef || defaultModel;
  const sessions = useMemo(
    () =>
      snapshot.sessions
        .filter((s) =>
          s.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [snapshot.sessions, search],
  );
  const sessionGroups = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const week = new Date(today);
    week.setDate(week.getDate() - 7);
    const groups = new Map<string, typeof sessions>();
    for (const item of sessions) {
      const label =
        item.updatedAt >= +today
          ? "今天"
          : item.updatedAt >= +yesterday
            ? "昨天"
            : item.updatedAt >= +week
              ? "近 7 天"
              : "更早";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(item);
    }
    return [...groups];
  }, [sessions]);
  useEffect(() => {
    void runtime.initialize();
    let mounted = true;
    const refresh = () => {
      if (mounted) {
        const route = resolveInvocationRoute("text");
        setDefaultModel(createModelRef(route.profileId, route.modelId));
      }
    };
    const paths = [
      "gemini",
      "providerProfiles",
      "providerCatalogs",
      "invocationPresets",
      "activePresetId",
    ];
    void settingsManager.waitForInitialization().then(refresh);
    paths.forEach((path) => settingsManager.addListener(path, refresh));
    return () => {
      mounted = false;
      paths.forEach((path) => settingsManager.removeListener(path, refresh));
      void runtime.flush().catch(() => {});
    };
  }, []);
  const select = useCallback(
    (id: string | null) => {
      setActiveId(id);
      chatStorageService.setDrawerState({ textActiveSessionId: id });
      if (!inlineHistory) setHistoryOpen(false);
      setQuote("");
      setRename(null);
      setNotice("");
      followRef.current = true;
      setAtBottom(true);
    },
    [inlineHistory],
  );
  useEffect(() => {
    if (snapshot.ready && activeId && !session && !snapshot.error) select(null);
  }, [snapshot.ready, activeId, session, snapshot.error, select]);
  // Allocate the draft's durable conversation before editing, including the first visit.
  useEffect(() => {
    if (
      !snapshot.ready ||
      snapshot.error ||
      activeId ||
      creatingInitial.current
    )
      return;
    const existing = snapshot.sessions[0];
    if (existing) {
      select(existing.id);
      return;
    }
    creatingInitial.current = true;
    void settingsManager
      .waitForInitialization()
      .then(() => {
        const route = resolveInvocationRoute("text");
        return runtime.create(createModelRef(route.profileId, route.modelId));
      })
      .then(select)
      .catch((e) => setNotice(e.message))
      .finally(() => {
        creatingInitial.current = false;
      });
  }, [snapshot.ready, snapshot.error, activeId, snapshot.sessions, select]);
  const patch = (values: Partial<typeof emptyState>) => {
    if (session) runtime.configure(session.id, {}, values);
    else setEmptyState((old) => ({ ...old, ...values }));
  };
  const onModel = (modelId: string, ref?: ModelRef | null) => {
    const next = ref || createModelRef(null, modelId);
    if (session)
      runtime.configure(session.id, {
        sessionModel: modelId,
        sessionModelRef: next,
      });
    else setDefaultModel(next);
  };
  const newSession = async () => {
    try {
      const id = await runtime.create(defaultModel);
      select(id);
      inputRef.current?.focus();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const send = async () => {
    if (submitLock.current || busy || !state.draft.trim()) return;
    submitLock.current = true;
    setSubmitting(true);
    setNotice("");
    try {
      let id = session?.id;
      if (!id) {
        id = await runtime.create(defaultModel);
        runtime.configure(id, {}, emptyState);
        select(id);
      }
      const content = quote
        ? `引用的画布文字：\n${quote}\n\n${state.draft}`
        : state.draft;
      setEmptyState(newTextState());
      setQuote("");
      followRef.current = true;
      void runtime.send(id, content).catch((e) => setNotice(e.message));
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };
  const retry = useCallback(
    (userId: string) => {
      if (activeId) {
        followRef.current = true;
        void runtime
          .send(activeId, "", userId)
          .catch((e) => setNotice(e.message));
      }
    },
    [activeId],
  );
  const insert = useCallback(
    async (text: string) => {
      const target = boardRef.current;
      if (!target) {
        setNotice("画布尚未就绪，请稍后再试。");
        return;
      }
      try {
        const result = await quickInsert(
          "text",
          text,
          undefined,
          undefined,
          undefined,
          target,
          () => boardRef.current === target,
          false,
        );
        if (!result.success) throw new Error(result.error || "插入失败");
        onExitFocus();
        setNotice("已将回复插入当前画布。");
      } catch (e) {
        setNotice((e as Error).message);
      }
    },
    [onExitFocus],
  );
  const last = state.messages.at(-1);
  useEffect(() => {
    if (followRef.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [
    last?.content,
    last?.reasoning,
    last?.status,
    state.messages.length,
    activeId,
    focused,
  ]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el?.firstElementChild || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [activeId, !!state.messages.length]);
  const scroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
    followRef.current = near;
    setAtBottom(near);
  };
  const titleSave = () => {
    if (session && rename?.trim())
      runtime.configure(session.id, { title: rename.trim().slice(0, 80) });
    setRename(null);
  };

  return (
    <div
      className={`text-chat-workspace ${focused ? "is-focused" : ""}`}
      data-testid="text-chat-workspace"
      onKeyDown={(e) => {
        if (e.key === "Escape" && historyOpen && !inlineHistory) {
          e.stopPropagation();
          closeHistory();
        }
      }}
    >
      {historyOpen && !inlineHistory && (
        <button
          type="button"
          className="text-chat-history-backdrop"
          aria-label="关闭会话侧栏"
          onClick={closeHistory}
        />
      )}
      <aside
        id="text-chat-history"
        hidden={!historyOpen}
        className={`text-chat-history ${!inlineHistory ? "is-overlay" : ""}`}
        aria-label="文本历史会话"
      >
        <div className="text-chat-history-heading">
          <strong>
            会话 <span>{snapshot.sessions.length}</span>
          </strong>
          <button
            type="button"
            aria-label="收起会话侧栏"
            title="收起会话侧栏"
            onClick={closeHistory}
          >
            <PanelLeftClose />
          </button>
        </div>
        <button
          type="button"
          className="text-chat-new"
          onClick={newSession}
          disabled={!snapshot.ready}
        >
          <Plus />
          新建对话
        </button>
        <label className="text-chat-search">
          <Search />
          <input
            ref={historySearchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索对话"
            aria-label="搜索文本对话"
          />
        </label>
        <div className="text-chat-session-list">
          {sessionGroups.map(([label, items]) => (
            <section key={label} className="text-chat-session-group">
              <h3>{label}</h3>
              {items.map((s) => (
                <div
                  key={s.id}
                  className={`text-chat-session ${s.id === activeId ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => select(s.id)}
                    title={s.title}
                    aria-label={s.title}
                    aria-current={s.id === activeId ? "true" : undefined}
                  >
                    {snapshot.running.has(s.id) ? (
                      <Loader2 className="text-chat-spin" />
                    ) : (
                      <MessageCircle />
                    )}
                    <span className="text-chat-session-copy">
                      <span>{s.title}</span>
                      <small>
                        {snapshot.running.has(s.id)
                          ? "正在回复…"
                          : s.textChat?.draft
                            ? `草稿 · ${s.textChat.draft.slice(0, 100)}`
                            : s.textChat?.messages
                                .at(-1)
                                ?.content.slice(0, 100) || "开始新的对话"}
                      </small>
                    </span>
                  </button>
                  <div className="text-chat-session-actions">
                    <button
                      type="button"
                      aria-label={`重命名 ${s.title}`}
                      title="重命名"
                      onClick={() => {
                        select(s.id);
                        setRename(s.title);
                      }}
                    >
                      <PencilLine />
                    </button>
                    <button
                      type="button"
                      className="text-chat-delete"
                      aria-label={`删除 ${s.title}`}
                      onClick={() => setDeleteId(s.id)}
                      disabled={snapshot.running.has(s.id)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          ))}
          {!sessions.length && (
            <p className="text-chat-muted">
              {search ? "没有匹配的对话" : "还没有文本对话"}
            </p>
          )}
        </div>
        <div className="text-chat-history-footer">对话保存在本机</div>
      </aside>
      <section className="text-chat-main">
        <header className="text-chat-header">
          <button
            ref={historyToggleRef}
            type="button"
            aria-label="文本会话列表"
            title={historyOpen ? "收起会话侧栏" : "展开会话侧栏"}
            aria-expanded={historyOpen}
            aria-controls="text-chat-history"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            {historyOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </button>
          <ModelSelector
            value={model?.modelId || undefined}
            valueRef={model}
            onChange={onModel}
          />
          <span className="text-chat-spacer" />
          <button
            type="button"
            aria-label="配置文本模型"
            title="打开现有创作配置"
            onClick={() => setAppState((s) => ({ ...s, openSettings: true }))}
          >
            <SlidersHorizontal />
          </button>
          <button
            type="button"
            aria-label="新建文本对话"
            onClick={newSession}
            disabled={!snapshot.ready}
          >
            <Plus />
          </button>
        </header>
        {session && (
          <div className="text-chat-title">
            {rename !== null ? (
              <input
                aria-label="会话名称"
                autoFocus
                value={rename}
                maxLength={80}
                onChange={(e) => setRename(e.target.value)}
                onBlur={titleSave}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    e.nativeEvent.keyCode !== 229
                  )
                    titleSave();
                  if (e.key === "Escape") setRename(null);
                }}
              />
            ) : (
              <button type="button" onClick={() => setRename(session.title)}>
                {session.title}
                <PencilLine />
              </button>
            )}
          </div>
        )}
        {snapshot.error && (
          <div className="text-chat-error" role="alert">
            {snapshot.error}
            <button type="button" onClick={() => void runtime.initialize()}>
              重新读取
            </button>
          </div>
        )}
        {session && snapshot.saveErrors.has(session.id) && (
          <div className="text-chat-error" role="alert">
            保存失败，请保留当前窗口。
            <button
              type="button"
              onClick={() =>
                void runtime.save(session.id).catch((e) => setNotice(e.message))
              }
            >
              重试保存
            </button>
          </div>
        )}
        <div className="text-chat-scroll" ref={scrollRef} onScroll={scroll}>
          {!snapshot.ready ? (
            <div className="text-chat-empty">
              <Loader2 className="text-chat-spin" />
              正在读取会话
            </div>
          ) : !state.messages.length ? (
            <div className="text-chat-empty">
              <div className="text-chat-emblem">
                <Rabbit />
              </div>
              <h2>从一个想法开始</h2>
              <p>写点什么，理清思路，或者聊聊你的下一个作品。</p>
              <div className="text-chat-starters">
                {[
                  [Feather, "打磨一段文字", "帮我把下面这段文字写得更自然：\n"],
                  [
                    ListChecks,
                    "梳理一个计划",
                    "帮我把这个想法整理成可执行的计划：\n",
                  ],
                  [
                    Code2,
                    "读懂一段代码",
                    "请解释下面的代码，并给出改进建议：\n",
                  ],
                  [Lightbulb, "聊聊创作灵感", "请帮我想三个不同的创作方向：\n"],
                ].map(([Icon, title, prompt]) => {
                  const Symbol = Icon as typeof Feather;
                  return (
                    <button
                      type="button"
                      key={String(title)}
                      onClick={() => {
                        patch({ draft: String(prompt) });
                        inputRef.current?.focus();
                      }}
                    >
                      <Symbol />
                      {String(title)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-chat-messages">
              {state.messages.map((message) => (
                <MessageView
                  key={message.id}
                  message={message}
                  retryPrompt={retryPrompts.get(message.id)}
                  busy={busy}
                  onRetry={retry}
                  onInsert={insert}
                />
              ))}
            </div>
          )}
        </div>
        {!atBottom && (
          <button
            type="button"
            className="text-chat-latest"
            onClick={() => {
              followRef.current = true;
              setAtBottom(true);
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            <ChevronDown />
            回到最新回复
          </button>
        )}
        {notice && (
          <div className="text-chat-notice" role="status">
            {notice}
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setNotice("")}
            >
              <X />
            </button>
          </div>
        )}
        <div className="text-chat-composer-wrap">
          {settingsOpen && (
            <div className="text-chat-settings">
              <div>
                <strong>当前对话设置</strong>
                <button
                  type="button"
                  aria-label="关闭对话设置"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X />
                </button>
              </div>
              <label>
                系统提示词
                <textarea
                  rows={3}
                  value={state.systemPrompt}
                  maxLength={20000}
                  onChange={(e) => patch({ systemPrompt: e.target.value })}
                  placeholder="例如：用简洁、自然的中文回答。"
                />
              </label>
              <label>
                最大输出长度
                <input
                  type="number"
                  min={1}
                  max={131072}
                  aria-label="最大输出长度"
                  placeholder="跟随模型默认"
                  value={state.maxOutput ?? ""}
                  onChange={(e) => {
                    const v =
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value);
                    patch({ maxOutput: v });
                  }}
                />
              </label>
              <small>仅影响后续消息；实际上限取决于所选模型。</small>
            </div>
          )}
          <div className="text-chat-composer">
            {quote && (
              <div className="text-chat-quote">
                <ScanText />
                <span>{quote.slice(0, 100)}</span>
                <button
                  type="button"
                  aria-label="移除画布引用"
                  onClick={() => setQuote("")}
                >
                  <X />
                </button>
              </div>
            )}
            <textarea
              ref={inputRef}
              aria-label="文本消息"
              disabled={!session || !snapshot.ready}
              rows={3}
              value={state.draft}
              maxLength={200000}
              onChange={(e) => patch({ draft: e.target.value })}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.nativeEvent.keyCode !== 229
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="输入消息，让想法继续…"
            />
            <div className="text-chat-composer-actions">
              <button
                type="button"
                aria-label="引用画布文字"
                title={selectedText ? "引用当前选中文字" : "请先在画布选择文字"}
                disabled={!selectedText}
                onClick={() => {
                  setQuote(selectedText.slice(0, 20000));
                  inputRef.current?.focus();
                }}
              >
                <ScanText />
              </button>
              <button
                type="button"
                aria-label="当前对话设置"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((v) => !v)}
              >
                <SlidersHorizontal />
              </button>
              <span className="text-chat-spacer" />
              {busy ? (
                <button
                  type="button"
                  className="text-chat-send"
                  aria-label="停止回复"
                  onClick={() => activeId && runtime.stop(activeId)}
                >
                  <Square />
                </button>
              ) : (
                <button
                  type="button"
                  className="text-chat-send"
                  aria-label="发送文本消息"
                  disabled={
                    !state.draft.trim() || !snapshot.ready || !!snapshot.error
                  }
                  onClick={() => void send()}
                >
                  <ArrowUp />
                </button>
              )}
            </div>
          </div>
          <div className="text-chat-footer">
            Enter 发送 · Shift + Enter 换行
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={!!deleteId}
        title="删除文本会话"
        description="确定删除这条会话及其中所有回复吗？此操作无法撤销。"
        confirmText="删除"
        cancelText="取消"
        danger
        onOpenChange={(open) => !open && setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            await runtime.remove(deleteId);
            if (activeId === deleteId) select(null);
            setDeleteId(null);
          } catch (e) {
            setNotice((e as Error).message);
            setDeleteId(null);
          }
        }}
      />
    </div>
  );
}
