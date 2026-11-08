import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  plan: vi.fn(),
  send: vi.fn(),
}));
vi.mock("../../utils/settings-manager", () => ({
  settingsManager: { waitForInitialization: async () => {} },
  resolveInvocationRoute: mocks.route,
}));
vi.mock("../provider-routing", () => ({
  resolveInvocationPlanFromRoute: mocks.plan,
  providerTransport: { send: mocks.send },
}));
import { requestTextChat } from "./request";
const ref = { profileId: "synthetic", modelId: "synthetic-text" };
const plan = (
  protocol = "openai.chat.completions",
  path = "/chat/completions",
) => ({
  modelRef: ref,
  provider: { apiKey: "sk-SYNTHETIC-SECRET", authType: "bearer" },
  binding: { protocol, submitPath: path, baseUrlStrategy: "ensure-v1" },
});
const send = () =>
  requestTextChat({
    model: ref,
    turns: [{ role: "user", content: "hello" }],
    signal: new AbortController().signal,
    onUpdate: () => {},
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.route.mockReturnValue({ apiKey: "sk-SYNTHETIC-SECRET" });
  mocks.plan.mockReturnValue(plan());
});
describe("configured text requests", () => {
  it("uses the existing exact profile/model and pure user turns", async () => {
    mocks.send.mockResolvedValue(
      new Response(
        '{"choices":[{"message":{"content":"answer"},"finish_reason":"stop"}]}',
        { headers: { "content-type": "application/json" } },
      ),
    );
    expect((await send()).content).toBe("answer");
    expect(mocks.route).toHaveBeenCalledWith("text", ref);
    expect(mocks.plan).toHaveBeenCalledWith("text", ref, {
      preferredRequestSchema: ["anthropic.messages", "openai.responses.input"],
    });
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toEqual({
      model: ref.modelId,
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });
  });
  it("maps native Claude auth, system format and version header", async () => {
    mocks.plan.mockReturnValue(plan("anthropic.messages", "/v1/messages"));
    mocks.send.mockResolvedValue(
      new Response(
        '{"content":[{"type":"text","text":"answer"}],"stop_reason":"end_turn"}',
        { headers: { "content-type": "application/json" } },
      ),
    );
    await send();
    expect(mocks.send.mock.calls[0][0].authType).toBe("header");
    expect(mocks.send.mock.calls[0][1].headers["anthropic-version"]).toBe(
      "2023-06-01",
    );
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toMatchObject({
      max_tokens: 4096,
    });
  });
  it("keeps account references opaque", async () => {
    const p = plan("anthropic.messages", "/messages");
    p.provider.apiKey = "tuzi-account:synthetic";
    mocks.plan.mockReturnValue(p);
    mocks.send.mockResolvedValue(
      new Response('{"content":[{"type":"text","text":"answer"}]}', {
        headers: { "content-type": "application/json" },
      }),
    );
    await send();
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      apiKey: "tuzi-account:synthetic",
      authType: "bearer",
    });
  });
  it("preserves configured Gemini paths and maps streaming", async () => {
    mocks.plan.mockReturnValue(
      plan("google.generateContent", "/proxy/models/{model}:generateContent"),
    );
    mocks.send.mockResolvedValue(
      new Response(
        '{"candidates":[{"content":{"parts":[{"text":"answer"}]},"finishReason":"STOP"}]}',
        { headers: { "content-type": "application/json" } },
      ),
    );
    await send();
    expect(mocks.send.mock.calls[0][1].path).toBe(
      "/proxy/models/synthetic-text:streamGenerateContent?alt=sse",
    );
  });
  it("rejects fallback to a different provider before submission", async () => {
    mocks.plan.mockReturnValue({
      ...plan(),
      modelRef: { ...ref, profileId: "other" },
    });
    await expect(send()).rejects.toThrow("供应商");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("redacts errors without automatically replaying a paid request", async () => {
    mocks.send.mockRejectedValue(Error("failed sk-SYNTHETIC-SECRET"));
    await expect(send()).rejects.not.toThrow("sk-SYNTHETIC-SECRET");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
