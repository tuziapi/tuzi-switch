import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isNativeRenderEnvironment } from "../../utils/tauri-env";

/** WebKit does not reliably composite HTML media inside SVG foreignObject. */
export function NativeMediaOverlay({
  children,
}: {
  children: React.ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!isNativeRenderEnvironment()) return;
    const foreignObject = anchor.current?.closest("foreignObject");
    const board = foreignObject?.closest<HTMLElement>(".plait-board-container");
    const svg = foreignObject?.ownerSVGElement;
    if (!foreignObject || !board || !svg) return;
    const layer = document.createElement("div");
    layer.dataset.nativeMediaOverlay = "true";
    layer.style.cssText =
      "position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:auto;";
    board.appendChild(layer);
    let frame = 0;
    const sync = () => {
      frame = 0;
      const matrix = foreignObject.getScreenCTM();
      const rect = board.getBoundingClientRect();
      if (!matrix || !foreignObject.isConnected) {
        layer.style.display = "none";
        return;
      }
      const x = foreignObject.x.baseVal.value;
      const y = foreignObject.y.baseVal.value;
      layer.style.display =
        getComputedStyle(foreignObject).visibility === "hidden" ? "none" : "";
      layer.style.width = `${foreignObject.width.baseVal.value}px`;
      layer.style.height = `${foreignObject.height.baseVal.value}px`;
      layer.style.transform = `matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e + matrix.a * x + matrix.c * y - rect.left - board.clientLeft + board.scrollLeft},${matrix.f + matrix.b * x + matrix.d * y - rect.top - board.clientTop + board.scrollTop})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(svg, { attributes: true, subtree: true, childList: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(board);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    sync();
    setHost(layer);
    return () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      layer.remove();
    };
  }, []);
  return (
    <div
      ref={anchor}
      data-native-media-anchor="true"
      style={{ width: "100%", height: "100%" }}
    >
      {host ? createPortal(children, host) : children}
    </div>
  );
}
