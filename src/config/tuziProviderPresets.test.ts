import { describe, expect, it } from "vitest";
import { codexProviderPresets } from "./codexProviderPresets";
import { hermesProviderPresets } from "./hermesProviderPresets";
import { openclawProviderPresets } from "./openclawProviderPresets";
import { TUZI_AGENT_ROUTES, TUZI_CODEX_ROUTES } from "./tuziProviderPresets";

describe("Tuzi provider preset extension", () => {
  it("keeps provider-scoped Codex credentials and business endpoints", () => {
    const presets = codexProviderPresets.slice(0, TUZI_CODEX_ROUTES.length);

    expect(presets.map((preset) => preset.name)).toEqual(
      TUZI_CODEX_ROUTES.map((route) => route.name),
    );

    for (const [index, route] of TUZI_CODEX_ROUTES.entries()) {
      const preset = presets[index];
      expect(preset.config).toContain(`base_url = "${route.baseUrl}"`);
      expect(preset.config).toContain(`env_key = "${route.envKey}"`);
      expect(preset.config).toContain("requires_openai_auth = false");
      expect(route.endpointCandidates).toContain(route.baseUrl);
    }

    expect(TUZI_CODEX_ROUTES[0].endpointCandidates).toEqual([
      "https://api.tu-zi.com/v1",
      "https://coding.tu-zi.com",
      "https://coding.opentu.ai",
      "https://coding.sydney-ai.com",
      "https://test-coding.tu-zi.com",
      "https://sub2api-origin.sydney-ai.com",
    ]);
  });

  it("keeps the five effective Tuzi routes aligned across agent clients", () => {
    const routeNames = TUZI_AGENT_ROUTES.map((route) => route.name);
    expect(
      openclawProviderPresets
        .slice(0, TUZI_AGENT_ROUTES.length)
        .map((preset) => preset.name),
    ).toEqual(routeNames);
    expect(
      hermesProviderPresets
        .slice(0, TUZI_AGENT_ROUTES.length)
        .map((preset) => preset.name),
    ).toEqual(routeNames);

    expect(routeNames).toContain("codex-gaccode");
    expect(routeNames).toContain("claude-gaccode");

    for (const preset of openclawProviderPresets.slice(
      0,
      TUZI_AGENT_ROUTES.length,
    )) {
      expect(preset.suggestedDefaults?.model?.primary).toContain(
        `${preset.name}/`,
      );
    }
  });
});
