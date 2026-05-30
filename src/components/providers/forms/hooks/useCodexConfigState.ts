import { useState, useCallback, useEffect, useRef } from "react";
import {
  extractCodexBaseUrl,
  setCodexBaseUrl as setCodexBaseUrlInConfig,
  extractCodexModelName,
  setCodexModelName as setCodexModelNameInConfig,
  getCodexEnvKey,
} from "@/utils/providerConfigUtils";
import { normalizeTomlText } from "@/utils/textNormalization";
import { invoke } from "@tauri-apps/api/core";
import type { CodexCatalogModel } from "@/types";

interface UseCodexConfigStateProps {
  initialData?: {
    name?: string;
    settingsConfig?: Record<string, unknown>;
  };
}

/**
 * Migrate legacy config format to new format (no [profiles.xxx], model at top level).
 * If already has [model_providers.xxx] with env_key, returns as-is.
 */
function migrateLegacyConfig(configStr: string): string {
  if (!configStr.trim()) return configStr;
  // Already has model_providers with env_key — no migration needed
  if (
    configStr.match(/\[model_providers\.\w+\]/) &&
    configStr.includes("env_key")
  ) {
    // Remove [profiles.xxx] sections if present (deprecated in 0.134.0+)
    return (
      configStr
        .replace(/\[profiles\.[^\]]+\][^\[]*/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim() + "\n"
    );
  }

  // Extract model_provider name from top-level
  const providerMatch = configStr.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
  if (!providerMatch) return configStr;
  const providerName = providerMatch[1];

  // Extract model and model_reasoning_effort from top-level
  const modelMatch = configStr.match(/^\s*model\s*=\s*"([^"]+)"/m);
  const effortMatch = configStr.match(
    /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m,
  );
  const model = modelMatch?.[1] || "gpt-5.5";
  const effort = effortMatch?.[1] || "high";

  // Build new format
  const result: string[] = [];
  result.push(`model_provider = "${providerName}"`);
  result.push(`model = "${model}"`);
  result.push(`model_reasoning_effort = "${effort}"`);
  result.push(`disable_response_storage = true`);
  result.push("");

  // Copy existing [model_providers.xxx] section, adding env_key if missing
  const lines = configStr.split("\n");
  let inModelProviders = false;
  let hasEnvKey = false;
  let wroteModelProviders = false;

  for (const line of lines) {
    if (line.trim().startsWith("[model_providers.")) {
      inModelProviders = true;
      wroteModelProviders = true;
      result.push(line);
      continue;
    }
    if (inModelProviders) {
      if (
        line.trim().startsWith("[") &&
        !line.trim().startsWith("[model_providers.")
      ) {
        if (!hasEnvKey) {
          result.push(`env_key = "OPENAI_API_KEY"`);
        }
        inModelProviders = false;
        result.push(line);
      } else {
        if (line.trim().startsWith("env_key")) hasEnvKey = true;
        result.push(line);
      }
    }
  }

  if (inModelProviders && !hasEnvKey) {
    result.push(`env_key = "OPENAI_API_KEY"`);
  }

  if (!wroteModelProviders) {
    result.push(`[model_providers.${providerName}]`);
    result.push(`name = "${providerName}"`);
    result.push(`env_key = "OPENAI_API_KEY"`);
    result.push(`wire_api = "responses"`);
    result.push(`requires_openai_auth = true`);
  }

  return result.join("\n");
}

/**
 * 管理 Codex 配置状态 (profile-based, env-first)
 * API Key 存储在 shell rc managed block，不再写入 auth.json
 */
