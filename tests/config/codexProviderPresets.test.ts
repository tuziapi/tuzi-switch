import { describe, expect, it } from "vitest";
import {
  codexProviderPresets,
  generateThirdPartyConfig,
} from "@/config/codexProviderPresets";

describe("Codex provider presets", () => {
  it("uses custom as the default route for the tuzi preset", () => {
    const preset = codexProviderPresets.find(
      (item) => item.name === "兔子线路",
    );

    expect(preset).toBeDefined();
    expect(preset?.envKey).toBe("TUZI01_CODEX_API_KEY");
    expect(preset?.config).toContain('model_provider = "custom"');
    expect(preset?.config).toContain("[model_providers.custom]");
    expect(preset?.config).toContain('name = "provider-tuzi01"');
    expect(preset?.config).toContain('env_key = "TUZI01_CODEX_API_KEY"');
    expect(preset?.config).not.toContain('model_provider = "tuzi"');
  });

  it("preserves the provider display name while using the custom route", () => {
    const config = generateThirdPartyConfig(
      "provider-tuzi02",
      "https://api.tu-zi.com/v1",
      "TUZI02_CODEX_API_KEY",
    );

    expect(config).toContain('model_provider = "custom"');
    expect(config).toContain("[model_providers.custom]");
    expect(config).toContain('name = "provider-tuzi02"');
  });
});
