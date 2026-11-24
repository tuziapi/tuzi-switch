import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OpenTuConnectionGuide } from "../../packages/creative-workspace/src/OpenTuConnectionGuide";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../packages/creative-workspace/node_modules/@tauri-apps/api/core.js", () => ({ invoke }));
beforeEach(() => { invoke.mockReset(); });

it("copies a single-image canvas instruction without starting generation", async () => {
  vi.mocked(invoke).mockResolvedValue(true);
  render(<OpenTuConnectionGuide />);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(
    screen.getByRole("button", { name: "复制指令：生成图片并显示到画布" }),
  );
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  const [command, args] = vi.mocked(invoke).mock.calls[0];
  expect(command).toBe("copy_text_to_clipboard");
  expect(args).toEqual({ text: expect.stringContaining("完成后放入当前画布") });
  expect((args as { text: string }).text).toContain("只生成 1 张");
  expect(await screen.findByRole("status")).toHaveTextContent("已复制");
});

it("keeps the instruction selectable and reports a copy failure without leaking native errors", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("SYNTHETIC-secret"));
  render(<OpenTuConnectionGuide />);
  fireEvent.click(
    screen.getByRole("button", { name: "复制指令：先试试读取画布" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("手动复制");
  expect(screen.queryByText(/SYNTHETIC-secret/)).toBeNull();
  expect(screen.getByText(/请调用 tuzi-opentu 读取当前画布/)).toBeVisible();
});

it.each([
  ["en", "Get started in three steps"],
  ["ja", "3 ステップで使い始める"],
])("provides the guide in %s", (language, title) => {
  render(<OpenTuConnectionGuide language={language} />);
  expect(screen.getByRole("heading", { name: title })).toBeVisible();
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
