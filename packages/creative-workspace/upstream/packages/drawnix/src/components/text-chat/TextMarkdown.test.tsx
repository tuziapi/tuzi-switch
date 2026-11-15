import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextMarkdown } from "./TextMarkdown";
afterEach(cleanup);
describe("text message rendering", () => {
  it("renders headings, tables and math without treating code as formulas", () => {
    const view = render(
      <TextMarkdown
        content={
          '## Plan\n\n| Task | Status |\n| --- | --- |\n| Build | Done |\n\n$E=mc^2$\n\n```js\nconst value = "$x$";\n```'
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Plan" })).toBeTruthy();
    expect(view.container.querySelector("table")).toBeTruthy();
    expect(view.container.querySelectorAll(".katex")).toHaveLength(1);
    expect(view.container.querySelector("pre")?.textContent).toContain("$x$");
  });
  it("copies the original code without markup", async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: write },
    });
    render(
      <TextMarkdown
        content={'```typescript\nconst text = "<b>safe</b>";\n```'}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith('const text = "<b>safe</b>";\n'),
    );
    expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy();
  });
  it("does not execute raw HTML, javascript links or trusted math HTML commands", () => {
    const view = render(
      <TextMarkdown
        content={
          '<script>window.hacked=true</script>\n\n[bad](javascript:alert(1))\n\n$\\href{javascript:alert(1)}{bad}$\n\n```html\n<img onerror="alert(1)">\n```'
        }
      />,
    );
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("[onerror]")).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