export function useCodexConfigState({ initialData }: UseCodexConfigStateProps) {
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

  const isUpdatingCodexBaseUrlRef = useRef(false);
  const isUpdatingCodexModelNameRef = useRef(false);

  // 初始化 Codex 配置（编辑模式）
  useEffect(() => {
    if (!initialData) return;

    const config = initialData.settingsConfig;
    if (typeof config === "object" && config !== null) {
      setCodexAuthState("{}");

      let configStr =
        typeof (config as any).config === "string"
          ? (config as any).config
          : "";

      // Migrate legacy format: if no [profiles.xxx] section, auto-generate it
      configStr = migrateLegacyConfig(configStr);

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

      // Determine envKey: from env field or from TOML config
      const envObj = (config as any).env;
      const envKeyFromField = envObj?.envKey;
      const envKeyFromToml = getCodexEnvKey(configStr);
      const resolvedEnvKey = envKeyFromField || envKeyFromToml || "";
      setCodexEnvKey(resolvedEnvKey);

      // Read API key from shell rc via backend
      if (resolvedEnvKey) {
        invoke<string | null>("read_codex_env_key", { envKey: resolvedEnvKey })
          .then((key) => {
            if (key) setCodexApiKey(key);
          })
          .catch(() => {
            // Fallback: legacy auth field
            const auth = (config as any).auth;
            if (
              auth?.OPENAI_API_KEY &&
              typeof auth.OPENAI_API_KEY === "string"
            ) {
              setCodexApiKey(auth.OPENAI_API_KEY);
            }
          });
      } else {
        // Legacy provider without envKey
        const auth = (config as any).auth;
        if (auth?.OPENAI_API_KEY && typeof auth.OPENAI_API_KEY === "string") {
          setCodexApiKey(auth.OPENAI_API_KEY);
        }
      }
    }
  }, [initialData]);

  // 与 TOML 配置保持基础 URL 同步
  useEffect(() => {
    if (isUpdatingCodexBaseUrlRef.current) return;
    const extracted = extractCodexBaseUrl(codexConfig) || "";
    setCodexBaseUrl((prev) => (prev === extracted ? prev : extracted));
  }, [codexConfig]);

  // 与 TOML 配置保持模型名称同步
  useEffect(() => {
    if (isUpdatingCodexModelNameRef.current) return;
    const extracted = extractCodexModelName(codexConfig) || "";
    setCodexModelName((prev) => (prev === extracted ? prev : extracted));
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
  }, []);

  const handleCodexBaseUrlChange = useCallback(
    (url: string) => {
      const sanitized = url.trim();
      setCodexBaseUrl(sanitized);
      isUpdatingCodexBaseUrlRef.current = true;
      setCodexConfig((prev) => setCodexBaseUrlInConfig(prev, sanitized));
      setTimeout(() => {
        isUpdatingCodexBaseUrlRef.current = false;
      }, 0);
    },
    [setCodexConfig],
  );

  const handleCodexModelNameChange = useCallback(
    (modelName: string) => {
      const trimmed = modelName.trim();
      setCodexModelName(trimmed);
      isUpdatingCodexModelNameRef.current = true;
      setCodexConfig((prev) => setCodexModelNameInConfig(prev, trimmed));
      setTimeout(() => {
        isUpdatingCodexModelNameRef.current = false;
      }, 0);
    },
    [setCodexConfig],
  );

  const handleCodexConfigChange = useCallback(
    (value: string) => {
      const normalized = normalizeTomlText(value);
      setCodexConfig(normalized);

      if (!isUpdatingCodexBaseUrlRef.current) {
        const extracted = extractCodexBaseUrl(normalized) || "";
        if (extracted !== codexBaseUrl) setCodexBaseUrl(extracted);
      }
      if (!isUpdatingCodexModelNameRef.current) {
        const extractedModel = extractCodexModelName(normalized) || "";
        if (extractedModel !== codexModelName)
          setCodexModelName(extractedModel);
      }
      // Sync env_key from config
      const newEnvKey = getCodexEnvKey(normalized);
      if (newEnvKey && newEnvKey !== codexEnvKey) setCodexEnvKey(newEnvKey);
    },
    [setCodexConfig, codexBaseUrl, codexModelName, codexEnvKey],
  );

  // 重置配置（用于预设切换时，新建模式下不预填充 key）
  const resetCodexConfig = useCallback(
    (_auth: Record<string, unknown>, config: string, envKey?: string) => {
      setCodexAuth("{}");
      setCodexConfig(config);

      const baseUrl = extractCodexBaseUrl(config);
      if (baseUrl) setCodexBaseUrl(baseUrl);
      else setCodexBaseUrl("");

      const modelName = extractCodexModelName(config);
      if (modelName) setCodexModelName(modelName);
      else setCodexModelName("");
      setCodexCatalogModels([]);

      const resolvedEnvKey = envKey || getCodexEnvKey(config) || "";
      setCodexEnvKey(resolvedEnvKey);

      // Don't pre-fill key on preset switch (new mode) — user should enter their own key
      setCodexApiKey("");
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
  };
}
