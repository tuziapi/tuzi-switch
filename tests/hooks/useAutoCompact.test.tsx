import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCompact } from "@/hooks/useAutoCompact";

afterEach(() => vi.unstubAllGlobals());

describe("toolbar auto compact", () => {
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
