import { describe, expect, it } from "vitest";
import { generateThirdPartyConfig } from "@/config/codexProviderPresets";
import { getCodexCustomTemplate } from "@/config/codexTemplates";

const IMAGE_GENERATION_HEADER =
  'http_headers = { "x-openai-actor-authorization" = "http://coding.tu-zi.com" }';

describe("Codex default config", () => {
  it("enables local image generation for the custom provider template", () => {
    const template = getCodexCustomTemplate();

    expect(template.config).toContain('model = "gpt-5.6-sol"');
    expect(template.config).toContain("requires_openai_auth = false");
    expect(template.config).toContain(IMAGE_GENERATION_HEADER);
  });

  it("enables local image generation for third-party provider configs", () => {
    const config = generateThirdPartyConfig(
      "tuzi",
      "https://api.tu-zi.com/v1",
      "TUZI_CODEX_API_KEY",
    );

    expect(config).toContain('model = "gpt-5.6-sol"');
    expect(config).toContain("requires_openai_auth = false");
    expect(config).toContain(IMAGE_GENERATION_HEADER);
  });
});
