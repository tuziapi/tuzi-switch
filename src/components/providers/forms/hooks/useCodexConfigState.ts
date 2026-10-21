import { parse as parseToml } from "smol-toml";
import { useState, useCallback, useEffect } from "react";
import {
  extractCodexBaseUrl,
  setCodexBaseUrl as setCodexBaseUrlInConfig,
  extractCodexModelName,
  setCodexModelName as setCodexModelNameInConfig,
  getCodexEnvKey,
  getCodexProviderEnvKeyFromSettings,
  migrateCodexExperimentalBearerToken,
} from "@/utils/providerConfigUtils";
import { invoke } from "@tauri-apps/api/core";
import type { CodexCatalogModel } from "@/types";

interface UseCodexConfigStateProps {
  providerId?: string;
  isCreationPrefill?: boolean;
  initialData?: {
    name?: string;
    settingsConfig?: Record<string, unknown>;
  };
}

export type CodexCredentialStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "missing"
  | "error";

interface CodexProviderCredentialResponse {
  apiKey: string | null;
  migratedFrom: string | null;
}

/**
 * Migrate legacy config format to new format (no [profiles.xxx], model at top level).
 * If already has [model_providers.xxx] with env_key, returns as-is.
 */
function migrateLegacyConfig(configStr: string): string {
  if (!configStr.trim()) return configStr;

  // Remove top-level profile = "xxx" field (deprecated in Codex 0.134.0+)
  // This is the main fix for: "不再支持旧版 `profile = "codex"` 配置"
  let result = configStr.replace(/^\s*profile\s*=\s*"[^"]+"\s*$/gm, "");

  // Already has model_providers with env_key — no migration needed
  if (result.match(/\[model_providers\.\w+\]/) && result.includes("env_key")) {
    // Remove [profiles.xxx] sections if present (deprecated in 0.134.0+)
    return (
      result
        .replace(/\[profiles\.[^\]]+\][^\[]*/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim() + "\n"
    );
  }

  return result;
}

/**
 * 管理 Codex 配置状态 (profile-based, env-first)
 * API Key 存储在 shell rc managed block，不再写入 auth.json
 */
export function useCodexConfigState({
  providerId,
  initialData,
  isCreationPrefill = false,
}: UseCodexConfigStateProps) {
  const [codexAuth, setCodexAuthState] = useState("{}");
  const [codexConfig, setCodexConfigState] = useState("");
  const [codexApiKey, setCodexApiKey] = useState("");
  const [codexEnvKey, setCodexEnvKey] = useState("");
  const [codexBaseUrl, setCodexBaseUrl] = useState("");
  const [codexModelName, setCodexModelName] = useState("");
  const [codexCatalogModels, setCodexCatalogModels] = useState<
    CodexCatalogModel[]
  >([]);
  const [codexAuthError, setCodexAuthError] = useState("");
  const [codexCredentialStatus, setCodexCredentialStatus] =
    useState<CodexCredentialStatus>(initialData ? "loading" : "idle");
  const [codexCredentialError, setCodexCredentialError] = useState("");
  const [credentialReloadToken, setCredentialReloadToken] = useState(0);

  // 初始化 Codex 配置（编辑模式）
  useEffect(() => {
    if (!initialData) return;
    let cancelled = false;

    const config = initialData.settingsConfig;
    if (typeof config === "object" && config !== null) {
      let configStr =
        typeof (config as any).config === "string"
          ? (config as any).config
          : "";

      // Migrate legacy format: if no [profiles.xxx] section, auto-generate it
      configStr = migrateLegacyConfig(configStr);

      const migratedLegacyToken = migrateCodexExperimentalBearerToken({
        config: configStr,
        auth: (config as any).auth,
        env: (config as any).env,
      });
      configStr = migratedLegacyToken.config;
      setCodexAuthState(JSON.stringify(migratedLegacyToken.auth));

      setCodexConfigState(configStr);
      const modelCatalog = (config as any).modelCatalog;
      const models = Array.isArray(modelCatalog?.models)
        ? modelCatalog.models
            .map((model: any) => ({
              model: typeof model?.model === "string" ? model.model : "",
              displayName:
                typeof model?.displayName === "string"
                  ? model.displayName
                  : typeof model?.display_name === "string"
                    ? model.display_name
                    : "",
              contextWindow:
                typeof model?.contextWindow === "string" ||
                typeof model?.contextWindow === "number"
                  ? model.contextWindow
                  : typeof model?.context_window === "string" ||
                      typeof model?.context_window === "number"
                    ? model.context_window
                    : "",
            }))
            .filter((model: CodexCatalogModel) => model.model.trim())
        : [];
      setCodexCatalogModels(models);

      const initialBaseUrl = extractCodexBaseUrl(configStr);
      if (initialBaseUrl) setCodexBaseUrl(initialBaseUrl);

      const initialModelName = extractCodexModelName(configStr);
      if (initialModelName) setCodexModelName(initialModelName);

      // TOML is the source of truth. The legacy env.envKey field is only a fallback.
      const resolvedEnvKey =
        getCodexProviderEnvKeyFromSettings({ ...config, config: configStr }) ||
        "";
      setCodexEnvKey(resolvedEnvKey);
      setCodexApiKey("");
      setCodexCredentialError("");

      const prefilledKey = migratedLegacyToken.auth?.OPENAI_API_KEY;
      // A new account draft has no stored env credential yet. Use its explicit
      // model Key without reading or overwriting another provider's credential.
      if (
        isCreationPrefill &&
        !providerId &&
        typeof prefilledKey === "string" &&
        prefilledKey
      ) {
        setCodexApiKey(prefilledKey);
        setCodexCredentialStatus("loaded");
        // Read through the provider-bound command so the backend can safely
        // migrate legacy env keys without allowing arbitrary credential reads.
      } else if (resolvedEnvKey) {
        setCodexCredentialStatus("loading");
        const command = providerId
          ? invoke<CodexProviderCredentialResponse>(
              "read_codex_provider_credential",
              { providerId, envKey: resolvedEnvKey },
            ).then((result) => result.apiKey)
          : invoke<string | null>("read_codex_env_key", {
              envKey: resolvedEnvKey,
            });
        command
          .then((key) => {
            if (cancelled) return;
            if (key) {
              setCodexApiKey(key);
              setCodexCredentialStatus("loaded");
            } else if (migratedLegacyToken.migratedApiKey) {
              setCodexApiKey(migratedLegacyToken.migratedApiKey);
              setCodexCredentialStatus("loaded");
            } else {
              setCodexApiKey("");
              setCodexCredentialStatus("missing");
            }
          })
          .catch((error) => {
            if (cancelled) return;
            const auth = migratedLegacyToken.auth;
            if (
              auth?.OPENAI_API_KEY &&
              typeof auth.OPENAI_API_KEY === "string"
            ) {
              setCodexApiKey(auth.OPENAI_API_KEY);
              setCodexCredentialStatus("loaded");
              return;
            }
            setCodexApiKey("");
            setCodexCredentialStatus("error");
            setCodexCredentialError(
              error instanceof Error ? error.message : String(error),
            );
          });
      } else {
        // Legacy provider without envKey
        const auth = migratedLegacyToken.auth;
        if (auth?.OPENAI_API_KEY && typeof auth.OPENAI_API_KEY === "string") {
          setCodexApiKey(auth.OPENAI_API_KEY);
          setCodexCredentialStatus("loaded");
        } else {
          setCodexCredentialStatus("idle");
        }
      }
    }

    return () => {
      cancelled = true;
    };
  }, [initialData, providerId, isCreationPrefill, credentialReloadToken]);

  const retryCodexCredentialLoad = useCallback(() => {
    setCredentialReloadToken((value) => value + 1);
  }, []);

  // A partially typed document is a draft, never a request to repair it.
  useEffect(() => {
    try {
      parseToml(codexConfig);
    } catch {
      return;
    }
    setCodexBaseUrl(extractCodexBaseUrl(codexConfig) || "");
    setCodexModelName(extractCodexModelName(codexConfig) || "");
    setCodexEnvKey(getCodexEnvKey(codexConfig) || "");
  }, [codexConfig]);

  // 验证 Codex Auth JSON (legacy compatibility)
  const validateCodexAuth = useCallback((value: string): string => {
    if (!value.trim()) return "";
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return "Auth JSON must be an object";
      }
      return "";
    } catch {
      return "Invalid JSON format";
    }
  }, []);

  const setCodexAuth = useCallback(
    (value: string) => {
      setCodexAuthState(value);
      setCodexAuthError(validateCodexAuth(value));
    },
    [validateCodexAuth],
  );

  const setCodexConfig = useCallback(
    (value: string | ((prev: string) => string)) => {
      setCodexConfigState((prev) =>
        typeof value === "function"
          ? (value as (input: string) => string)(prev)
          : value,
      );
    },
    [],
  );

  // API Key 输入：只更新本地状态，实际写入在保存时通过后端完成
  const handleCodexApiKeyChange = useCallback((key: string) => {
    setCodexApiKey(key.trim());
    setCodexCredentialError("");
    setCodexCredentialStatus(key.trim() ? "loaded" : "missing");
  }, []);

  const handleCodexBaseUrlChange = useCallback(
    (url: string) => {
      const sanitized = url.trim();
      setCodexBaseUrl(sanitized);
      setCodexConfig((prev) => setCodexBaseUrlInConfig(prev, sanitized));
    },
    [setCodexConfig],
  );

  const handleCodexModelNameChange = useCallback(
    (modelName: string) => {
      const trimmed = modelName.trim();
      setCodexModelName(trimmed);
      setCodexConfig((prev) => setCodexModelNameInConfig(prev, trimmed));
    },
    [setCodexConfig],
  );

  const handleCodexConfigChange = useCallback(
    (value: string) => {
      setCodexConfig(value);
    },
    [setCodexConfig],
  );

  // 重置配置（用于预设切换时，新建模式下不预填充 key）
  const resetCodexConfig = useCallback(
    (
      _auth: Record<string, unknown>,
      config: string,
      envKey?: string,
      defaultApiKey?: string,
    ) => {
      setCodexAuth("{}");
      setCodexConfig(config);

      const baseUrl = extractCodexBaseUrl(config);
      if (baseUrl) setCodexBaseUrl(baseUrl);
      else setCodexBaseUrl("");

      const modelName = extractCodexModelName(config);
      if (modelName) setCodexModelName(modelName);
      else setCodexModelName("");
      setCodexCatalogModels([]);

      const resolvedEnvKey = getCodexProviderEnvKeyFromSettings({
        config,
        env: { envKey },
      });
      setCodexEnvKey(resolvedEnvKey);

      const nextApiKey = defaultApiKey || "";
      setCodexApiKey(nextApiKey);
      setCodexCredentialStatus(nextApiKey ? "loaded" : "idle");
      setCodexCredentialError("");
    },
    [setCodexAuth, setCodexConfig],
  );

  // Legacy helper
  const getCodexAuthApiKey = useCallback(
    (_authString: string): string => codexApiKey,
    [codexApiKey],
  );

  return {
    codexAuth,
    codexConfig,
    codexApiKey,
    codexEnvKey,
    codexBaseUrl,
    codexModelName,
    codexCatalogModels,
    codexAuthError,
    codexCredentialStatus,
    codexCredentialError,
    setCodexAuth,
    setCodexConfig,
    setCodexEnvKey,
    setCodexCatalogModels,
    handleCodexApiKeyChange,
    handleCodexBaseUrlChange,
    handleCodexModelNameChange,
    handleCodexConfigChange,
    resetCodexConfig,
    getCodexAuthApiKey,
    validateCodexAuth,
    retryCodexCredentialLoad,
  };
}
