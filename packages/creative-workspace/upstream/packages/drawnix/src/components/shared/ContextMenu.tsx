import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import './context-menu.scss';

const CONTEXT_MENU_VIEWPORT_PADDING = 8;
const CONTEXT_SUBMENU_OFFSET = 6;

type MaybeValue<TValue, TPayload> =
  | TValue
  | ((payload: TPayload) => TValue);

export interface ContextMenuState<TPayload> {
  x: number;
  y: number;
  payload: TPayload;
}

interface ContextMenuBaseEntry {
  key: string;
}

export interface ContextMenuDividerEntry extends ContextMenuBaseEntry {
  type: 'divider';
}

export interface ContextMenuActionEntry<TPayload>
  extends ContextMenuBaseEntry {
  type?: 'action';
  label: MaybeValue<React.ReactNode, TPayload>;
  icon?: MaybeValue<React.ReactNode, TPayload>;
  danger?: MaybeValue<boolean, TPayload>;
  disabled?: MaybeValue<boolean, TPayload>;
  onSelect?: (payload: TPayload) => void;
}

export interface ContextMenuSubmenuEntry<TPayload>
  extends ContextMenuBaseEntry {
  type: 'submenu';
  label: MaybeValue<React.ReactNode, TPayload>;
  icon?: MaybeValue<React.ReactNode, TPayload>;
  danger?: MaybeValue<boolean, TPayload>;
  disabled?: MaybeValue<boolean, TPayload>;
  children: MaybeValue<ContextMenuEntry<TPayload>[], TPayload>;
}

export type ContextMenuEntry<TPayload> =
  | ContextMenuDividerEntry
  | ContextMenuActionEntry<TPayload>
  | ContextMenuSubmenuEntry<TPayload>;

interface ContextMenuProps<TPayload> {
  state: ContextMenuState<TPayload> | null;
  items:
    | ContextMenuEntry<TPayload>[]
    | ((payload: TPayload) => ContextMenuEntry<TPayload>[]);
  onClose: () => void;
  className?: string;
  zIndex?: number;
}

function resolveMaybeValue<TValue, TPayload>(
  value: MaybeValue<TValue, TPayload> | undefined,
  payload: TPayload
): TValue | undefined {
  if (typeof value === 'function') {
    return (value as (payload: TPayload) => TValue)(payload);
  }
  return value;
}

function resolveEntries<TPayload>(
  items:
    | ContextMenuEntry<TPayload>[]
    | ((payload: TPayload) => ContextMenuEntry<TPayload>[]),
  payload: TPayload
): ContextMenuEntry<TPayload>[] {
  return typeof items === 'function' ? items(payload) : items;
}

function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight
): { x: number; y: number } {
  const maxX = Math.max(
    CONTEXT_MENU_VIEWPORT_PADDING,
    viewportWidth - width - CONTEXT_MENU_VIEWPORT_PADDING
  );
  const maxY = Math.max(
    CONTEXT_MENU_VIEWPORT_PADDING,
    viewportHeight - height - CONTEXT_MENU_VIEWPORT_PADDING
  );

  return {
    x: Math.min(Math.max(CONTEXT_MENU_VIEWPORT_PADDING, x), maxX),
    y: Math.min(Math.max(CONTEXT_MENU_VIEWPORT_PADDING, y), maxY),
  };
}

