import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCompact } from "@/hooks/useAutoCompact";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("toolbar auto compact", () => {
  it("detects actions appearing after exit animation without a window resize, including during expansion", () => {
    vi.useFakeTimers();
    const callbacks = new Map<Element, () => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: () => void) {}
        observe(target: Element) {
          callbacks.set(target, this.callback);
        }
        disconnect() {
          callbacks.clear();
        }
      },
    );
    const el = document.createElement("div");
    const content = document.createElement("div");
    el.append(content);
    let available = 1150;
    let required = 1100;
    Object.defineProperties(el, {
      clientWidth: { get: () => available },
      scrollWidth: { get: () => required },
    });
    const { result, rerender, unmount } = renderHook(
      ({ layout }) => useAutoCompact({ current: el }, layout),
      { initialProps: { layout: "providers:hermes" } },
    );
    expect(result.current).toBe(false);
    rerender({ layout: "providers:openclaw" });
    expect(result.current).toBe(false);
    // AnimatePresence keeps Hermes actions until the exit finishes. Only the
    // content changes size when OpenClaw's wider set of actions is mounted.
    required = 1200;
    act(() => callbacks.get(content)!());
    expect(result.current).toBe(true);

    available = 1250;
    act(() => callbacks.get(el)!());
    expect(result.current).toBe(false);
    // A resize during the expansion lock must be checked when it expires,
    // even if no further observer notification arrives.
    available = 1150;
    act(() => callbacks.get(content)!());
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(250));
    expect(result.current).toBe(true);
    available = 1300;
    act(() => callbacks.get(el)!());
    expect(result.current).toBe(false);
    act(() => callbacks.get(content)!());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("remeasures the account toolbar instead of retaining the previous tool width", () => {
    let measure: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          measure = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let available = 900;
    let required = 1100;
    const el = document.createElement("div");
    Object.defineProperties(el, {
      clientWidth: { get: () => available },
      scrollWidth: { get: () => required },
    });
    const ref = { current: el };
    const { result, rerender } = renderHook(
      ({ layout }) => useAutoCompact(ref, layout),
      {
        initialProps: { layout: "providers:claude" },
      },
    );
    act(() => measure());
    expect(result.current).toBe(true);

    // The account layout fits at the same width, even though tools did not.
    required = 850;
    rerender({ layout: "account:claude" });
    act(() => measure());
    expect(result.current).toBe(false);

    available = 800;
    act(() => measure());
    expect(result.current).toBe(true);
    available = 900;
    act(() => measure());
    expect(result.current).toBe(false);

    // Switching back must also detect the longer tool toolbar at this width.
    required = 1100;
    rerender({ layout: "providers:claude" });
    act(() => measure());
    expect(result.current).toBe(true);
  });
});
