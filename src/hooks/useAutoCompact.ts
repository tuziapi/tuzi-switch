import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Detects whether the container's children overflow the available width
 * and returns a `compact` flag for the AppSwitcher.
 *
 * Uses ResizeObserver on a flex-constrained container. The container
 * must have `flex-1 min-w-0 overflow-hidden` so its width is determined
 * by the parent layout, not its own content — avoiding the oscillation
 * problem when toggling compact mode.
 */
export function useAutoCompact(
  containerRef: RefObject<HTMLDivElement | null>,
  layoutKey?: string,
): boolean {
  const [compact, setCompact] = useState(false);
  const normalWidthRef = useRef(0);
  const lockUntilRef = useRef(0);

  // Account and individual tools have different toolbar actions. A width cached
  // for the previous layout must not keep a shorter toolbar collapsed.
  useLayoutEffect(() => {
    normalWidthRef.current = 0;
    lockUntilRef.current = 0;
    setCompact(false);
  }, [layoutKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pendingMeasure: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      clearTimeout(pendingMeasure);
      // During expand animation, ignore resize events to prevent flicker
      const remaining = lockUntilRef.current - Date.now();
      if (remaining > 0) {
        pendingMeasure = setTimeout(measure, remaining);
        return;
      }

      if (!compact) {
        // Overflow detected → switch to compact
        if (el.scrollWidth > el.clientWidth + 1) {
          // Cache only at the overflow edge: when content fits,
          // scrollWidth === clientWidth (DOM spec), so caching unconditionally
          // would pollute normalWidthRef with the container width (e.g. after
          // maximizing), making the expand threshold unreachable.
          normalWidthRef.current = el.scrollWidth;
          setCompact(true);
        }
      } else if (normalWidthRef.current > 0) {
        // In compact mode: only recover to normal if
        // available space >= what normal mode needed
        if (el.clientWidth >= normalWidthRef.current) {
          // Lock out resize events during the expand animation (200ms + 50ms margin)
          lockUntilRef.current = Date.now() + 250;
          setCompact(false);
        }
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Tool actions are replaced after their exit animation. Their width can
    // change while the available container width stays exactly the same.
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    measure();
    return () => {
      ro.disconnect();
      clearTimeout(pendingMeasure);
    };
  }, [compact, layoutKey]);

  return compact;
}
