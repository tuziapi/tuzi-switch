import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { discussionDefaultModel } from "../../services/text-chat/discussion-ui";
import { DiscussionStrip } from "./DiscussionStrip";
import { textChatRuntime } from "../../services/text-chat/runtime";
import {
  settingsManager,
} from "../../utils/settings-manager";
import { useChatDrawerControl } from "../../contexts/ChatDrawerContext";
import { useTextSelection } from "../../hooks/useTextSelection";

const Transcript = lazy(() => import("../text-chat/TextChatWorkspace"));

/** Only this small surface subscribes to chat updates. The canvas/input stays independent. */
export function AttachedDiscussion({
  boardId,
  active,
  targetLabel,
  onDeactivate,
  onActivate,
  onPrompt,
  onOpenChange,
  open,
  reading,
  onReadingChange,
}: {
  boardId: string | null;
  active: boolean;
  targetLabel: string;
  onDeactivate: () => void;
  onActivate: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  reading: boolean;
  onReadingChange: (reading: boolean) => void;
  onPrompt: (value: string) => void;
}) {
  const { isDrawerOpen } = useChatDrawerControl();
  const setOpen = onOpenChange;
  const setReading = onReadingChange;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [height, setHeight] = useState(360);
  const root = useRef<HTMLDivElement>(null);
  const actions = useRef({ onActivate });
  actions.current = { onActivate };
  useTextSelection(root);
  const close = useCallback(() => {
    setOpen(false);
    setReading(false);
    root.current
      ?.querySelector<HTMLButtonElement>(".discussion-strip__open")
      ?.focus();
  }, [setOpen, setReading]);

  useEffect(() => {
    if (!open) setReading(false);
  }, [open, setReading]);
  useEffect(() => {
    if (isDrawerOpen) setOpen(false);
  }, [isDrawerOpen]);
  useEffect(() => {
    setOpen(false);
    setReading(false);
    setReady(false);
  }, [boardId]);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  useEffect(() => {
    const show = (event: Event) => {
      if ((event as CustomEvent).detail?.boardId !== boardId || !boardId)
        return;
      actions.current.onActivate();
      setOpen(true);
    };
    window.addEventListener("aitu:open-discussion", show);
    return () => window.removeEventListener("aitu:open-discussion", show);
  }, [boardId]);
  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false;
    setReady(false);
    setError("");
    void settingsManager
      .waitForInitialization()
      .then(async () => {
        const id = await textChatRuntime.ensureDiscussion(
          boardId,
          discussionDefaultModel(),
        );
        if (!cancelled) {
          textChatRuntime.select(id);
          setReady(true);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);
  // The panel grows upward without resizing the canvas. Re-measure only on layout changes.
  useLayoutEffect(() => {
    if (!open || reading || !root.current) return;
    const el = root.current;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setHeight(
          Math.max(
            0,
            Math.min(
              360,
              el.getBoundingClientRect().top -
                Math.max(
                  64,
                  document
                    .querySelector(".plait-board-container")
                    ?.getBoundingClientRect().top || 0,
                ) -
                12,
            ),
          ),
        ),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el.closest(".ai-input-composer-shell") || el);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame);
    };
  }, [open, reading]);

  const transcript = !ready || !boardId ? (
    <div className="attached-discussion__loading">正在读取讨论…</div>
  ) : (
    <Suspense
      fallback={
        <div className="attached-discussion__loading">正在打开讨论…</div>
      }
    >
      <Transcript
        key={boardId}
        focused={false}
        selectedText=""
        onExitFocus={close}
        attached={{
          boardId,
          targetLabel,
          reading,
          onToggleReading: () => setReading(!reading),
          onClose: close,
          onPrompt,
        }}
      />
    </Suspense>
  );

  return (
    <div
      ref={root}
      className={`attached-discussion ${open ? "is-open" : ""} ${reading ? "is-reading" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && open && !e.defaultPrevented) {
          e.preventDefault();
          close();
        }
      }}
    >
      {open && (
        <section
          id="attached-discussion-panel"
          role="region"
          aria-label="画板创作讨论"
          className="attached-discussion__panel"
          style={reading ? undefined : { height }}
          data-testid="attached-discussion-panel"
        >
          {error ? (
            <div className="attached-discussion__loading" role="alert">
              {error}
              <button type="button" onClick={close}>
                收起讨论
              </button>
            </div>
          ) : (
            transcript
          )}
        </section>
      )}
      <DiscussionStrip
        boardId={boardId}
        enabled={active}
        onDeactivate={onDeactivate}
        expanded={open}
        onOpen={() => {
          if (open) close();
          else if (boardId)
            window.dispatchEvent(
              new CustomEvent("aitu:open-discussion", { detail: { boardId } }),
            );
        }}
      />
    </div>
  );
}
