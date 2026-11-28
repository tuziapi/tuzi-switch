import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const COLLAPSED_WIDTH = 64;
const MIN_WIDTH = 280;
const COLLAPSE_THRESHOLD = 160;

// Layout state only: resizing never remounts the form or changes a generation task.
export function useEcommerceSidebar() {
  const rootRef = useRef<HTMLElement>(null);
  const [requestedWidth, setRequestedWidth] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ max: 640, initial: 352 });
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    previous: number | null;
  } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const available = root.getBoundingClientRect().width;
      if (!available) return;
      const initial =
        Number.parseFloat(
          getComputedStyle(root).getPropertyValue("--ec-sidebar-default-width"),
        ) || 352;
      const max = Math.max(MIN_WIDTH, Math.min(640, available - 360));
      setBounds((previous) =>
        previous.max === max && previous.initial === initial
          ? previous
          : { max, initial },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const clamp = (next: number) =>
    next <= COLLAPSE_THRESHOLD
      ? COLLAPSED_WIDTH
      : Math.min(bounds.max, Math.max(MIN_WIDTH, next));
  const width = clamp(requestedWidth ?? bounds.initial);
  const collapsed = width === COLLAPSED_WIDTH;
  const restore = () => setRequestedWidth(null);
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (cancel) setRequestedWidth(active.previous);
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && drag.current) {
      setRequestedWidth(drag.current.previous);
      const pointerId = drag.current.pointerId;
      drag.current = null;
      setResizing(false);
      if (event.currentTarget.hasPointerCapture(pointerId))
        event.currentTarget.releasePointerCapture(pointerId);
      event.preventDefault();
      return;
    }
    if (drag.current) return;
    const step = event.shiftKey ? 64 : 24;
    switch (event.key) {
      case "ArrowLeft":
        setRequestedWidth(
          width <= MIN_WIDTH ? COLLAPSED_WIDTH : clamp(width - step),
        );
        break;
      case "ArrowRight":
        setRequestedWidth(
          collapsed
            ? Math.min(bounds.initial, bounds.max)
            : clamp(width + step),
        );
        break;
      case "Home":
        setRequestedWidth(COLLAPSED_WIDTH);
        break;
      case "End":
        setRequestedWidth(bounds.max);
        break;
      case "Enter":
        restore();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return {
    rootRef,
    width,
    collapsed,
    resizing,
    restore,
    toggle: () => (collapsed ? restore() : setRequestedWidth(COLLAPSED_WIDTH)),
    separatorProps: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-label": "调整配置侧栏宽度",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": COLLAPSED_WIDTH,
      "aria-valuemax": bounds.max,
      "aria-valuenow": width,
      "aria-valuetext": collapsed
        ? "侧栏已收起，向右拖动展开"
        : `侧栏宽度 ${Math.round(width)} 像素`,
      title:
        "左右拖动调整宽度，向左拖到底收起；双击恢复默认。也可用左右方向键调整。",
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          previous: requestedWidth,
        };
        setResizing(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const active = drag.current;
        if (active?.pointerId === event.pointerId)
          setRequestedWidth(
            clamp(active.startWidth + event.clientX - active.startX),
          );
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) =>
        finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) =>
        finish(event),
      onDoubleClick: restore,
      onKeyDown,
    },
  };
}
