import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeMediaOverlay } from "./native-media-overlay";
vi.mock("../../utils/tauri-env", () => ({
  isNativeRenderEnvironment: () => true,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
describe("native media overlay", () => {
  it("keeps interactive media outside foreignObject, follows geometry and releases its layer", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    let scheduled: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
      scheduled = f;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const board = document.createElement("div");
    board.className = "plait-board-container";
    document.body.append(board);
    board.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    board.append(svg);
    const fo = document.createElementNS(
      svg.namespaceURI,
      "foreignObject",
    ) as SVGForeignObjectElement;
    svg.append(fo);
    for (const [name, value] of Object.entries({
      x: 30,
      y: 40,
      width: 200,
      height: 100,
    }))
      Object.defineProperty(fo, name, {
        value: { baseVal: { value } },
        configurable: true,
      });
    fo.getScreenCTM = () =>
      ({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }) as DOMMatrix;
    const target = document.createElement("div");
    fo.append(target);
    const click = vi.fn();
    const view = render(
      <NativeMediaOverlay>
        <button onClick={click}>Play</button>
      </NativeMediaOverlay>,
      { container: target },
    );
    const layer = board.querySelector<HTMLElement>(
      "[data-native-media-overlay]",
    )!;
    expect(layer.style.transform).toBe("matrix(2,0,0,2,60,80)");
    expect(fo.querySelector("button")).toBeNull();
    layer.querySelector("button")!.click();
    expect(click).toHaveBeenCalledOnce();
    fo.x.baseVal.value = 50;
    fo.setAttribute("x", "50");
    await act(async () => {});
    act(() => scheduled?.(0));
    expect(layer.style.transform).toBe("matrix(2,0,0,2,100,80)");
    view.unmount();
    expect(board.querySelector("[data-native-media-overlay]")).toBeNull();
  });
});
