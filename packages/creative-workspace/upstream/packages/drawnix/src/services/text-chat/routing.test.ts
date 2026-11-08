import { describe, expect, it } from "vitest";
import {
  inferBindingsForProviderModel,
  InvocationPlanner,
} from "../provider-routing";
import { ModelVendor } from "../../constants/model-config";
const profile = {
  id: "synthetic",
  name: "Synthetic",
  providerType: "openai-compatible" as const,
  baseUrl: "https://synthetic.invalid/v1",
  apiKey: "sk-SYNTHETIC",
  authType: "bearer" as const,
};
const model = {
  id: "claude-sonnet",
  label: "Synthetic",
  type: "text" as const,
  vendor: ModelVendor.OTHER,
};
describe("text protocols reuse existing provider catalogue", () => {
  it.each([
    ["/v1/messages", "anthropic.messages"],
    ["/v1/responses", "openai.responses"],
    ["/proxy/messages", "anthropic.messages"],
  ])("preserves explicit endpoint %s", (path, protocol) => {
    const bindings = inferBindingsForProviderModel(profile, model, {
      text: { path, method: "POST" },
    });
    expect(bindings.find((b) => b.protocol === protocol)?.submitPath).toBe(
      path,
    );
    const planner = new InvocationPlanner({
      getProviderProfile: () => profile,
      getModelBindings: () => bindings,
    });
    expect(
      planner.plan({
        operation: "text",
        modelRef: { profileId: profile.id, modelId: model.id },
        preferredRequestSchema: [
          "anthropic.messages",
          "openai.responses.input",
        ],
      }).binding.protocol,
    ).toBe(protocol);
  });
  it("does not choose native Claude based on model name alone", () => {
    const bindings = inferBindingsForProviderModel(profile, model);
    expect(bindings.some((b) => b.protocol === "anthropic.messages")).toBe(
      false,
    );
  });
  it("recognizes a configured official Claude endpoint without changing the old default binding", () => {
    const bindings = inferBindingsForProviderModel(
      { ...profile, baseUrl: "https://api.anthropic.com" },
      model,
    );
    expect(bindings.some((b) => b.protocol === "anthropic.messages")).toBe(
      true,
    );
    expect(bindings[0].protocol).toBe("openai.chat.completions");
  });
  it("does not infer text protocol for images or GET endpoints", () => {
    expect(
      inferBindingsForProviderModel(
        profile,
        { ...model, type: "image" },
        { text: { path: "/v1/messages", method: "POST" } },
      ).some((b) => b.protocol === "anthropic.messages"),
    ).toBe(false);
    expect(
      inferBindingsForProviderModel(profile, model, {
        text: { path: "/v1/messages", method: "GET" },
      }).some((b) => b.protocol === "anthropic.messages"),
    ).toBe(false);
  });
});
