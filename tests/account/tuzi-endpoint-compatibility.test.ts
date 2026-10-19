import { describe, it, expect } from "vitest";
import cases from "../fixtures/tuzi-endpoint-compatibility.json";
import { supportsTuziProtocol } from "@/lib/tuziEndpointCompatibility";
import {
  TUZI_TOOL_TARGETS,
  tuziToolCompatibility,
} from "@/lib/tuziToolCompatibility";

const key = {
  status: 1,
  group: "default",
  expired_time: -1,
  unlimited_quota: true,
  model_limits: "",
  model_limits_enabled: false,
};
describe("website endpoint compatibility shared with native save checks", () => {
  for (const entry of cases) {
    it(entry.name, () => {
      for (const protocol of [
        "anthropic",
        "responses",
        "chat",
        "gemini",
      ] as const) {
        expect(supportsTuziProtocol(entry.model, protocol)).toBe(
          (entry.protocols as string[]).includes(protocol),
        );
      }
      for (const target of TUZI_TOOL_TARGETS) {
        const model = entry.model as unknown as Parameters<
          typeof tuziToolCompatibility
        >[1];
        expect(
          tuziToolCompatibility(
            key,
            model,
            target.appId,
            target.protocol,
            "MacIntel",
          ) === null,
        ).toBe((entry.protocols as string[]).includes(target.protocol));
      }
    });
  }
  it("does not relax Key restrictions for the new Claude catalog label", () => {
    const model = {
      model_name: "synthetic-model",
      enable_groups: ["default"],
      supported_endpoint_types: ["claude code"],
      endpoints: { "claude code": { path: "/v1/messages", method: "POST" } },
    };
    for (const override of [
      { status: 2 },
      { expired_time: 1 },
      { unlimited_quota: false, remain_quota: "0" },
      { group: "other" },
      { model_limits_enabled: true, model_limits: "another-model" },
    ]) {
      expect(
        tuziToolCompatibility(
          { ...key, ...override },
          model,
          "claude",
          "anthropic",
          "MacIntel",
        ),
      ).not.toBeNull();
    }
    expect(
      tuziToolCompatibility(key, model, "claude-desktop", "anthropic", "Linux"),
    ).toMatch("Linux");
    expect(
      tuziToolCompatibility(key, model, "codex", "responses", "MacIntel"),
    ).not.toBeNull();
  });
});
