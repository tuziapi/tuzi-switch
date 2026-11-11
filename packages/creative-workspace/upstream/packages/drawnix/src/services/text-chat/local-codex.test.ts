import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ bridge: undefined as any }));
vi.mock("../assistant-account", () => ({
  getAssistantAccount: () => ({ localCodex: mocks.bridge }),
}));
vi.mock("../../utils/gemini-api/message-utils", () => ({
  normalizeImageUrlForMultimodalInput: async (url: string) => url,
}));
import { localCodex, requestCodexDiscussion } from "./local-codex";
const models = [
  {
    id: "synthetic-codex",
    name: "Synthetic",
    efforts: ["low", "high"],
    defaultEffort: "high",
    supportsImages: true,
  },
];
const request = () => ({
  model: null,
  codex: localCodex.selection(),
  turns: [{ role: "user" as const, content: "hello" }],
  signal: new AbortController().signal,
  onUpdate: vi.fn(),
});
beforeEach(() => {
  localCodex.disconnect();
  mocks.bridge = {
    probe: vi.fn(async () => ({ models, defaultModel: models[0].id })),
    request: vi.fn(async () => ({
      content: '{"content":"hello","next":[]}',
      reasoning: "summary",
    })),
  };
});
afterEach(() => localCodex.disconnect());
describe("explicit local Codex selection", () => {
  it("defaults to existing text model and restores that route after disconnect", async () => {
    expect(localCodex.selection()).toBeUndefined();
    await localCodex.connect();
    expect(localCodex.selection()).toMatchObject({
      model: "synthetic-codex",
      effort: "high",
    });
    localCodex.setEffort("low");
    expect(localCodex.selection()?.effort).toBe("low");
    localCodex.disconnect();
    expect(localCodex.selection()).toBeUndefined();
  });
  it("failed initial connection does not enable Codex", async () => {
    mocks.bridge.probe.mockRejectedValue(new Error("missing CLI"));
    await localCodex.connect();
    expect(localCodex.selection()).toBeUndefined();
    expect(localCodex.getSnapshot().error).toBe("missing CLI");
  });
  it("never sends a queued turn after disconnect/reconnect changes its connection", async () => {
    await localCodex.connect();
    const saved = request();
    localCodex.disconnect();
    await localCodex.connect();
    await expect(requestCodexDiscussion(saved)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.bridge.request).not.toHaveBeenCalled();
  });
  it("ignores a probe that finishes after explicit disconnect", async () => {
    let release: (value: any) => void = () => {};
    mocks.bridge.probe.mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const pending = localCodex.connect();
    localCodex.disconnect();
    release({ models, defaultModel: models[0].id });
    await pending;
    expect(localCodex.selection()).toBeUndefined();
  });
  it("sends the frozen Codex selection and does not fall back after an error", async () => {
    await localCodex.connect();
    const input = request();
    mocks.bridge.request.mockRejectedValue(new Error("connection lost"));
    await expect(requestCodexDiscussion(input)).rejects.toThrow(
      "connection lost",
    );
    expect(mocks.bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({ model: "synthetic-codex", effort: "high" }),
    );
    expect(localCodex.getSnapshot().enabled).toBe(true);
    expect(() => localCodex.selection()).toThrow("connection lost");
    localCodex.disconnect();
    expect(localCodex.selection()).toBeUndefined();
  });
  it("preserves conversation roles and interrupts an active turn on disconnect", async () => {
    await localCodex.connect();
    mocks.bridge.request.mockImplementation(({ signal, prompt }: any) => {
      expect(prompt).toContain('"role":"user"');
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () =>
          reject(new DOMException("stop", "AbortError")),
        ),
      );
    });
    const pending = requestCodexDiscussion(request());
    await vi.waitFor(() => expect(mocks.bridge.request).toHaveBeenCalled());
    localCodex.disconnect();
    await expect(pending).rejects.toThrow("stop");
    expect(localCodex.getSnapshot().running).toBe(0);
  });
});
