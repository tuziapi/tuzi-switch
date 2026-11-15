import { afterEach, describe, expect, it, vi } from "vitest";
import { mountNativeImageOverlay } from "../../packages/creative-workspace/upstream/packages/drawnix/src/plugins/components/native-image-overlay";
import { isNativeRenderEnvironment } from "../../packages/creative-workspace/upstream/packages/drawnix/src/utils/tauri-env";
import { isTauriEnvironment } from "../../packages/creative-workspace/upstream/packages/drawnix/src/utils/desktop-asset-url";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function fixture() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const foreignObject = document.createElementNS(
    svg.namespaceURI,
    "foreignObject",
  );
  for (const [name, value] of Object.entries({
    x: 20,
    y: 30,
    width: 400,
    height: 200,
  })) {
    foreignObject.setAttribute(name, String(value));
  }
  svg.append(foreignObject);
  document.body.append(svg);
  return { svg, foreignObject };
}

describe("desktop canvas image rendering", () => {
  it("enables the SVG workaround in the unified host without enabling old filesystem commands", () => {
    vi.stubGlobal("__TUZI_CREATIVE_NATIVE__", undefined);
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    expect(isNativeRenderEnvironment()).toBe(true);
    expect(isTauriEnvironment()).toBe(false);
  });

  it("keeps browser rendering and standalone desktop detection", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", undefined);
    vi.stubGlobal("__TUZI_CREATIVE_NATIVE__", undefined);
    expect(isNativeRenderEnvironment()).toBe(false);
    vi.stubGlobal("__TUZI_CREATIVE_NATIVE__", {});
    expect(isNativeRenderEnvironment()).toBe(true);
  });

  it("waits for paintable SVG content, restores the fallback on error and cleans up", async () => {
    const { svg, foreignObject } = fixture();
    const cleanup = mountNativeImageOverlay(
      foreignObject,
      "blob:synthetic-result",
    );
    const image = svg.querySelector("image");
    expect(image.getAttribute("href")).toBe("blob:synthetic-result");
    expect(foreignObject.style.visibility).toBe("");
    image.dispatchEvent(new Event("load"));
    expect(foreignObject.style.visibility).toBe("hidden");
    foreignObject.setAttribute("width", "640");
    foreignObject.setAttribute("x", "120");
    await Promise.resolve();
    expect(image.getAttribute("width")).toBe("640");
    expect(image.getAttribute("x")).toBe("120");
    image.dispatchEvent(new Event("error"));
    expect(foreignObject.style.visibility).toBe("");
    cleanup();
    image.dispatchEvent(new Event("load"));
    expect(foreignObject.style.visibility).toBe("");
    expect(svg.querySelector("image")).toBeNull();
  });

  it("preserves frame fitting, hidden layers, opacity and original visibility", () => {
    const { svg, foreignObject } = fixture();
    foreignObject.style.visibility = "collapse";
    const cleanup = mountNativeImageOverlay(
      foreignObject,
      "blob:synthetic-result",
      {
        contain: true,
        hidden: true,
        opacity: 0.4,
      },
    );
    const image = svg.querySelector("image");
    expect(image.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(image.getAttribute("visibility")).toBe("hidden");
    expect(image.getAttribute("opacity")).toBe("0.4");
    cleanup();
    expect(foreignObject.style.visibility).toBe("collapse");
  });
});
