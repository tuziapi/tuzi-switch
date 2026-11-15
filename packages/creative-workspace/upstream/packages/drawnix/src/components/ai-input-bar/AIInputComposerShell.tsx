import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import { Dialog, DialogContent } from '../dialog/dialog';

export type AIInputComposerVariant = 'canvas' | 'drawer';

export interface AIInputComposerShellProps {
  variant?: AIInputComposerVariant;
  expanded?: boolean;
  longText?: boolean;
  disabled?: boolean;
  className?: string;
  preview?: React.ReactNode;
  status?: React.ReactNode;
  discussionExpanded?: boolean;
  onCloseDiscussion?: () => void;
  textarea: React.ReactNode;
  leftTools?: React.ReactNode;
  controls?: React.ReactNode;
  sendButton: React.ReactNode;
  onDragEnter?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}

// Move a stable portal host instead of remounting the composer/transcript when
// switching sizes. Draft, selection, scrolling and streaming share one UI tree.
function CanvasComposerSurface({ expanded, onClose, children }: {
  expanded: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'ai-input-composer-mount';
    return element;
  });
  const initialFocus = useRef<HTMLElement | null>(null);
  const mount = useCallback((target: HTMLDivElement | null) => {
    if (target) {
      target.appendChild(host);
      initialFocus.current = host.querySelector('[data-testid="ai-input-textarea"]');
    }
  }, [host]);
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    const restored = wasExpanded.current && !expanded;
    wasExpanded.current = expanded;
    if (!restored) return;
    const frame = requestAnimationFrame(() => {
      const button = host.querySelector<HTMLButtonElement>('[aria-label="展开阅读"]') ||
        host.querySelector<HTMLButtonElement>('.discussion-strip__open');
      button?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, host]);
  return <>
    {!expanded && <div className="ai-input-composer-slot" ref={mount} />}
    <Dialog open={expanded} onOpenChange={(value) => { if (!value) onClose?.(); }}>
      <DialogContent
        className="ai-input-bar attached-discussion-modal"
        data-testid="attached-discussion-modal"
        data-composer-dialog="true"
        initialFocus={initialFocus}
        aria-label="画板创作讨论大窗口"
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="attached-discussion-modal__panel" ref={mount} />
      </DialogContent>
    </Dialog>
    {createPortal(children, host)}
  </>;
}

export const AIInputComposerShell: React.FC<AIInputComposerShellProps> = ({
  variant = 'canvas',
  expanded = false,
  longText = false,
  disabled = false,
  className,
  preview,
  status,
  discussionExpanded = false,
  onCloseDiscussion,
  textarea,
  leftTools,
  controls,
  sendButton,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  const content = (
    <div
      className={classNames(
        'ai-input-bar__container',
        'ai-input-composer-shell',
        `ai-input-composer-shell--${variant}`,
        {
          'ai-input-composer-shell--discussion': Boolean(status),
          'ai-input-bar__container--expanded': expanded,
          'ai-input-composer-shell--expanded': expanded,
          'ai-input-composer-shell--disabled': disabled,
        },
        className
      )}
      aria-disabled={disabled || undefined}
      data-testid={`ai-input-composer-shell-${variant}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="ai-input-bar__bottom-bar ai-input-composer-shell__bottom-bar">
        {leftTools ? (
          <div className="ai-input-bar__bottom-start ai-input-composer-shell__bottom-start">
            {leftTools}
          </div>
        ) : null}

        {controls ? (
          <div className="ai-input-bar__bottom-controls ai-input-composer-shell__bottom-controls">
            {controls}
          </div>
        ) : null}

        {sendButton}
      </div>

      <div
        className={classNames(
          'ai-input-bar__input-area',
          'ai-input-composer-shell__input-area',
          {
            'ai-input-bar__input-area--expanded': expanded,
            'ai-input-bar__input-area--long-text': longText,
            'ai-input-composer-shell__input-area--expanded': expanded,
            'ai-input-composer-shell__input-area--long-text': longText,
          }
        )}
      >
        {preview ? (
          <div className="ai-input-bar__content-preview ai-input-composer-shell__preview">
            {preview}
          </div>
        ) : null}

        <div className="ai-input-bar__prompt-row ai-input-composer-shell__prompt-row">
          {textarea}
        </div>
      </div>
      {status}
    </div>
  );
  return variant === 'canvas' ? (
    <CanvasComposerSurface expanded={discussionExpanded} onClose={onCloseDiscussion}>
      {content}
    </CanvasComposerSurface>
  ) : content;
};

export default AIInputComposerShell;
