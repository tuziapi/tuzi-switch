import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export type DropdownPlacement = 'up' | 'down' | 'auto';
export type ResolvedDropdownPlacement = Exclude<DropdownPlacement, 'auto'>;

export interface KeyboardDropdownRenderProps {
  isOpen: boolean;
  setIsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  menuRef: React.RefObject<HTMLDivElement>;
  portalPosition: { top: number; left: number; width: number; bottom: number };
  menuStyle: React.CSSProperties;
  resolvedPlacement: ResolvedDropdownPlacement;
  availableHeight: number;
  handleTriggerKeyDown: (event: React.KeyboardEvent) => void;
}

export interface KeyboardDropdownProps {
  isOpen: boolean;
  setIsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  disabled?: boolean;
  openKeys?: string[];
  onOpenKey?: (key: string) => boolean;
  trackPosition?: boolean;
  placement?: DropdownPlacement;
  offset?: number;
  viewportPadding?: number;
  minMenuHeight?: number;
  maxMenuHeight?: number;
  children: (props: KeyboardDropdownRenderProps) => React.ReactNode;
}

const INPUT_TEXTAREA_CLASS = 'ai-input-bar__input';
const DEFAULT_OFFSET = 8;
const DEFAULT_VIEWPORT_PADDING = 12;
const DEFAULT_MIN_MENU_HEIGHT = 80;
const DEFAULT_MAX_MENU_HEIGHT = 420;
const ZERO_PORTAL_POSITION = { top: 0, left: 0, width: 0, bottom: 0 };
const DEBUG_FLAG = 'aitu:debug-dropdown';

interface DropdownLayout {
  portalPosition: KeyboardDropdownRenderProps['portalPosition'];
  menuStyle: React.CSSProperties;
  resolvedPlacement: ResolvedDropdownPlacement;
  availableHeight: number;
}

const DEFAULT_LAYOUT: DropdownLayout = {
  portalPosition: ZERO_PORTAL_POSITION,
  menuStyle: {
    position: 'fixed',
    left: 0,
    top: 0,
    maxHeight: DEFAULT_MIN_MENU_HEIGHT,
    overflowY: 'auto',
  },
  resolvedPlacement: 'down',
  availableHeight: 0,
};

function isComposingEvent(
  event: Pick<KeyboardEvent, 'isComposing'> & { keyCode?: number }
): boolean {
  return event.isComposing || event.keyCode === 229;
}

function shouldDebugDropdown(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage?.getItem(DEBUG_FLAG) === '1';
}

export const KeyboardDropdown: React.FC<KeyboardDropdownProps> = ({
  isOpen,
  setIsOpen,
  disabled = false,
  openKeys = [],
  onOpenKey,
  trackPosition = true,
  placement = 'auto',
  offset = DEFAULT_OFFSET,
  viewportPadding = DEFAULT_VIEWPORT_PADDING,
  minMenuHeight = DEFAULT_MIN_MENU_HEIGHT,
  maxMenuHeight = DEFAULT_MAX_MENU_HEIGHT,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<DropdownLayout>(DEFAULT_LAYOUT);

  const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (isComposingEvent(event.nativeEvent)) {
      return;
    }

    if (isOpen) {
      if (!onOpenKey) return;
      const handled = onOpenKey(event.key);
      if (handled) {
        event.preventDefault();
      }
      return;
    }

    if (openKeys.includes(event.key)) {
      event.preventDefault();
      if (!disabled) {
        setIsOpen(true);
      }
    }
  }, [isOpen, onOpenKey, openKeys, disabled, setIsOpen]);

  // 菜单打开时，全局监听键盘事件（支持保持输入框焦点）
  useEffect(() => {
    if (!isOpen || !onOpenKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isComposingEvent(event)) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isInputTextarea = !!target?.classList?.contains(INPUT_TEXTAREA_CLASS);
      if (event.defaultPrevented && !isInputTextarea) return;
      const handled = onOpenKey(event.key);
      if (handled) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onOpenKey]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, setIsOpen]);

  // 计算菜单位置（仅当使用 Portal 时）
  useLayoutEffect(() => {
    if (!trackPosition || !isOpen) return;
    const updatePosition = () => {
      if (!containerRef.current) return;
      const triggerRect = containerRef.current.getBoundingClientRect();
      const host = import.meta.env.VITE_TUZI_ASSISTANT === 'true'
        ? document.getElementById('creative-portals')?.closest('.creative-root') : null;
      const hostRect = host?.getBoundingClientRect();
      const viewportHeight = hostRect?.height ?? window.innerHeight;
      const viewportWidth = hostRect?.width ?? window.innerWidth;
      const rect = {
        top: triggerRect.top - (hostRect?.top ?? 0),
        bottom: triggerRect.bottom - (hostRect?.top ?? 0),
        left: triggerRect.left - (hostRect?.left ?? 0),
        width: triggerRect.width,
      };
      const menuWidth = menuRef.current?.getBoundingClientRect().width || rect.width;
      const menuLeft = Math.max(viewportPadding, Math.min(rect.left, viewportWidth - menuWidth - viewportPadding));
      const nextPortalPosition = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        bottom: rect.bottom,
      };
      const spaceAbove = Math.max(0, rect.top - viewportPadding - offset);
      const spaceBelow = Math.max(
        0,
        viewportHeight - rect.bottom - viewportPadding - offset
      );
      const resolvedPlacement =
        placement === 'auto'
          ? spaceBelow >= maxMenuHeight || spaceBelow >= spaceAbove
            ? 'down'
            : 'up'
          : placement;
      const availableHeight =
        resolvedPlacement === 'down' ? spaceBelow : spaceAbove;
      const boundedMaxHeight = Math.max(
        0,
        Math.min(maxMenuHeight, availableHeight)
      );
      const nextMenuStyle: React.CSSProperties =
        resolvedPlacement === 'down'
          ? {
              position: 'fixed',
              left: menuLeft,
              top: rect.bottom + offset,
              maxWidth: viewportWidth - viewportPadding * 2,
              maxHeight: boundedMaxHeight,
              overflowY: 'auto',
            }
          : {
              position: 'fixed',
              left: menuLeft,
              bottom: viewportHeight - rect.top + offset,
              maxWidth: viewportWidth - viewportPadding * 2,
              maxHeight: boundedMaxHeight,
              overflowY: 'auto',
            };

      if (shouldDebugDropdown()) {
        console.debug('[KeyboardDropdown] placement', {
          requestedPlacement: placement,
          resolvedPlacement,
          rect: {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
          },
          viewportHeight: window.innerHeight,
          spaceAbove,
          spaceBelow,
          availableHeight,
          boundedMaxHeight,
          maxMenuHeight,
          minMenuHeight,
          offset,
          viewportPadding,
          menuStyle: nextMenuStyle,
        });
      }

      setLayout({
        portalPosition: nextPortalPosition,
        menuStyle: nextMenuStyle,
        resolvedPlacement,
        availableHeight,
      });
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (menuRef.current) observer.observe(menuRef.current);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [
    isOpen,
    maxMenuHeight,
    minMenuHeight,
    offset,
    placement,
    trackPosition,
    viewportPadding,
  ]);

  return (
    <>
      {children({
        isOpen,
        setIsOpen,
        containerRef,
        menuRef,
        portalPosition: layout.portalPosition,
        menuStyle: layout.menuStyle,
        resolvedPlacement: layout.resolvedPlacement,
        availableHeight: layout.availableHeight,
        handleTriggerKeyDown
      })}
    </>
  );
};

export default KeyboardDropdown;
