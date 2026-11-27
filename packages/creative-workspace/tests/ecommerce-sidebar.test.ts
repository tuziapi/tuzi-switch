import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEcommerceSidebar } from "../src/useEcommerceSidebar";

function Sidebar() {
  const sidebar = useEcommerceSidebar();
  return React.createElement(
    "section",
    { ref: sidebar.rootRef, "data-resizing": sidebar.resizing },
    React.createElement("div", sidebar.separatorProps),
    React.createElement("input", { "aria-label": "草稿", defaultValue: "保留内容" }),
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("supports continuous dragging, collapse, reopening, cancel and reset without losing draft", () => {
  render(React.createElement(Sidebar));
  const handle = screen.getByRole("separator");
  let captured = false;
  Object.assign(handle, {
    setPointerCapture: () => {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
  });
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      button: 0,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(handle, event);
  };
  pointer("pointerdown", 352);
  pointer("pointermove", 510);
  expect(handle.getAttribute("aria-valuenow")).toBe("510");
  pointer("pointermove", 100);
  expect(handle.getAttribute("aria-valuenow")).toBe("64");
  pointer("pointerup", 100);
  pointer("pointerdown", 64);
  pointer("pointermove", 420);
  expect(handle.getAttribute("aria-valuenow")).toBe("420");
  pointer("pointercancel", 420);
  expect(handle.getAttribute("aria-valuenow")).toBe("64");
  pointer("pointerdown", 64);
  pointer("pointermove", 460);
  pointer("pointerup", 460);
  expect(handle.getAttribute("aria-valuenow")).toBe("460");
  fireEvent.doubleClick(handle);
  expect(handle.getAttribute("aria-valuenow")).toBe("352");
  expect((screen.getByLabelText("草稿") as HTMLInputElement).value).toBe(
    "保留内容",
  );
  expect(captured).toBe(false);
});

it("limits width to the container and supports keyboard resizing and reset", () => {
  let available = 1000;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width: available }) as DOMRect,
  );
  render(React.createElement(Sidebar));
  const handle = screen.getByRole("separator");
  fireEvent.keyDown(handle, { key: "End" });
  expect(handle.getAttribute("aria-valuenow")).toBe("640");
  available = 800;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(handle.getAttribute("aria-valuenow")).toBe("440");
  fireEvent.keyDown(handle, { key: "Home" });
  expect(handle.getAttribute("aria-valuenow")).toBe("64");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("352");
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  expect(handle.getAttribute("aria-valuenow")).toBe("416");
  fireEvent.keyDown(handle, { key: "Enter" });
  expect(handle.getAttribute("aria-valuenow")).toBe("352");
});
