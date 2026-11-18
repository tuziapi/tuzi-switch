import { describe, expect, it } from "vitest";
import { upstreamWorkBuddyPresets } from "@/config/workbuddyUpstreamPresets";
import {
  chatCompletionsUrl,
  setWorkBuddyCanDisableThinking,
  setWorkBuddyEffort,
  workbuddyProviderPresets,
  workbuddyThinkingFields,
} from "@/config/workbuddyProviderPresets";

describe("WorkBuddy provider presets", () => {
  it("ships the full upstream catalog alongside the local presets", () => {
    expect(upstreamWorkBuddyPresets).toHaveLength(68);
    expect(upstreamWorkBuddyPresets.flatMap((preset) => preset.models)).toHaveLength(270);
    expect(workbuddyProviderPresets).toHaveLength(80);
    expect(new Set(workbuddyProviderPresets.map((preset) => preset.name)).size).toBe(80);
  });
  it("contains valid Chat Completions presets with unique model IDs per provider", () => {
    expect(workbuddyProviderPresets.length).toBeGreaterThan(2);

    for (const preset of workbuddyProviderPresets) {
      expect(preset.url).toMatch(/^https?:\/\/[^\s]+\/chat\/completions$/);
      const ids = preset.models.map((model) => model.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => id.trim().length > 0)).toBe(true);
      expect(preset.models.every((model) => model.supportsToolCall)).toBe(true);
    }
  });

  it("converts thinking maps into WorkBuddy effort metadata", () => {
    expect(
      workbuddyThinkingFields({
        off: null,
        low: "low",
        medium: null,
        high: "high",
        max: "max",
      }).reasoning,
    ).toEqual({
      supportedEfforts: ["low", "high", "max"],
      defaultEffort: "high",
      canDisableThinking: false,
    });

    expect(
      workbuddyThinkingFields({
        low: null,
        medium: null,
        high: "high",
        max: "max",
      }).reasoning,
    ).toEqual({
      supportedEfforts: ["high", "max"],
      defaultEffort: "high",
      canDisableThinking: true,
    });

    expect(workbuddyThinkingFields({})).toEqual({});
    expect(workbuddyThinkingFields({ unsupported: "value" })).toEqual({});
  });

  it("preserves defaults while editing effort settings", () => {
    const model = setWorkBuddyEffort(
      { id: "synthetic", supportsReasoning: true },
      "max",
      true,
    );
    const withHigh = setWorkBuddyEffort(model, "high", true);
    expect(withHigh.reasoning?.supportedEfforts).toEqual(["high", "max"]);
    expect(withHigh.reasoning?.defaultEffort).toBe("max");

    const locked = setWorkBuddyCanDisableThinking(withHigh, false);
    expect(locked.reasoning?.canDisableThinking).toBe(false);
    expect(locked.thinkingLevelMap?.off).toBeNull();

    const cleared = setWorkBuddyEffort(
      setWorkBuddyEffort(withHigh, "high", false),
      "max",
      false,
    );
    expect(cleared).toEqual({ id: "synthetic", supportsReasoning: true });
  });

  it("normalizes provider roots without duplicating the endpoint", () => {
    expect(chatCompletionsUrl("https://api.example.test/v1/")).toBe(
      "https://api.example.test/v1/chat/completions",
    );
    expect(
      chatCompletionsUrl("https://api.example.test/v1/chat/completions"),
    ).toBe("https://api.example.test/v1/chat/completions");
  });
});
