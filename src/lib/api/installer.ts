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
  latest_version?: string | null;
  resolved_version?: string | null;
  current_route: string | null;
  route_file_current_route?: string | null;
  effective_base_url?: string | null;
  resolved_executable_path?: string | null;
  resolved_package_name?: string | null;
  resolved_variant?: string | null;
  variant_conflict?: boolean;
  route_file_exists: boolean;
  settings_file_exists?: boolean;
  sources_conflict?: boolean;
  process_env_route?: string | null;
  runtime_env_conflict?: boolean;
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
  settings_summary?: {
    anthropic_api_key_masked: string | null;
    anthropic_base_url: string | null;
    anthropic_auth_token_set: boolean;
  };
  process_env_summary?: {
    anthropic_api_key_masked: string | null;
    anthropic_base_url: string | null;
    anthropic_auth_token_set: boolean;
  };
}

export interface CodexInstallerStatus {
  installed: boolean;
  version: string | null;
  latest_version?: string | null;
  resolved_version?: string | null;
  install_type: string | null;
  current_route: string | null;
  resolved_executable_path?: string | null;
  resolved_package_name?: string | null;
  resolved_variant?: string | null;
  variant_conflict?: boolean;
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

export interface GeminiInstallerStatus {
  installed: boolean;
  version: string | null;
  latest_version?: string | null;
  resolved_version?: string | null;
  install_type: string | null;
  current_route: string | null;
  resolved_executable_path?: string | null;
  resolved_package_name?: string | null;
  resolved_variant?: string | null;
  variant_conflict?: boolean;
  env_file_exists: boolean;
  settings_file_exists: boolean;
  routes: Array<{
    name: string;
    base_url: string | null;
    has_key: boolean;
    is_current: boolean;
    api_key_masked: string | null;
    model: string;
  }>;
  env_summary: {
    gemini_api_key_masked: string | null;
    google_gemini_base_url: string | null;
    gemini_model: string | null;
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

  async switchClaudeVariant(
    targetVariant: "modified" | "original",
  ): Promise<InstallerActionResult> {
    return await invoke("switch_claudecode_variant", {
      targetVariant,
      target_variant: targetVariant,
    });
  },

  async getCodexStatus(): Promise<CodexInstallerStatus> {
    return await invoke("get_codex_status");
  },

  async installCodex(options: {
    variant: "openai" | "gac";
    route?: "gac" | "tuzi" | "codex";
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

  async switchCodexVariant(
    targetVariant: "openai" | "gac",
  ): Promise<InstallerActionResult> {
    return await invoke("switch_codex_variant", {
      targetVariant,
      target_variant: targetVariant,
    });
  },

  async getGeminiStatus(): Promise<GeminiInstallerStatus> {
    return await invoke("get_gemini_status");
  },

  async installGemini(options: {
    variant: "official" | "gac";
    route?: "tuzi";
    apiKey?: string;
    model?: string;
  }): Promise<InstallerActionResult> {
    const { variant, route, apiKey, model } = options;
    return await invoke("install_gemini", {
      variant,
      route,
      apiKey,
      api_key: apiKey,
      model,
    });
  },

  async upgradeGemini(
    targetVariant?: "official" | "gac",
  ): Promise<InstallerActionResult> {
    return await invoke("upgrade_gemini", {
      targetVariant,
      target_variant: targetVariant,
    });
  },

  async switchGeminiVariant(
    targetVariant: "official" | "gac",
  ): Promise<InstallerActionResult> {
    return await invoke("switch_gemini_variant", {
      targetVariant,
      target_variant: targetVariant,
    });
  },
};