function ContextMenuPanel<TPayload>({
  entries,
  payload,
  x,
  y,
  zIndex,
  onCloseAll,
  className,
}: {
  entries: ContextMenuEntry<TPayload>[];
  payload: TPayload;
  x: number;
  y: number;
  zIndex: number;
  onCloseAll: () => void;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const element = panelRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    // The unified host contains layout/paint, so fixed coordinates are relative
    // to its creative root, while MouseEvent coordinates are viewport-relative.
    const root = element.closest('.creative-root')?.getBoundingClientRect();
    const next = clampPosition(
      x - (root?.left || 0), y - (root?.top || 0), rect.width, rect.height,
      root ? Math.min(root.width, window.innerWidth - root.left) : window.innerWidth,
      root ? Math.min(root.height, window.innerHeight - root.top) : window.innerHeight,
    );
    if (next.x !== position.x || next.y !== position.y) {
      setPosition(next);
    }
  }, [entries, position.x, position.y, x, y]);

  return (
    <div
      ref={panelRef}
      className={['context-menu', className].filter(Boolean).join(' ')}
      style={{
        left: position.x,
        top: position.y,
        zIndex,
      }}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {entries.map((entry) => {
        if (entry.type === 'divider') {
          return (
            <div
              key={entry.key}
              className="context-menu__divider"
              role="separator"
            />
          );
        }

        if (entry.type === 'submenu') {
          return (
            <ContextMenuSubmenuItem
              key={entry.key}
              entry={entry}
              payload={payload}
              zIndex={zIndex + 1}
              onCloseAll={onCloseAll}
            />
          );
        }

        const disabled = !!resolveMaybeValue(entry.disabled, payload);
        const danger = !!resolveMaybeValue(entry.danger, payload);
        const icon = resolveMaybeValue(entry.icon, payload);
        const label = resolveMaybeValue(entry.label, payload);

        return (
          <button
            key={entry.key}
            type="button"
            className={[
              'context-menu__item',
              danger ? 'context-menu__item--danger' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={disabled}
            role="menuitem"
            onClick={() => {
              if (disabled) return;
              onCloseAll();
              entry.onSelect?.(payload);
            }}
          >
            {icon ? <span className="context-menu__icon">{icon}</span> : null}
            <span className="context-menu__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ContextMenuSubmenuItem<TPayload>({
  entry,
  payload,
  zIndex,
  onCloseAll,
}: {
  entry: ContextMenuSubmenuEntry<TPayload>;
  payload: TPayload;
  zIndex: number;
  onCloseAll: () => void;
}) {
  const itemRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null
  );

  const disabled = !!resolveMaybeValue(entry.disabled, payload);
  const danger = !!resolveMaybeValue(entry.danger, payload);
  const icon = resolveMaybeValue(entry.icon, payload);
  const label = resolveMaybeValue(entry.label, payload);
  const children = useMemo(
    () => resolveMaybeValue(entry.children, payload) || [],
    [entry.children, payload]
  );

  const updatePosition = useCallback(() => {
    const item = itemRef.current;
    if (!item) return;

    const rect = item.getBoundingClientRect();
    const approxWidth = 220;
    const placeLeft =
      rect.right + CONTEXT_SUBMENU_OFFSET + approxWidth >
      window.innerWidth - CONTEXT_MENU_VIEWPORT_PADDING;

    setPosition({
      x: placeLeft
        ? rect.left - approxWidth - CONTEXT_SUBMENU_OFFSET
        : rect.right + CONTEXT_SUBMENU_OFFSET,
      y: rect.top,
    });
  }, []);

  const handleOpen = useCallback(() => {
    if (disabled || children.length === 0) return;
    updatePosition();
    setOpen(true);
  }, [children.length, disabled, updatePosition]);

  return (
    <div
      className="context-menu__submenu"
      onMouseEnter={handleOpen}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={itemRef}
        type="button"
        className={[
          'context-menu__item',
          danger ? 'context-menu__item--danger' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          handleOpen();
        }}
      >
        {icon ? <span className="context-menu__icon">{icon}</span> : null}
        <span className="context-menu__label">{label}</span>
        <ChevronRight
          size={14}
          className="context-menu__submenu-indicator"
        />
      </button>

      {open && position ? (
        <ContextMenuPanel
          entries={children}
          payload={payload}
          x={position.x}
          y={position.y}
          zIndex={zIndex}
          onCloseAll={onCloseAll}
          className="context-menu__submenu-panel"
        />
      ) : null}
    </div>
  );
}

export function useContextMenuState<TPayload>() {
  const [contextMenu, setContextMenu] =
    useState<ContextMenuState<TPayload> | null>(null);

  const open = useCallback(
    (event: Pick<React.MouseEvent, 'clientX' | 'clientY'>, payload: TPayload) => {
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        payload,
      });
    },
    []
  );

  const openAt = useCallback((x: number, y: number, payload: TPayload) => {
    setContextMenu({ x, y, payload });
  }, []);

  const close = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    contextMenu,
    open,
    openAt,
    close,
    setContextMenu,
  };
}

export function ContextMenu<TPayload>({
  state,
  items,
  onClose,
  className,
  zIndex = 10000,
}: ContextMenuProps<TPayload>) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose, state]);

  if (!state) {
    return null;
  }

  const entries = resolveEntries(items, state.payload);

  return createPortal(
    <div ref={rootRef}>
      <ContextMenuPanel
        entries={entries}
        payload={state.payload}
        x={state.x}
        y={state.y}
        zIndex={zIndex}
        onCloseAll={onClose}
        className={className}
      />
    </div>,
    (document.getElementById('creative-portals') || document.body)
  );
}
