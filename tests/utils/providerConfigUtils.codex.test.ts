import { describe, expect, it } from "vitest";
import {
  extractCodexBaseUrl,
  extractCodexExperimentalBearerToken,
  getCodexEnvKey,
  getCodexProviderApiKey,
  getCodexProviderEnvKeyFromSettings,
  extractCodexModelCatalogJson,
  extractCodexModelName,
  extractCodexWireApi,
  setCodexBaseUrl,
  setCodexEnvKey,
  setCodexModelCatalogJson,
  setCodexModelName,
  setCodexWireApi,
  isCodexEnvKeyDuplicate,
  migrateCodexExperimentalBearerToken,
  updateCodexExperimentalBearerToken,
  removeCodexExperimentalBearerToken,
} from "@/utils/providerConfigUtils";

describe("Codex TOML utils", () => {
  it("reads env_key from active model provider, top-level, and legacy profile config", () => {
    expect(
      getCodexEnvKey(
        [
          'model_provider = "deepseek"',
          "",
          "[model_providers.deepseek]",
          'env_key = "DEEPSEEK_API_KEY"',
          "",
        ].join("\n"),
      ),
    ).toBe("DEEPSEEK_API_KEY");

    expect(getCodexEnvKey('env_key = "OPENAI_API_KEY"\n')).toBe(
      "OPENAI_API_KEY",
    );

    expect(
      getCodexEnvKey(
        [
          'profile = "work"',
          "",
          "[profiles.work]",
          'env_key = "LEGACY_API_KEY"',
          "",
        ].join("\n"),
      ),
    ).toBe("LEGACY_API_KEY");
  });

  it("prefers the active provider TOML env_key over legacy settings envKey", () => {
    const config = [
      'model_provider = "tuzi"',
      "",
      "[model_providers.tuzi]",
      'base_url = "https://tuzi.example/v1"',
      'env_key = "TUZI_CODEX_KEY"',
      "",
      "[model_providers.other]",
      'base_url = "https://other.example/v1"',
      'env_key = "OTHER_CODEX_KEY"',
      "",
    ].join("\n");

    expect(
      getCodexProviderEnvKeyFromSettings({
        config,
        env: { envKey: "STALE_CODEX_KEY" },
      }),
    ).toBe("TUZI_CODEX_KEY");
  });

  it("does not fall back to stored auth when an env-backed provider key is empty", () => {
    const settings = {
      auth: { OPENAI_API_KEY: "copied-login-key" },
      config: [
        'model_provider = "coding"',
        "",
        "[model_providers.coding]",
        'env_key = "CODING_CODEX_API_KEY"',
        "",
      ].join("\n"),
    };

    expect(getCodexProviderApiKey(settings, null)).toBe("");
    expect(getCodexProviderApiKey(settings, " real-provider-key ")).toBe(
      "real-provider-key",
    );
  });

  it("keeps auth fallback only for legacy providers without env_key", () => {
    expect(
      getCodexProviderApiKey({
        auth: { OPENAI_API_KEY: " legacy-provider-key " },
        config: 'model_provider = "legacy"\n',
      }),
    ).toBe("legacy-provider-key");
  });

  it("reads env_key from valid single-quoted TOML strings", () => {
    expect(
      getCodexEnvKey(
        [
          "model_provider = 'tuzi'",
          "",
          "[model_providers.tuzi]",
          "env_key = 'TUZI_SINGLE_QUOTED_KEY'",
          "",
        ].join("\n"),
      ),
    ).toBe("TUZI_SINGLE_QUOTED_KEY");

    expect(getCodexEnvKey("env_key = 'TOP_LEVEL_SINGLE_KEY'\n")).toBe(
      "TOP_LEVEL_SINGLE_KEY",
    );

    expect(
      getCodexEnvKey(
        [
          "profile = 'legacy'",
          "",
          "[profiles.legacy]",
          "env_key = 'LEGACY_SINGLE_KEY'",
          "",
        ].join("\n"),
      ),
    ).toBe("LEGACY_SINGLE_KEY");
  });

  it("writes env_key into the active provider section without touching inactive providers", () => {
    const input = [
      'model_provider = "active"',
      'env_key = "TOP_LEVEL_KEY"',
      "",
      "[model_providers.inactive]",
      'env_key = "INACTIVE_KEY"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      'env_key = "OLD_ACTIVE_KEY" # keep comment',
      "",
    ].join("\n");

    const output = setCodexEnvKey(input, "TUZI02_CODEX_API_KEY");

    expect(output).toContain('env_key = "TOP_LEVEL_KEY"');
    expect(output).toContain(
      '[model_providers.inactive]\nenv_key = "INACTIVE_KEY"',
    );
    expect(output).toContain(
      '[model_providers.active]\nname = "Active"\nenv_key = "TUZI02_CODEX_API_KEY" # keep comment',
    );
    expect(getCodexEnvKey(output)).toBe("TUZI02_CODEX_API_KEY");
  });

  it("adds env_key to the active provider section when it is missing", () => {
    const input = [
      'model_provider = "active"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      'wire_api = "responses"',
      "",
    ].join("\n");

    const output = setCodexEnvKey(input, "CUSTOM_CODEX_API_KEY");

    expect(output).toContain(
      '[model_providers.active]\nname = "Active"\nwire_api = "responses"\nenv_key = "CUSTOM_CODEX_API_KEY"',
    );
    expect(getCodexEnvKey(output)).toBe("CUSTOM_CODEX_API_KEY");
  });

  it("detects duplicate codex env keys across providers and shell env", () => {
    const providers = {
      current: {
        settingsConfig: {
          config: [
            'model_provider = "current"',
            "",
            "[model_providers.current]",
            'env_key = "CURRENT_CODEX_API_KEY"',
            "",
          ].join("\n"),
        },
      },
      other: {
        settingsConfig: {
          config: [
            'model_provider = "other"',
            "",
            "[model_providers.other]",
            'env_key = "OTHER_CODEX_API_KEY"',
            "",
          ].join("\n"),
        },
      },
    };

    expect(
      isCodexEnvKeyDuplicate("OTHER_CODEX_API_KEY", {
        currentProviderId: "current",
        providers,
      }),
    ).toBe(true);
    expect(
      isCodexEnvKeyDuplicate("SHELL_CODEX_API_KEY", {
        currentEnvKey: "CURRENT_CODEX_API_KEY",
        currentProviderId: "current",
        providers,
        shellEnvKeys: { SHELL_CODEX_API_KEY: "secret" },
      }),
    ).toBe(true);
    expect(
      isCodexEnvKeyDuplicate("CURRENT_CODEX_API_KEY", {
        currentEnvKey: "CURRENT_CODEX_API_KEY",
        currentProviderId: "current",
        providers,
        shellEnvKeys: { CURRENT_CODEX_API_KEY: "secret" },
      }),
    ).toBe(false);
  });

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

  it("updates a double-quoted base_url containing single quotes without duplicating it", () => {
    const input = [
      'model_provider = "custom"',
      'model = "gpt-5.4"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'base_url = "https://su\'us.codes/v1"',
      'wire_api = "responses"',
      "requires_openai_auth = false",
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "https://su'us'd.codes/v1");

    expect(extractCodexBaseUrl(output)).toBe("https://su'us'd.codes/v1");
    expect(output.match(/^\s*base_url\s*=/gm)).toHaveLength(1);
  });

  it("collapses duplicate base_url lines in the active provider section", () => {
    const input = [
      'model_provider = "custom"',
      'model = "gpt-5.4"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'base_url = "https://old.example/v1"',
      'base_url = "https://older.example/v1"',
      'wire_api = "responses"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "https://new.example/v1");

    expect(extractCodexBaseUrl(output)).toBe("https://new.example/v1");
    expect(output.match(/^\s*base_url\s*=/gm)).toHaveLength(1);
    expect(output).not.toContain("older.example");
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

  it("updates base_url only for the active model_provider when multiple providers exist", () => {
    const input = [
      'model_provider = "custom"',
      "",
      "[model_providers.tuzi]",
      'name = "tuzi"',
      'base_url = "https://api.tu-zi.com/v1"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'base_url = "https://old.example/coding"',
      'wire_api = "responses"',
      "",
    ].join("\n");

    const output = setCodexBaseUrl(input, "https://api.tu-zi.com/coding");

    expect(output).toContain(
      '[model_providers.tuzi]\nname = "tuzi"\nbase_url = "https://api.tu-zi.com/v1"',
    );
    expect(output).toContain(
      '[model_providers.custom]\nname = "custom"\nbase_url = "https://api.tu-zi.com/coding"',
    );
    expect(extractCodexBaseUrl(output)).toBe("https://api.tu-zi.com/coding");
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

  it("removes experimental_bearer_token from top-level and active provider sections", () => {
    const input = [
      'model_provider = "active"',
      'experimental_bearer_token = "top-level-token"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      'env_key = "ACTIVE_CODEX_API_KEY"',
      'experimental_bearer_token = "provider-token"',
      "",
      "[model_providers.inactive]",
      'experimental_bearer_token = "inactive-token"',
      "",
    ].join("\n");

    const output = removeCodexExperimentalBearerToken(input);

    expect(output).not.toMatch(/^\s*experimental_bearer_token\s*=/m);
    expect(output).toContain('env_key = "ACTIVE_CODEX_API_KEY"');
    expect(output).not.toContain("provider-token");
    expect(output).not.toContain("inactive-token");
  });

  it("migrates legacy experimental_bearer_token into auth api key and removes the token from config", () => {
    const config = [
      'model_provider = "active"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      'experimental_bearer_token = "legacy-token"',
      "",
    ].join("\n");

    const migrated = migrateCodexExperimentalBearerToken({
      config,
      auth: {},
      env: {},
    });

    expect(migrated.migratedApiKey).toBe("legacy-token");
    expect(migrated.auth).toEqual({ OPENAI_API_KEY: "legacy-token" });
    expect(migrated.config).not.toMatch(/experimental_bearer_token/);
    expect(
      extractCodexExperimentalBearerToken(migrated.config),
    ).toBeUndefined();
  });

  it("does not overwrite existing auth or env_key when migrating legacy experimental_bearer_token", () => {
    const configWithLegacyToken = [
      'model_provider = "active"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      'experimental_bearer_token = "legacy-token"',
      "",
    ].join("\n");

    const configWithEnvKey = [
      'model_provider = "active"',
      "",
      "[model_providers.active]",
      'name = "Active"',
      'env_key = "ACTIVE_CODEX_API_KEY"',
      'experimental_bearer_token = "legacy-token"',
      "",
    ].join("\n");

    const envKeyResult = migrateCodexExperimentalBearerToken({
      config: configWithEnvKey,
      auth: {},
      env: {},
    });

    expect(envKeyResult.migratedApiKey).toBeUndefined();
    expect(envKeyResult.auth).toEqual({});
    expect(envKeyResult.config).not.toMatch(/experimental_bearer_token/);
    expect(getCodexEnvKey(envKeyResult.config)).toBe("ACTIVE_CODEX_API_KEY");

    const authResult = migrateCodexExperimentalBearerToken({
      config: configWithLegacyToken,
      auth: { OPENAI_API_KEY: "fresh-key" },
      env: {},
    });

    expect(authResult.migratedApiKey).toBeUndefined();
    expect(authResult.auth).toEqual({ OPENAI_API_KEY: "fresh-key" });
    expect(authResult.config).not.toMatch(/experimental_bearer_token/);
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
