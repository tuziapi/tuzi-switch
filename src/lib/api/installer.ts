import { invoke } from "@tauri-apps/api/core";

export interface InstallerActionResult {
  success: boolean;
  message: string;
  error: string | null;
  stdout: string;
  stderr: string;
  restart_required: boolean;
}

export interface ClaudeInstallerStatus {
  installed: boolean;
  version: string | null;
  current_route: string | null;
  route_file_exists: boolean;
  routes: Array<{
    name: string;
    base_url: string | null;
    has_key: boolean;
    is_current: boolean;
    api_key_masked: string | null;
  }>;
  env_summary: {
    anthropic_api_key_masked: string | null;
    anthropic_base_url: string | null;
    anthropic_api_token_set: boolean;
  };
}

export interface CodexInstallerStatus {
  installed: boolean;
  version: string | null;
  install_type: string | null;
  current_route: string | null;
  state_file_exists: boolean;
  config_file_exists: boolean;
  routes: Array<{
    name: string;
    base_url: string | null;
    has_key: boolean;
    is_current: boolean;
    api_key_masked: string | null;
    model_settings: {
      model: string;
      model_reasoning_effort: string;
    };
  }>;
  env_summary: {
    codex_api_key_masked: string | null;
  };
}

export const installerApi = {
  async getClaudeStatus(): Promise<ClaudeInstallerStatus> {
    return await invoke("get_claudecode_status");
  },

  async installClaudeCode(
    scheme: "A" | "B" | "C",
    apiKey?: string,
  ): Promise<InstallerActionResult> {
    return await invoke("install_claudecode", { scheme, apiKey });
  },

  async upgradeClaudeCode(
    targetVariant?: "modified" | "original",
  ): Promise<InstallerActionResult> {
    return await invoke("upgrade_claudecode", { targetVariant });
  },

  async getCodexStatus(): Promise<CodexInstallerStatus> {
    return await invoke("get_codex_status");
  },

  async installCodex(options: {
    variant: "openai" | "gac";
    route?: "gac" | "tuzi";
    apiKey?: string;
    model?: string;
    modelReasoningEffort?: string;
  }): Promise<InstallerActionResult> {
    const { variant, route, apiKey, model, modelReasoningEffort } = options;
    return await invoke("install_codex", {
      variant,
      route,
      apiKey,
      api_key: apiKey,
      model,
      modelReasoningEffort,
      model_reasoning_effort: modelReasoningEffort,
    });
  },

  async upgradeCodex(
    targetVariant?: "openai" | "gac",
  ): Promise<InstallerActionResult> {
    return await invoke("upgrade_codex", {
      targetVariant,
      target_variant: targetVariant,
    });
  },
};
