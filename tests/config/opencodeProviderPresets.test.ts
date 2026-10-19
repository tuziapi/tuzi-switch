import { describe, expect, it } from "vitest";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";

describe("OpenCode provider presets", () => {
  it("exposes the four Tuzi protocols with their matching API endpoints", () => {
    expect(opencodeProviderPresets).toHaveLength(4);
    expect(
      opencodeProviderPresets.map(({ settingsConfig }) => ({
        npm: settingsConfig.npm,
        baseURL: settingsConfig.options?.baseURL,
      })),
    ).toEqual(
      expect.arrayContaining([
        { npm: "@ai-sdk/openai", baseURL: "https://api.tu-zi.com/v1" },
        {
          npm: "@ai-sdk/openai-compatible",
          baseURL: "https://api.tu-zi.com/v1",
        },
        { npm: "@ai-sdk/anthropic", baseURL: "https://api.tu-zi.com/v1" },
        { npm: "@ai-sdk/google", baseURL: "https://api.tu-zi.com" },
      ]),
    );
  });

  it("leaves credentials and model selection for the user to configure", () => {
    for (const preset of opencodeProviderPresets) {
      expect(preset.websiteUrl).toBe("https://api.tu-zi.com");
      expect(preset.settingsConfig.options?.apiKey).toBe("");
      expect(preset.settingsConfig.models).toEqual({});
    }
  });
});
