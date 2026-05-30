import { describe, expect, it } from "vitest";
import {
  extractCodexBaseUrl,
  extractCodexExperimentalBearerToken,
  extractCodexModelCatalogJson,
  extractCodexModelName,
  extractCodexWireApi,
  setCodexBaseUrl,
  setCodexModelCatalogJson,
  setCodexModelName,
  setCodexWireApi,
  updateCodexExperimentalBearerToken,
} from "@/utils/providerConfigUtils";

describe("Codex TOML utils", () => {
  it("removes base_url line when set to empty", () => {
    const input = [
      'model_provider = "openai"',
      'base_url = "https://api.example.com/v1"',
      'model = "gpt-5-codex"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "");

    expect(output).not.toMatch(/^\s*base_url\s*=/m);
    expect(extractCodexBaseUrl(output)).toBeUndefined();
    expect(extractCodexModelName(output)).toBe("gpt-5-codex");
  });

  it("removes only the top-level model line when set to empty", () => {
    const input = [
      'model_provider = "openai"',
      'base_url = "https://api.example.com/v1"',
      'model = "gpt-5-codex"',
      "",
      "[profiles.default]",
      'model = "profile-model"',
      "",
    ].join("\n");

    const output = setCodexModelName(input, "");

    expect(output).not.toMatch(/^model\s*=\s*"gpt-5-codex"$/m);
    expect(output).toMatch(/^\[profiles\.default\]\nmodel = "profile-model"$/m);
    expect(extractCodexModelName(output)).toBeUndefined();
    expect(extractCodexBaseUrl(output)).toBe("https://api.example.com/v1");
  });

  it("updates existing values when non-empty", () => {
    const input = [
      'model_provider = "openai"',
      "base_url = 'https://old.example/v1'",
      'model = "old-model"',
      "",
    ].join("\n");

    const output1 = setCodexBaseUrl(input, " https://new.example/v1 \n");
    expect(extractCodexBaseUrl(output1)).toBe("https://new.example/v1");

    const output2 = setCodexModelName(output1, " new-model \n");
    expect(extractCodexModelName(output2)).toBe("new-model");
  });

  it("reads and writes base_url in the active provider section", () => {
    const input = [
      'model_provider = "custom"',
      'model = "gpt-5.4"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'wire_api = "responses"',
      "",
      "[profiles.default]",
      'approval_policy = "never"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "https://api.example.com/v1");

    expect(output).toContain(
      '[model_providers.custom]\nname = "custom"\nwire_api = "responses"\nbase_url = "https://api.example.com/v1"',
    );
    expect(extractCodexBaseUrl(output)).toBe("https://api.example.com/v1");
  });

  it("recovers a single misplaced base_url from another section", () => {
    const input = [
      'model_provider = "custom"',
      'model = "gpt-5.4"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'wire_api = "responses"',
      "",
      "[profiles.default]",
      'approval_policy = "never"',
      'base_url = "https://wrong.example/v1"',
      "",
    ].join("\n");

    expect(extractCodexBaseUrl(input)).toBe("https://wrong.example/v1");

    const output = setCodexBaseUrl(input, "https://fixed.example/v1");

    expect(output).toContain(
      '[model_providers.custom]\nname = "custom"\nwire_api = "responses"\nbase_url = "https://fixed.example/v1"',
    );
    expect(output).not.toContain("https://wrong.example/v1");
    expect(output.match(/base_url\s*=/g)).toHaveLength(1);
  });

  it("does not treat mcp_servers base_url as provider base_url", () => {
    const input = [
      'model_provider = "azure"',
      'model = "gpt-4"',
      "",
      "[model_providers.azure]",
      'name = "Azure OpenAI"',
      'wire_api = "responses"',
      "",
      "[mcp_servers.my_server]",
      'base_url = "http://localhost:8080"',
      "",
    ].join("\n");

    expect(extractCodexBaseUrl(input)).toBeUndefined();

    const output = setCodexBaseUrl(input, "https://new.azure/v1");

    expect(output).toContain(
      '[model_providers.azure]\nname = "Azure OpenAI"\nwire_api = "responses"\nbase_url = "https://new.azure/v1"',
    );
    expect(output).toContain(
      '[mcp_servers.my_server]\nbase_url = "http://localhost:8080"',
    );
  });

  it("reads model only from the top-level config", () => {
    const input = [
      'model_provider = "custom"',
      "",
      "[profiles.default]",
      'model = "profile-model"',
      "",
    ].join("\n");

    expect(extractCodexModelName(input)).toBeUndefined();
  });

  it("handles single-quoted values", () => {
    const input = "base_url = 'https://api.example.com/v1'\nmodel = 'gpt-5'\n";

    expect(extractCodexBaseUrl(input)).toBe("https://api.example.com/v1");
    expect(extractCodexModelName(input)).toBe("gpt-5");
  });

  it("reads wire_api from the active provider section and ignores inactive providers", () => {
    const input = [
      'model_provider = "active"',
      'wire_api = "top-level"',
      "",
      "[model_providers.inactive]",
      'wire_api = "chat"',
      "",
      "[model_providers.active]",
      'wire_api = "responses"',
      "",
    ].join("\n");

    expect(extractCodexWireApi(input)).toBe("responses");
  });

  it("falls back to top-level wire_api when the active provider section has none", () => {
    const input = [
      'model_provider = "active"',
      'wire_api = "responses"',
      "",
      "[model_providers.inactive]",
      'wire_api = "chat"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      "",
    ].join("\n");

    expect(extractCodexWireApi(input)).toBe("responses");
  });

  it("writes wire_api into the active provider section without changing top-level or inactive sections", () => {
    const input = [
      'model_provider = "active"',
      'wire_api = "top-level"',
      "",
      "[model_providers.inactive]",
      'wire_api = "chat"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      "",
    ].join("\n");

    const output = setCodexWireApi(input, "responses");

    expect(output).toContain('wire_api = "top-level"');
    expect(output).toContain('[model_providers.inactive]\nwire_api = "chat"');
    expect(output).toContain(
      '[model_providers.active]\nname = "Active"\nwire_api = "responses"',
    );
    expect(extractCodexWireApi(output)).toBe("responses");
  });

  it("clears wire_api from the active provider section and then falls back to top-level", () => {
    const input = [
      'model_provider = "active"',
      'wire_api = "top-level"',
      "",
      "[model_providers.inactive]",
      'wire_api = "chat"',
      "",
      "[model_providers.active]",
      'wire_api = "responses"',
      "",
    ].join("\n");

    const output = setCodexWireApi(input, "");

    expect(output).toContain('wire_api = "top-level"');
    expect(output).toContain('[model_providers.inactive]\nwire_api = "chat"');
    expect(output).toContain("[model_providers.active]\n");
    expect(output).not.toContain(
      '[model_providers.active]\nwire_api = "responses"',
    );
    expect(extractCodexWireApi(output)).toBe("top-level");
  });

  it("reads experimental_bearer_token from the active provider section before top-level", () => {
    const input = [
      'model_provider = "active"',
      'experimental_bearer_token = "top-level-token"',
      "",
      "[model_providers.active]",
      'experimental_bearer_token = "active-token"',
      "",
    ].join("\n");

    expect(extractCodexExperimentalBearerToken(input)).toBe("active-token");
  });

  it("uses top-level experimental_bearer_token for reserved provider ids", () => {
    const input = [
      'model_provider = "openai"',
      'experimental_bearer_token = "top-level-token"',
      "",
      "[model_providers.openai]",
      'experimental_bearer_token = "stale-provider-token"',
      "",
    ].join("\n");

    expect(extractCodexExperimentalBearerToken(input)).toBe("top-level-token");
  });

  it("falls back to top-level experimental_bearer_token when active provider has none", () => {
    const input = [
      'model_provider = "active"',
      'experimental_bearer_token = "top-level-token"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      "",
    ].join("\n");

    expect(extractCodexExperimentalBearerToken(input)).toBe("top-level-token");
  });

  it("ignores experimental_bearer_token from non-active provider sections", () => {
    const input = [
      'model_provider = "active"',
      "",
      "[model_providers.inactive]",
      'experimental_bearer_token = "inactive-token"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      "",
    ].join("\n");

    expect(extractCodexExperimentalBearerToken(input)).toBeUndefined();
  });

  it("updates and removes experimental_bearer_token in the active provider section", () => {
    const input = [
      'model_provider = "active"',
      'experimental_bearer_token = "top-level-token"',
      "",
      "[model_providers.active]",
      'experimental_bearer_token = "old-token" # live token',
      "",
    ].join("\n");

    const updated = updateCodexExperimentalBearerToken(input, 'new"token\\x');

    expect(updated).toContain(
      'experimental_bearer_token = "new\\"token\\\\x" # live token',
    );
    expect(extractCodexExperimentalBearerToken(updated)).toBe('new"token\\x');

    const cleared = updateCodexExperimentalBearerToken(updated, "");

    expect(extractCodexExperimentalBearerToken(cleared)).toBe(
      "top-level-token",
    );
    expect(cleared).not.toContain("# live token");
  });

  it("does not add experimental_bearer_token to configs that do not already use it", () => {
    const input = [
      'model_provider = "active"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      "",
    ].join("\n");

    expect(updateCodexExperimentalBearerToken(input, "new-token")).toBe(input);
    expect(updateCodexExperimentalBearerToken(input, "")).toBe(input);
  });

  it("reads, writes, and removes top-level model_catalog_json", () => {
    const input = [
      'model_provider = "active"',
      "",
      "[model_providers.active]",
      'model_catalog_json = "wrong-section.json"',
      "",
    ].join("\n");

    const updated = setCodexModelCatalogJson(
      input,
      '/Users/test/catalog "quoted".json',
    );

    expect(updated).toContain(
      'model_catalog_json = "/Users/test/catalog \\"quoted\\".json"',
    );
    expect(extractCodexModelCatalogJson(updated)).toBe(
      '/Users/test/catalog "quoted".json',
    );
    expect(updated).toContain(
      '[model_providers.active]\nmodel_catalog_json = "wrong-section.json"',
    );

    const cleared = setCodexModelCatalogJson(updated, "");

    expect(extractCodexModelCatalogJson(cleared)).toBeUndefined();
    expect(cleared).toContain("wrong-section.json");
  });
});
