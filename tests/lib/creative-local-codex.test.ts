import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage?: (value: unknown) => void;
  },
}));
import { nativeLocalCodex } from "@/features/creative/localCodex";
const input = () => ({
  model: "synthetic",
  prompt: "hello",
  images: [],
  signal: new AbortController().signal,
  onUpdate: vi.fn(),
});
beforeEach(() => {
  mocks.invoke.mockReset();
});
afterEach(() => vi.useRealTimers());
describe("native Codex channel", () => {
  it("waits for explicit completion, delivers actual summary and final text", async () => {
    let channel: any;
    mocks.invoke.mockImplementation(async (_command, args) => {
      channel = args.onEvent;
    });
    const req = input();
    const pending = nativeLocalCodex.request(req);
    channel.onmessage({ type: "ready" });
    channel.onmessage({
      type: "delta",
      content: "partial",
      reasoning: "summary",
    });
    expect(req.onUpdate).toHaveBeenCalledWith({
      content: "partial",
      reasoning: "summary",
    });
    channel.onmessage({
      type: "complete",
      content: "final",
      reasoning: "summary",
    });
    await expect(pending).resolves.toEqual({
      content: "final",
      reasoning: "summary",
    });
  });
  it("re-sends cancellation if native registration arrives after abort", async () => {
    let channel: any;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "creative_codex_chat") channel = args.onEvent;
    });
    const controller = new AbortController();
    const pending = nativeLocalCodex.request({
      ...input(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    channel.onmessage({ type: "ready" });
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "creative_codex_cancel",
      ),
    ).toHaveLength(2);
  });
  it("never shows raw native errors or retries a rejected request", async () => {
    mocks.invoke.mockRejectedValue("SYNTHETIC_SECRET_ERROR");
    await expect(nativeLocalCodex.request(input())).rejects.toThrow(
      "本地 Codex 暂不可用",
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "creative_codex_chat",
      ),
    ).toHaveLength(1);
  });
  it("bounds missing channel completion after command success", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(undefined);
    const promise = nativeLocalCodex.request(input());
    const failed = expect(promise).rejects.toThrow("连接已中断");
    await vi.advanceTimersByTimeAsync(30_100);
    await failed;
  });
});
