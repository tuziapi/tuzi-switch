import { useEffect, useMemo, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ImeSafeInput } from "@/components/ui/ime-safe-input";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import { providersApi, settingsApi, type AppId } from "@/lib/api";
import type {
  ProviderCategory,
  ProviderMeta,
  ProviderTestConfig,
  ClaudeApiFormat,
  CodexApiFormat,
  CodexCatalogModel,
  CodexChatReasoning,
  ClaudeApiKeyField,
} from "@/types";
import {
  providerPresets,
  type ProviderPreset,
} from "@/config/claudeProviderPresets";
import {
  codexProviderPresets,
  generateThirdPartyConfig,
  type CodexProviderPreset,
} from "@/config/codexProviderPresets";
import {
  geminiProviderPresets,
  type GeminiProviderPreset,
} from "@/config/geminiProviderPresets";
import {
  opencodeProviderPresets,
  type OpenCodeProviderPreset,
} from "@/config/opencodeProviderPresets";
import {
  openclawProviderPresets,
  openclawApiProtocols,
  type OpenClawProviderPreset,
  type OpenClawSuggestedDefaults,
} from "@/config/openclawProviderPresets";
import {
  hermesProviderPresets,
  hermesApiModes,
  type HermesProviderPreset,
} from "@/config/hermesProviderPresets";
import { OpenCodeFormFields } from "./OpenCodeFormFields";
import { OpenClawFormFields } from "./OpenClawFormFields";
import { HermesFormFields } from "./HermesFormFields";
import { ModelInputWithFetch } from "./shared";
import { Download, Loader2 } from "lucide-react";
import {
  fetchModelsForConfig,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import type { UniversalProviderPreset } from "@/config/universalProviderPresets";
import {
  applyTemplateValues,
  extractCodexBaseUrl,
  extractCodexWireApi,
  getCodexProviderEnvKeyFromSettings,
  hasApiKeyField,
  isCodexEnvKeyDuplicate,
  removeCodexExperimentalBearerToken,
  setCodexBaseUrl as setCodexBaseUrlInConfig,
  setCodexEnvKey as setCodexEnvKeyInConfig,
  setCodexModelName as setCodexModelNameInConfig,
  setCodexWireApi,
} from "@/utils/providerConfigUtils";
import { mergeProviderMeta } from "@/utils/providerMetaUtils";
import { getCodexCustomTemplate } from "@/config/codexTemplates";
import CodexConfigEditor from "./CodexConfigEditor";
import { CommonConfigEditor } from "./CommonConfigEditor";
import GeminiConfigEditor from "./GeminiConfigEditor";
import JsonEditor from "@/components/JsonEditor";
import { ChevronDown, ChevronRight, FileJson, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import { BasicFormFields } from "./BasicFormFields";
import { ClaudeFormFields } from "./ClaudeFormFields";
import { ClaudeDesktopProviderForm } from "./ClaudeDesktopProviderForm";
import { CodexFormFields } from "./CodexFormFields";
import { GeminiFormFields } from "./GeminiFormFields";
import { OmoFormFields } from "./OmoFormFields";
import { parseOmoOtherFieldsObject } from "@/types/omo";
import {
  ProviderAdvancedConfig,
  type PricingModelSourceOption,
} from "./ProviderAdvancedConfig";
import {
  useProviderCategory,
  useApiKeyState,
  useBaseUrlState,
  useModelState,
  useCodexConfigState,
  useApiKeyLink,
  useTemplateValues,
  useCommonConfigSnippet,
  useCodexCommonConfig,
  useSpeedTestEndpoints,
  useCodexTomlValidation,
  useGeminiConfigState,
  useGeminiCommonConfig,
  useOmoModelSource,
  useOpencodeFormState,
  useOmoDraftState,
  useOpenclawFormState,
  useHermesFormState,
  useCopilotAuth,
  useCodexOauth,
} from "./hooks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSettingsQuery } from "@/lib/query";
import {
  CLAUDE_DEFAULT_CONFIG,
  CODEX_DEFAULT_CONFIG,
  GEMINI_DEFAULT_CONFIG,
  OPENCODE_DEFAULT_CONFIG,
  OPENCLAW_DEFAULT_CONFIG,
  normalizePricingSource,
} from "./helpers/opencodeFormUtils";
import { HERMES_DEFAULT_CONFIG } from "./hooks/useHermesFormState";
import { resolveManagedAccountId } from "@/lib/authBinding";
import { useOpenClawLiveProviderIds } from "@/hooks/useOpenClaw";
import { useHermesLiveProviderIds } from "@/hooks/useHermes";

type PresetEntry = {
  id: string;
  preset:
    | ProviderPreset
    | CodexProviderPreset
    | GeminiProviderPreset
    | OpenCodeProviderPreset
    | OpenClawProviderPreset
    | HermesProviderPreset;
};

const codexApiFormatFromWireApi = (
  wireApi: string | undefined,
): CodexApiFormat | undefined => {
  switch (wireApi?.trim().toLowerCase()) {
    case "chat":
    case "chat_completions":
    case "chat-completions":
    case "openai_chat":
    case "openai-chat":
      return "openai_chat";
    case "responses":
    case "openai_responses":
    case "openai-responses":
      return "openai_responses";
    default:
      return undefined;
  }
};

export const normalizeCodexCatalogModelsForSave = (
  models: CodexCatalogModel[],
): CodexCatalogModel[] => {
  const seen = new Set<string>();
  const normalized: CodexCatalogModel[] = [];

  for (const item of models) {
    const model = item.model.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);

    const displayName = item.displayName?.trim();
    const rawContextWindow = String(item.contextWindow ?? "").replace(
      /[^\d]/g,
      "",
    );
    const contextWindow = rawContextWindow
      ? Number.parseInt(rawContextWindow, 10)
      : undefined;

    normalized.push({
      model,
      ...(displayName ? { displayName } : {}),
      ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
    });
  }

  return normalized;
};

const normalizeCodexChatReasoningForSave = (
  value?: CodexChatReasoning,
): CodexChatReasoning | undefined => {
  const supportsEffort = value?.supportsEffort === true;
  const supportsThinking = value?.supportsThinking === true || supportsEffort;
  const hasExplicitConfig = value && Object.keys(value).length > 0;

  if (!supportsThinking && !supportsEffort) {
    return hasExplicitConfig
      ? {
          supportsThinking: false,
          supportsEffort: false,
          thinkingParam: "none",
          effortParam: "none",
          outputFormat: value?.outputFormat ?? "auto",
        }
      : undefined;
  }

  return {
    supportsThinking,
    supportsEffort,
    thinkingParam: supportsThinking
      ? (value?.thinkingParam ?? "thinking")
      : "none",
    effortParam: supportsEffort
      ? (value?.effortParam ?? "reasoning_effort")
      : "none",
    effortValueMode: supportsEffort
      ? (value?.effortValueMode ?? "passthrough")
      : undefined,
    outputFormat: value?.outputFormat ?? "auto",
  };
};

const normalizeProviderKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9-]/g, "");

const CODEX_CUSTOM_NAME_DEFAULT = "我的配置";

const buildPresetPrefixedName = (presetName: string, customName: string) => {
  const prefix = presetName.trim();
  const suffix = customName.trim();
  if (!prefix) return suffix;
  if (!suffix) return `${prefix}-`;
  return suffix.startsWith(`${prefix}-`) ? suffix : `${prefix}-${suffix}`;
};

const parseCodexAuthObject = (authString: string): Record<string, unknown> => {
  if (!authString.trim()) return {};
  try {
    const parsed = JSON.parse(authString);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const extractCodexRouteId = (config: string): string => {
  const routeIdMatch = config.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
  return routeIdMatch?.[1]?.trim() || "";
};

const CODEX_TUZI_ROUTE_PREFIX = "provider-tuzi";
const CODEX_TUZI_ENV_PATTERN = /^TUZI(\d{2})_CODEX_API_KEY$/;
const CODEX_CODING_ROUTE_PREFIX = "provider-coding";
const CODEX_CODING_ENV_PATTERN = /^CODING(\d{2})_CODEX_API_KEY$/;
const CODEX_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isCodexTuziPreset = (preset: CodexProviderPreset) =>
  preset.icon === "tuzi" ||
  preset.envKey === "TUZI01_CODEX_API_KEY" ||
  extractCodexRouteId(preset.config ?? "").startsWith(CODEX_TUZI_ROUTE_PREFIX);

const isCodexCodingPreset = (preset: CodexProviderPreset) =>
  preset.icon === "codex-sub" ||
  preset.envKey === "CODING01_CODEX_API_KEY" ||
  extractCodexRouteId(preset.config ?? "").startsWith(
    CODEX_CODING_ROUTE_PREFIX,
  );

const formatCodexTuziRouteId = (index: number) =>
  `${CODEX_TUZI_ROUTE_PREFIX}${String(index).padStart(2, "0")}`;

const formatCodexTuziEnvKey = (index: number) =>
  `TUZI${String(index).padStart(2, "0")}_CODEX_API_KEY`;

const formatCodexCodingRouteId = (index: number) =>
  `${CODEX_CODING_ROUTE_PREFIX}${String(index).padStart(2, "0")}`;

const formatCodexCodingEnvKey = (index: number) =>
  `CODING${String(index).padStart(2, "0")}_CODEX_API_KEY`;

const extractCodexTuziIndex = (routeId: string, envKey: string): number => {
  const trimmedEnvKey = envKey.trim();
  const envMatch = trimmedEnvKey.match(CODEX_TUZI_ENV_PATTERN);
  if (envMatch) {
    return Number.parseInt(envMatch[1], 10);
  }
  const routeMatch = routeId.match(/^provider-tuzi(\d{2})$/);
  return routeMatch ? Number.parseInt(routeMatch[1], 10) : 0;
};

const extractCodexCodingIndex = (routeId: string, envKey: string): number => {
  const trimmedEnvKey = envKey.trim();
  const envMatch = trimmedEnvKey.match(CODEX_CODING_ENV_PATTERN);
  if (envMatch) {
    return Number.parseInt(envMatch[1], 10);
  }
  const routeMatch = routeId.match(/^provider-coding(\d{2})$/);
  return routeMatch ? Number.parseInt(routeMatch[1], 10) : 0;
};

const resolveNextCodexTuziRoute = (
  existingProviders: Record<string, { settingsConfig?: unknown }> | undefined,
  shellEnvKeys: Record<string, string> | undefined,
) => {
  const usedIndexes = new Set<number>();
  for (const provider of Object.values(existingProviders ?? {})) {
    const settings = provider.settingsConfig;
    const config =
      settings && typeof settings === "object"
        ? ((settings as Record<string, unknown>).config as string | undefined)
        : "";
    const routeId =
      typeof config === "string" ? extractCodexRouteId(config) : "";
    const envKey = getCodexProviderEnvKeyFromSettings(settings);
    const index = extractCodexTuziIndex(routeId, envKey);
    if (index > 0) {
      usedIndexes.add(index);
    }
  }

  for (const envKey of Object.keys(shellEnvKeys ?? {})) {
    const index = extractCodexTuziIndex("", envKey);
    if (index > 0) {
      usedIndexes.add(index);
    }
  }

  let index = 1;
  while (usedIndexes.has(index)) {
    index += 1;
  }
  return {
    index,
    routeId: formatCodexTuziRouteId(index),
    envKey: formatCodexTuziEnvKey(index),
  };
};

const resolveNextCodexCodingRoute = (
  existingProviders: Record<string, { settingsConfig?: unknown }> | undefined,
  shellEnvKeys: Record<string, string> | undefined,
) => {
  const usedIndexes = new Set<number>();
  for (const provider of Object.values(existingProviders ?? {})) {
    const settings = provider.settingsConfig;
    const config =
      settings && typeof settings === "object"
        ? ((settings as Record<string, unknown>).config as string | undefined)
        : "";
    const routeId =
      typeof config === "string" ? extractCodexRouteId(config) : "";
    const envKey = getCodexProviderEnvKeyFromSettings(settings);
    const index = extractCodexCodingIndex(routeId, envKey);
    if (index > 0) {
      usedIndexes.add(index);
    }
  }

  for (const envKey of Object.keys(shellEnvKeys ?? {})) {
    const index = extractCodexCodingIndex("", envKey);
    if (index > 0) {
      usedIndexes.add(index);
    }
  }

  let index = 1;
  while (usedIndexes.has(index)) {
    index += 1;
  }
  return {
    index,
    routeId: formatCodexCodingRouteId(index),
    envKey: formatCodexCodingEnvKey(index),
  };
};

type SaveCodexRouteResult = {
  routeId: string;
  envKey: string;
  config: string;
};

export interface ProviderFormProps {
  appId: AppId;
  providerId?: string;
  submitLabel: string;
  onSubmit: (values: ProviderFormValues) => Promise<void> | void;
  onCancel: () => void;
  onUniversalPresetSelect?: (preset: UniversalProviderPreset) => void;
  onManageUniversalProviders?: () => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  initialData?: {
    name?: string;
    websiteUrl?: string;
    notes?: string;
    settingsConfig?: Record<string, unknown>;
    category?: ProviderCategory;
    meta?: ProviderMeta;
    icon?: string;
    iconColor?: string;
  };
  showButtons?: boolean;
}

export function ProviderForm(props: ProviderFormProps) {
  if (props.appId === "claude-desktop") {
    return <ClaudeDesktopProviderForm {...props} />;
  }

  return <ProviderFormFull {...props} />;
}

function ProviderFormFull({
  appId,
  providerId,
  submitLabel,
  onSubmit,
  onCancel,
  onUniversalPresetSelect,
  onManageUniversalProviders,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: ProviderFormProps) {
  if (appId === "claude-desktop") {
    throw new Error("ProviderFormFull should not receive claude-desktop");
  }

  const { t } = useTranslation();
  const isEditMode = Boolean(initialData);
  const queryClient = useQueryClient();
  const { data: settingsData } = useSettingsQuery();
  const getInitialPresetId = useCallback((nextAppId: AppId) => {
    if (
      nextAppId === "claude" ||
      nextAppId === "codex" ||
      nextAppId === "gemini" ||
      nextAppId === "openclaw" ||
      nextAppId === "hermes"
    ) {
      return `${nextAppId}-0`;
    }
    return "custom";
  }, []);
  const showCommonConfigNotice =
    settingsData != null && settingsData.commonConfigConfirmed !== true;

  const handleCommonConfigConfirm = async () => {
    try {
      if (settingsData) {
        const { webdavSync: _, ...rest } = settingsData;
        await settingsApi.save({ ...rest, commonConfigConfirmed: true });
        await queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
    } catch (error) {
      console.error("Failed to save commonConfigConfirmed:", error);
    }
  };

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    initialData ? null : getInitialPresetId(appId),
  );
  const [activePreset, setActivePreset] = useState<{
    id: string;
    category?: ProviderCategory;
    suggestedDefaults?: OpenClawSuggestedDefaults;
  } | null>(null);
  const [isEndpointModalOpen, setIsEndpointModalOpen] = useState(false);
  const [isCodexEndpointModalOpen, setIsCodexEndpointModalOpen] =
    useState(false);

  const [draftCustomEndpoints, setDraftCustomEndpoints] = useState<string[]>(
    () => {
      if (initialData) return [];
      return [];
    },
  );
  const [endpointAutoSelect, setEndpointAutoSelect] = useState<boolean>(
    () => initialData?.meta?.endpointAutoSelect ?? true,
  );
  const supportsFullUrl = appId === "claude" || appId === "codex";
  const [localIsFullUrl, setLocalIsFullUrl] = useState<boolean>(() => {
    if (!supportsFullUrl) return false;
    return initialData?.meta?.isFullUrl ?? false;
  });

  const [testConfig, setTestConfig] = useState<ProviderTestConfig>(
    () => initialData?.meta?.testConfig ?? { enabled: false },
  );
  const [pricingConfig, setPricingConfig] = useState<{
    enabled: boolean;
    costMultiplier?: string;
    pricingModelSource: PricingModelSourceOption;
  }>(() => ({
    enabled:
      initialData?.meta?.costMultiplier !== undefined ||
      initialData?.meta?.pricingModelSource !== undefined,
    costMultiplier: initialData?.meta?.costMultiplier,
    pricingModelSource: normalizePricingSource(
      initialData?.meta?.pricingModelSource,
    ),
  }));

  const [isConfigEditorOpen, setIsConfigEditorOpen] = useState(false);

  const { category } = useProviderCategory({
    appId,
    selectedPresetId,
    isEditMode,
    initialCategory: initialData?.category,
  });
  const isOmoCategory = appId === "opencode" && category === "omo";
  const isOmoSlimCategory = appId === "opencode" && category === "omo-slim";
  const isAnyOmoCategory = isOmoCategory || isOmoSlimCategory;

  useEffect(() => {
    setSelectedPresetId(initialData ? null : getInitialPresetId(appId));
    setActivePreset(null);

    if (!initialData) {
      setDraftCustomEndpoints([]);
    }
    setEndpointAutoSelect(initialData?.meta?.endpointAutoSelect ?? true);
    setLocalIsFullUrl(
      supportsFullUrl ? (initialData?.meta?.isFullUrl ?? false) : false,
    );
    setTestConfig(initialData?.meta?.testConfig ?? { enabled: false });
    setPricingConfig({
      enabled:
        initialData?.meta?.costMultiplier !== undefined ||
        initialData?.meta?.pricingModelSource !== undefined,
      costMultiplier: initialData?.meta?.costMultiplier,
      pricingModelSource: normalizePricingSource(
        initialData?.meta?.pricingModelSource,
      ),
    });
  }, [appId, initialData, supportsFullUrl, getInitialPresetId]);

  const defaultValues: ProviderFormData = useMemo(
    () => ({
      name: initialData?.name ?? "",
      notes: initialData?.notes ?? "",
      settingsConfig: initialData?.settingsConfig
        ? JSON.stringify(initialData.settingsConfig, null, 2)
        : appId === "codex"
          ? CODEX_DEFAULT_CONFIG
          : appId === "gemini"
            ? GEMINI_DEFAULT_CONFIG
            : appId === "opencode"
              ? OPENCODE_DEFAULT_CONFIG
              : appId === "openclaw"
                ? OPENCLAW_DEFAULT_CONFIG
                : appId === "hermes"
                  ? HERMES_DEFAULT_CONFIG
                  : CLAUDE_DEFAULT_CONFIG,
      icon: initialData?.icon ?? "",
      iconColor: initialData?.iconColor ?? "",
    }),
    [initialData, appId],
  );

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues,
    mode: "onSubmit",
  });
  const { isSubmitting } = form.formState;

  const handleSettingsConfigChange = useCallback(
    (config: string) => {
      form.setValue("settingsConfig", config);
    },
    [form],
  );

  const [localApiKeyField, setLocalApiKeyField] = useState<ClaudeApiKeyField>(
    () => {
      if (appId !== "claude") return "ANTHROPIC_AUTH_TOKEN";
      if (initialData?.meta?.apiKeyField) return initialData.meta.apiKeyField;
      // Infer from existing config env
      const env = (initialData?.settingsConfig as Record<string, unknown>)
        ?.env as Record<string, unknown> | undefined;
      if (env?.ANTHROPIC_API_KEY !== undefined) return "ANTHROPIC_API_KEY";
      return "ANTHROPIC_AUTH_TOKEN";
    },
  );

  // 软校验：收集"业务约束"类问题（空值/缺项），由用户决定是否仍要保存
  const [softIssues, setSoftIssues] = useState<string[] | null>(null);
  const [pendingFormValues, setPendingFormValues] =
    useState<ProviderFormData | null>(null);
  const [pendingCodexEnvKeyOverride, setPendingCodexEnvKeyOverride] = useState<
    string | undefined
  >(undefined);
  // 确认框走的提交路径绕过了 react-hook-form 的 isSubmitting，单独追踪
  const [isConfirmSubmitting, setIsConfirmSubmitting] = useState(false);

  // 订阅 settingsConfig 变化，确保 shouldShowApiKey / hasApiKeyField 等依赖它的计算能响应式更新
  const watchedSettingsConfig = form.watch("settingsConfig");

  const {
    apiKey,
    handleApiKeyChange,
    showApiKey: shouldShowApiKey,
  } = useApiKeyState({
    initialConfig: watchedSettingsConfig,
    onConfigChange: handleSettingsConfigChange,
    selectedPresetId,
    category,
    appType: appId,
    apiKeyField: appId === "claude" ? localApiKeyField : undefined,
  });

  const { baseUrl, handleClaudeBaseUrlChange } = useBaseUrlState({
    appType: appId,
    category,
    settingsConfig: watchedSettingsConfig,
    codexConfig: "",
    onSettingsConfigChange: handleSettingsConfigChange,
    onCodexConfigChange: () => {},
  });

  const {
    claudeModel,
    defaultHaikuModel,
    defaultSonnetModel,
    defaultOpusModel,
    handleModelChange,
  } = useModelState({
    settingsConfig: watchedSettingsConfig,
    onConfigChange: handleSettingsConfigChange,
  });

  const [localApiFormat, setLocalApiFormat] = useState<ClaudeApiFormat>(() => {
    if (appId !== "claude") return "anthropic";
    return initialData?.meta?.apiFormat ?? "anthropic";
  });

  const handleApiFormatChange = useCallback((format: ClaudeApiFormat) => {
    setLocalApiFormat(format);
  }, []);

  const handleApiKeyFieldChange = useCallback(
    (field: ClaudeApiKeyField) => {
      const prev = localApiKeyField;
      setLocalApiKeyField(field);

      // Swap the env key name in settingsConfig
      try {
        const raw = form.getValues("settingsConfig");
        const config = JSON.parse(raw || "{}");
        if (config?.env && prev in config.env) {
          const value = config.env[prev];
          delete config.env[prev];
          config.env[field] = value;
          const updated = JSON.stringify(config, null, 2);
          form.setValue("settingsConfig", updated);
          handleSettingsConfigChange(updated);
        }
      } catch {
        // ignore parse errors during editing
      }
    },
    [localApiKeyField, form, handleSettingsConfigChange],
  );

  // Copilot OAuth 认证状态（仅 Claude 应用需要）
  const { isAuthenticated: isCopilotAuthenticated } = useCopilotAuth();

  // Codex OAuth 认证状态（ChatGPT Plus/Pro 反代）
  const { isAuthenticated: isCodexOauthAuthenticated } = useCodexOauth();

  // 选中的 GitHub 账号 ID（多账号支持）
  const [selectedGitHubAccountId, setSelectedGitHubAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "github_copilot"));

  // 选中的 ChatGPT 账号 ID（Codex OAuth 多账号支持）
  const [selectedCodexAccountId, setSelectedCodexAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "codex_oauth"));
  const [codexFastMode, setCodexFastMode] = useState<boolean>(
    () => initialData?.meta?.codexFastMode ?? false,
  );
  const [codexSubagentThreads, setCodexSubagentThreads] = useState<string>(
    () => initialData?.meta?.codexSubagentThreads?.toString() ?? "",
  );

  // Query existing codex providers for suffix computation
  const { data: existingCodexProviders } = useQuery({
    queryKey: ["codexProviders", appId],
    queryFn: () => providersApi.getAll(appId),
    enabled: appId === "codex",
  });

  // Preload shell rc env keys for checking if a route is actually configured
  const { data: shellEnvKeys } = useQuery({
    queryKey: ["codexShellEnvKeys"],
    queryFn: () => invoke<Record<string, string>>("read_all_codex_env_keys"),
    enabled: appId === "codex",
  });

  const {
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
    handleCodexConfigChange: originalHandleCodexConfigChange,
    resetCodexConfig,
    retryCodexCredentialLoad,
  } = useCodexConfigState({ providerId, initialData });
  useEffect(() => {
    onSubmittingChange?.(
      isSubmitting ||
        isConfirmSubmitting ||
        (appId === "codex" && codexCredentialStatus === "loading"),
    );
  }, [
    appId,
    codexCredentialStatus,
    isSubmitting,
    isConfirmSubmitting,
    onSubmittingChange,
  ]);
  const [codexChatReasoning, setCodexChatReasoning] =
    useState<CodexChatReasoning>(
      () => initialData?.meta?.codexChatReasoning ?? {},
    );
  const [codexEnvKeyError, setCodexEnvKeyError] = useState("");
  const [localCodexApiFormat, setLocalCodexApiFormat] =
    useState<CodexApiFormat>(() => {
      if (initialData?.meta?.apiFormat === "openai_chat") {
        return "openai_chat";
      }
      if (initialData?.meta?.apiFormat === "openai_responses") {
        return "openai_responses";
      }
      return (
        codexApiFormatFromWireApi(
          extractCodexWireApi(
            typeof initialData?.settingsConfig?.config === "string"
              ? initialData.settingsConfig.config
              : "",
          ),
        ) ?? "openai_responses"
      );
    });
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const { configError: codexConfigError, debouncedValidate } =
    useCodexTomlValidation();

  const handleCodexConfigChange = useCallback(
    (value: string) => {
      originalHandleCodexConfigChange(value);
      debouncedValidate(value);
    },
    [originalHandleCodexConfigChange, debouncedValidate],
  );

  const handleCodexApiFormatChange = useCallback(
    (format: CodexApiFormat) => {
      setLocalCodexApiFormat(format);
      setCodexConfig((prev) => {
        const updated = setCodexWireApi(prev, "responses");
        debouncedValidate(updated);
        return updated;
      });
    },
    [setCodexConfig, debouncedValidate],
  );

  const handleCodexEnvKeyChange = useCallback(
    (value: string) => {
      const sanitized = value.replace(/[^A-Za-z0-9_]/g, "");
      setCodexEnvKey(sanitized);
      setCodexEnvKeyError("");
      setCodexConfig((prev) => {
        const updated = setCodexEnvKeyInConfig(prev, sanitized);
        debouncedValidate(updated);
        return updated;
      });
    },
    [setCodexConfig, setCodexEnvKey, debouncedValidate],
  );

  useEffect(() => {
    if (appId !== "codex" || category === "official") return;

    const selectedBaseUrl = codexBaseUrl.trim();
    if (!selectedBaseUrl) return;

    const configBaseUrl = extractCodexBaseUrl(codexConfig)?.trim() ?? "";
    if (configBaseUrl === selectedBaseUrl) return;

    setCodexConfig((prev) => {
      const prevBaseUrl = extractCodexBaseUrl(prev)?.trim() ?? "";
      if (prevBaseUrl === selectedBaseUrl) return prev;

      const updated = setCodexBaseUrlInConfig(prev, selectedBaseUrl);
      debouncedValidate(updated);
      return updated;
    });
  }, [
    appId,
    category,
    codexBaseUrl,
    codexConfig,
    setCodexConfig,
    debouncedValidate,
  ]);

  const handleFetchModels = useCallback(() => {
    if (!codexBaseUrl || !codexApiKey) {
      showFetchModelsError(null, t, {
        hasApiKey: !!codexApiKey,
        hasBaseUrl: !!codexBaseUrl,
      });
      return;
    }
    setIsFetchingModels(true);
    fetchModelsForConfig(codexBaseUrl, codexApiKey, localIsFullUrl)
      .then((models) => {
        setFetchedModels(models);
        if (models.length === 0) {
          toast.info(t("providerForm.fetchModelsEmpty"));
        } else {
          toast.success(
            t("providerForm.fetchModelsSuccess", { count: models.length }),
          );
        }
      })
      .catch((err) => {
        console.warn("[ModelFetch] Failed:", err);
        showFetchModelsError(err, t);
      })
      .finally(() => setIsFetchingModels(false));
  }, [codexBaseUrl, codexApiKey, localIsFullUrl, t]);

  useEffect(() => {
    if (appId === "codex" && !initialData && selectedPresetId === "custom") {
      const template = getCodexCustomTemplate();
      resetCodexConfig(template.auth, template.config, "CUSTOM_CODEX_API_KEY");
      setCodexChatReasoning({});
      setLocalCodexApiFormat(
        codexApiFormatFromWireApi(extractCodexWireApi(template.config)) ??
          "openai_responses",
      );
    }
  }, [appId, initialData, selectedPresetId, resetCodexConfig]);

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const presetCategoryLabels: Record<string, string> = useMemo(
    () => ({
      official: t("providerForm.categoryOfficial", {
        defaultValue: "官方",
      }),
      cn_official: t("providerForm.categoryCnOfficial", {
        defaultValue: "国内官方",
      }),
      aggregator: t("providerForm.categoryAggregation", {
        defaultValue: "聚合服务",
      }),
      third_party: t("providerForm.categoryThirdParty", {
        defaultValue: "第三方",
      }),
      omo: "OMO",
    }),
    [t],
  );

  const presetEntries = useMemo(() => {
    if (appId === "codex") {
      return codexProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `codex-${index}`,
        preset,
      }));
    } else if (appId === "gemini") {
      return geminiProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `gemini-${index}`,
        preset,
      }));
    } else if (appId === "opencode") {
      return opencodeProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `opencode-${index}`,
        preset,
      }));
    } else if (appId === "openclaw") {
      return openclawProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `openclaw-${index}`,
        preset,
      }));
    } else if (appId === "hermes") {
      return hermesProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `hermes-${index}`,
        preset,
      }));
    }
    return providerPresets
      .filter((p) => !p.hidden)
      .map<PresetEntry>((preset, index) => ({
        id: `claude-${index}`,
        preset,
      }));
  }, [appId]);

  const {
    templateValues,
    templateValueEntries,
    selectedPreset: templatePreset,
    handleTemplateValueChange,
    validateTemplateValues,
  } = useTemplateValues({
    selectedPresetId: appId === "claude" ? selectedPresetId : null,
    presetEntries: appId === "claude" ? presetEntries : [],
    settingsConfig: form.getValues("settingsConfig"),
    onConfigChange: handleSettingsConfigChange,
  });

  const {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    isExtracting: isClaudeExtracting,
    handleExtract: handleClaudeExtract,
  } = useCommonConfigSnippet({
    settingsConfig: form.getValues("settingsConfig"),
    onConfigChange: handleSettingsConfigChange,
    initialData: appId === "claude" ? initialData : undefined,
    initialEnabled:
      appId === "claude" ? initialData?.meta?.commonConfigEnabled : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
    enabled: appId === "claude",
  });

  const {
    useCommonConfig: useCodexCommonConfigFlag,
    commonConfigSnippet: codexCommonConfigSnippet,
    commonConfigError: codexCommonConfigError,
    handleCommonConfigToggle: handleCodexCommonConfigToggle,
    handleCommonConfigSnippetChange: handleCodexCommonConfigSnippetChange,
    isExtracting: isCodexExtracting,
    handleExtract: handleCodexExtract,
    clearCommonConfigError: clearCodexCommonConfigError,
    isLoading: isCodexCommonConfigLoading,
  } = useCodexCommonConfig({
    codexConfig,
    onConfigChange: handleCodexConfigChange,
    initialData: appId === "codex" ? initialData : undefined,
    initialEnabled:
      appId === "codex" ? initialData?.meta?.commonConfigEnabled : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
  });

  const {
    geminiEnv,
    geminiConfig,
    geminiApiKey,
    geminiBaseUrl,
    geminiModel,
    envError,
    configError: geminiConfigError,
    handleGeminiApiKeyChange: originalHandleGeminiApiKeyChange,
    handleGeminiBaseUrlChange: originalHandleGeminiBaseUrlChange,
    handleGeminiModelChange: originalHandleGeminiModelChange,
    handleGeminiEnvChange,
    handleGeminiConfigChange,
    resetGeminiConfig,
    envStringToObj,
    envObjToString,
  } = useGeminiConfigState({
    initialData: appId === "gemini" ? initialData : undefined,
  });
  const [geminiFetchedModels, setGeminiFetchedModels] = useState<
    FetchedModel[]
  >([]);
  const [isFetchingGeminiModels, setIsFetchingGeminiModels] = useState(false);

  const updateGeminiEnvField = useCallback(
    (
      key: "GEMINI_API_KEY" | "GOOGLE_GEMINI_BASE_URL" | "GEMINI_MODEL",
      value: string,
    ) => {
      try {
        const config = JSON.parse(form.getValues("settingsConfig") || "{}") as {
          env?: Record<string, unknown>;
        };
        if (!config.env || typeof config.env !== "object") {
          config.env = {};
        }
        config.env[key] = value;
        form.setValue("settingsConfig", JSON.stringify(config, null, 2));
      } catch {}
    },
    [form],
  );

  const handleGeminiApiKeyChange = useCallback(
    (key: string) => {
      originalHandleGeminiApiKeyChange(key);
      updateGeminiEnvField("GEMINI_API_KEY", key.trim());
    },
    [originalHandleGeminiApiKeyChange, updateGeminiEnvField],
  );

  const handleGeminiBaseUrlChange = useCallback(
    (url: string) => {
      originalHandleGeminiBaseUrlChange(url);
      updateGeminiEnvField(
        "GOOGLE_GEMINI_BASE_URL",
        url.trim().replace(/\/+$/, ""),
      );
    },
    [originalHandleGeminiBaseUrlChange, updateGeminiEnvField],
  );

  const handleGeminiModelChange = useCallback(
    (model: string) => {
      originalHandleGeminiModelChange(model);
      updateGeminiEnvField("GEMINI_MODEL", model.trim());
    },
    [originalHandleGeminiModelChange, updateGeminiEnvField],
  );

  const handleFetchGeminiModels = useCallback(() => {
    if (!geminiBaseUrl || !geminiApiKey) {
      showFetchModelsError(null, t, {
        hasApiKey: !!geminiApiKey,
        hasBaseUrl: !!geminiBaseUrl,
      });
      return;
    }
    setIsFetchingGeminiModels(true);
    fetchModelsForConfig(geminiBaseUrl, geminiApiKey)
      .then((models) => {
        setGeminiFetchedModels(models);
        if (models.length === 0) {
          toast.info(t("providerForm.fetchModelsEmpty"));
        } else {
          toast.success(
            t("providerForm.fetchModelsSuccess", { count: models.length }),
          );
        }
      })
      .catch((err) => {
        console.warn("[ModelFetch] Failed:", err);
        showFetchModelsError(err, t);
      })
      .finally(() => setIsFetchingGeminiModels(false));
  }, [geminiBaseUrl, geminiApiKey, t]);

  const {
    useCommonConfig: useGeminiCommonConfigFlag,
    commonConfigSnippet: geminiCommonConfigSnippet,
    commonConfigError: geminiCommonConfigError,
    handleCommonConfigToggle: handleGeminiCommonConfigToggle,
    handleCommonConfigSnippetChange: handleGeminiCommonConfigSnippetChange,
    isExtracting: isGeminiExtracting,
    handleExtract: handleGeminiExtract,
    clearCommonConfigError: clearGeminiCommonConfigError,
  } = useGeminiCommonConfig({
    envValue: geminiEnv,
    onEnvChange: handleGeminiEnvChange,
    envStringToObj,
    envObjToString,
    initialData: appId === "gemini" ? initialData : undefined,
    initialEnabled:
      appId === "gemini" ? initialData?.meta?.commonConfigEnabled : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
  });

  // ── Extracted hooks: OpenCode / OMO / OpenClaw ─────────────────────

  const {
    omoModelOptions,
    omoModelVariantsMap,
    omoPresetMetaMap,
    existingOpencodeKeys,
  } = useOmoModelSource({ isOmoCategory: isAnyOmoCategory, providerId });

  const {
    data: opencodeLiveProviderIds = [],
    isLoading: isOpencodeLiveProviderIdsLoading,
  } = useQuery({
    queryKey: ["opencodeLiveProviderIds"],
    queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
    enabled: appId === "opencode" && !isAnyOmoCategory,
  });

  const opencodeForm = useOpencodeFormState({
    initialData,
    appId,
    providerId,
    onSettingsConfigChange: (config) => form.setValue("settingsConfig", config),
    getSettingsConfig: () => form.getValues("settingsConfig"),
  });

  const initialOmoSettings =
    appId === "opencode" &&
    (initialData?.category === "omo" || initialData?.category === "omo-slim")
      ? (initialData.settingsConfig as Record<string, unknown> | undefined)
      : undefined;

  const omoDraft = useOmoDraftState({
    initialOmoSettings,
    isEditMode,
    appId,
    category,
  });

  const openclawForm = useOpenclawFormState({
    initialData,
    appId,
    providerId,
    onSettingsConfigChange: (config) => form.setValue("settingsConfig", config),
    getSettingsConfig: () => form.getValues("settingsConfig"),
  });
  const {
    data: openclawLiveProviderIds = [],
    isLoading: isOpenclawLiveProviderIdsLoading,
  } = useOpenClawLiveProviderIds(appId === "openclaw");

  const hermesForm = useHermesFormState({
    initialData,
    appId,
    providerId,
    onSettingsConfigChange: (config) => form.setValue("settingsConfig", config),
    getSettingsConfig: () => form.getValues("settingsConfig"),
  });
  const {
    data: hermesLiveProviderIds = [],
    isLoading: isHermesLiveProviderIdsLoading,
  } = useHermesLiveProviderIds(appId === "hermes");

  const additiveExistingProviderKeys = useMemo(() => {
    if (appId === "opencode" && !isAnyOmoCategory) {
      return Array.from(
        new Set(
          [...existingOpencodeKeys, ...opencodeLiveProviderIds].filter(
            (key) => key !== providerId,
          ),
        ),
      );
    }

    if (appId === "openclaw") {
      return Array.from(
        new Set(
          [
            ...openclawForm.existingOpenclawKeys,
            ...openclawLiveProviderIds,
          ].filter((key) => key !== providerId),
        ),
      );
    }

    if (appId === "hermes") {
      return Array.from(
        new Set(
          [...hermesForm.existingHermesKeys, ...hermesLiveProviderIds].filter(
            (key) => key !== providerId,
          ),
        ),
      );
    }

    return [];
  }, [
    appId,
    existingOpencodeKeys,
    hermesForm.existingHermesKeys,
    hermesLiveProviderIds,
    isAnyOmoCategory,
    openclawForm.existingOpenclawKeys,
    openclawLiveProviderIds,
    opencodeLiveProviderIds,
    providerId,
  ]);

  const isProviderKeyLockStateLoading = useMemo(() => {
    if (!isEditMode) return false;
    if (appId === "opencode" && !isAnyOmoCategory) {
      return isOpencodeLiveProviderIdsLoading;
    }
    if (appId === "openclaw") {
      return isOpenclawLiveProviderIdsLoading;
    }
    if (appId === "hermes") {
      return isHermesLiveProviderIdsLoading;
    }
    return false;
  }, [
    appId,
    isAnyOmoCategory,
    isEditMode,
    isHermesLiveProviderIdsLoading,
    isOpenclawLiveProviderIdsLoading,
    isOpencodeLiveProviderIdsLoading,
  ]);

  const isProviderKeyLocked = useMemo(() => {
    if (!isEditMode || !providerId) return false;
    if (appId === "opencode" && !isAnyOmoCategory) {
      return opencodeLiveProviderIds.includes(providerId);
    }
    if (appId === "openclaw") {
      return openclawLiveProviderIds.includes(providerId);
    }
    if (appId === "hermes") {
      return hermesLiveProviderIds.includes(providerId);
    }
    return false;
  }, [
    appId,
    hermesLiveProviderIds,
    isAnyOmoCategory,
    isEditMode,
    openclawLiveProviderIds,
    opencodeLiveProviderIds,
    providerId,
  ]);

  const [isCommonConfigModalOpen, setIsCommonConfigModalOpen] = useState(false);

  const handleSubmit = async (values: ProviderFormData) => {
    if (appId === "codex" && codexCredentialStatus === "loading") {
      toast.info(
        t("providerForm.codexCredentialLoading", {
          defaultValue: "正在读取已保存的 API Key，请稍候",
        }),
      );
      return;
    }
    if (
      appId === "codex" &&
      codexCredentialStatus === "error" &&
      !codexApiKey.trim()
    ) {
      toast.error(
        t("providerForm.codexCredentialLoadFailed", {
          defaultValue: "已保存的 API Key 读取失败，请重试或重新填写",
        }),
      );
      return;
    }

    // 软性问题（业务约束，用户可选择仍要保存）
    const issues: string[] = [];
    let overriddenEnvKey = codexEnvKey;

    const trimmedCodexSubagentThreads = codexSubagentThreads.trim();
    if (
      appId === "codex" &&
      trimmedCodexSubagentThreads &&
      (!/^[1-9][0-9]*$/.test(trimmedCodexSubagentThreads) ||
        Number(trimmedCodexSubagentThreads) > 2147483647)
    ) {
      toast.error(
        t("codexConfig.subagentThreadsInvalid", {
          defaultValue: "请输入 1 到 2147483647 之间的整数",
        }),
      );
      return;
    }

    // 模板变量未填：A 类（空值）
    if (appId === "claude" && templateValueEntries.length > 0) {
      const validation = validateTemplateValues();
      if (!validation.isValid && validation.missingField) {
        issues.push(
          t("providerForm.fillParameter", {
            label: validation.missingField.label,
            defaultValue: `请填写 ${validation.missingField.label}`,
          }),
        );
      }
    }

    // 供应商名空：A 类
    if (!values.name.trim()) {
      issues.push(
        t("providerForm.fillSupplierName", {
          defaultValue: "请填写供应商名称",
        }),
      );
    } else if (appId === "codex") {
      const submittedEnvKey = (
        getCodexProviderEnvKeyFromSettings({
          config: codexConfig,
          env: { envKey: codexEnvKey },
        }) || codexEnvKey
      ).trim();

      if (category !== "official" && !submittedEnvKey) {
        const message = t("providerForm.envKeyRequired", {
          defaultValue: "请填写环境变量名",
        });
        setCodexEnvKeyError(message);
        toast.error(message);
        return;
      }

      if (submittedEnvKey && !CODEX_ENV_KEY_PATTERN.test(submittedEnvKey)) {
        const message = t("providerForm.envKeyInvalid", {
          defaultValue:
            "环境变量名只能以字母或下划线开头，并且只能包含字母、数字、下划线",
        });
        setCodexEnvKeyError(message);
        toast.error(message);
        return;
      }

      const initialEnvKey = getCodexProviderEnvKeyFromSettings(
        initialData?.settingsConfig,
      );

      let finalEnvKey = submittedEnvKey;
      if (
        finalEnvKey &&
        isCodexEnvKeyDuplicate(finalEnvKey, {
          currentEnvKey: initialEnvKey,
          currentProviderId: providerId,
          providers: existingCodexProviders,
        })
      ) {
        let counter = 1;
        while (
          isCodexEnvKeyDuplicate(`${finalEnvKey}_${counter}`, {
            currentEnvKey: initialEnvKey,
            currentProviderId: providerId,
            providers: existingCodexProviders,
          })
        ) {
          counter++;
        }
        finalEnvKey = `${finalEnvKey}_${counter}`;

        toast.success(
          t("providerForm.envKeyAutoRenamed", {
            defaultValue: `环境变量名冲突，已自动调整为 ${finalEnvKey}`,
          }),
        );
      }
      setCodexEnvKeyError("");

      if (finalEnvKey !== submittedEnvKey) {
        setCodexEnvKey(finalEnvKey);
        setCodexConfig((prev) => setCodexEnvKeyInConfig(prev, finalEnvKey));
      }
      overriddenEnvKey = finalEnvKey;
    }

    // opencode / openclaw / hermes: providerKey 相关
    // A 类（空）归到 issues；B 类（正则不合法 / 重复 / 状态加载中）仍硬拒绝
    const keyPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

    if (appId === "opencode" && !isAnyOmoCategory) {
      // providerKey 是 opencode / openclaw / hermes 的主键 ID，空或格式不合法
      // 都属于完整性约束，保留硬拒绝（mutations 层也会 throw，软化只会让错误更晦涩）
      if (!opencodeForm.opencodeProviderKey.trim()) {
        toast.error(t("opencode.providerKeyRequired"));
        return;
      }
      if (!keyPattern.test(opencodeForm.opencodeProviderKey)) {
        toast.error(t("opencode.providerKeyInvalid"));
        return;
      }
      if (isProviderKeyLockStateLoading) {
        toast.error(
          t("providerForm.providerKeyStatusLoading", {
            defaultValue: "正在加载供应商标识状态，请稍后再试",
          }),
        );
        return;
      }
      if (
        !isProviderKeyLocked &&
        additiveExistingProviderKeys.includes(opencodeForm.opencodeProviderKey)
      ) {
        toast.error(t("opencode.providerKeyDuplicate"));
        return;
      }
      if (Object.keys(opencodeForm.opencodeModels).length === 0) {
        issues.push(t("opencode.modelsRequired"));
      }
    }

    if (appId === "openclaw") {
      if (!openclawForm.openclawProviderKey.trim()) {
        toast.error(t("openclaw.providerKeyRequired"));
        return;
      }
      if (!keyPattern.test(openclawForm.openclawProviderKey)) {
        toast.error(t("openclaw.providerKeyInvalid"));
        return;
      }
      if (isProviderKeyLockStateLoading) {
        toast.error(
          t("providerForm.providerKeyStatusLoading", {
            defaultValue: "正在加载供应商标识状态，请稍后再试",
          }),
        );
        return;
      }
      if (
        !isProviderKeyLocked &&
        additiveExistingProviderKeys.includes(openclawForm.openclawProviderKey)
      ) {
        toast.error(t("openclaw.providerKeyDuplicate"));
        return;
      }
    }

    if (appId === "hermes") {
      if (!hermesForm.hermesProviderKey.trim()) {
        toast.error(t("hermes.form.providerKeyRequired"));
        return;
      }
      if (!keyPattern.test(hermesForm.hermesProviderKey)) {
        toast.error(t("hermes.form.providerKeyInvalid"));
        return;
      }
      if (isProviderKeyLockStateLoading) {
        toast.error(
          t("providerForm.providerKeyStatusLoading", {
            defaultValue: "正在加载供应商标识状态，请稍后再试",
          }),
        );
        return;
      }
      if (
        !isProviderKeyLocked &&
        additiveExistingProviderKeys.includes(hermesForm.hermesProviderKey)
      ) {
        toast.error(t("hermes.form.providerKeyDuplicate"));
        return;
      }
    }

    // OAuth 未登录：B 类（token 根本不存在，保存了也没法建立）
    const isCopilotProvider =
      templatePreset?.providerType === "github_copilot" ||
      initialData?.meta?.providerType === "github_copilot" ||
      baseUrl.includes("githubcopilot.com");
    const isCodexOauthProvider =
      templatePreset?.providerType === "codex_oauth" ||
      initialData?.meta?.providerType === "codex_oauth";
    if (isCopilotProvider && !isCopilotAuthenticated) {
      toast.error(
        t("copilot.loginRequired", {
          defaultValue: "请先登录 GitHub Copilot",
        }),
      );
      return;
    }
    if (isCodexOauthProvider && !isCodexOauthAuthenticated) {
      toast.error(
        t("codexOauth.loginRequired", {
          defaultValue: "请先登录 ChatGPT 账号",
        }),
      );
      return;
    }

    // OMO Other Fields JSON：B 类（格式错了保存下去数据就坏了）
    if (
      appId === "opencode" &&
      isAnyOmoCategory &&
      omoDraft.omoOtherFieldsStr.trim()
    ) {
      try {
        const otherFields = parseOmoOtherFieldsObject(
          omoDraft.omoOtherFieldsStr,
        );
        if (!otherFields) {
          toast.error(
            t("omo.jsonMustBeObject", {
              field: t("omo.otherFields", {
                defaultValue: "Other Config",
              }),
              defaultValue: "{{field}} must be a JSON object",
            }),
          );
          return;
        }
      } catch {
        toast.error(
          t("omo.invalidJson", {
            defaultValue: "Other Fields contains invalid JSON",
          }),
        );
        return;
      }
    }

    // 非官方供应商端点 / API Key 空：A 类
    // cloud_provider（如 Bedrock）通过模板变量处理认证，跳过通用校验
    if (category !== "official" && category !== "cloud_provider") {
      if (appId === "claude") {
        if (!isCodexOauthProvider && !baseUrl.trim()) {
          issues.push(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
        }
        if (!isCopilotProvider && !isCodexOauthProvider && !apiKey.trim()) {
          issues.push(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
        }
      } else if (appId === "codex") {
        if (!codexBaseUrl.trim()) {
          issues.push(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
        }
        if (!codexApiKey.trim()) {
          issues.push(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
        }
      } else if (appId === "gemini") {
        if (!geminiBaseUrl.trim()) {
          issues.push(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
        }
        if (!geminiApiKey.trim()) {
          issues.push(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
        }
      }
    }

    if (issues.length > 0) {
      // 弹确认框让用户决定是否仍要保存
      setSoftIssues(issues);
      setPendingFormValues(values);
      setPendingCodexEnvKeyOverride(
        appId === "codex" ? overriddenEnvKey : undefined,
      );
      return;
    }

    await performSubmit(
      values,
      appId === "codex" ? overriddenEnvKey : undefined,
    );
  };

  const performSubmit = async (
    values: ProviderFormData,
    resolvedEnvKeyOverride?: string,
  ) => {
    const resolvedCodexSubagentThreads = codexSubagentThreads.trim();
    // OAuth / 其它身份识别（与 handleSubmit 保持一致）
    const isCopilotProvider =
      templatePreset?.providerType === "github_copilot" ||
      initialData?.meta?.providerType === "github_copilot" ||
      baseUrl.includes("githubcopilot.com");
    const isCodexOauthProvider =
      templatePreset?.providerType === "codex_oauth" ||
      initialData?.meta?.providerType === "codex_oauth";

    let settingsConfig: string;

    if (appId === "codex") {
      try {
        const codexAuthObject = parseCodexAuthObject(codexAuth);
        let normalizedCodexConfig =
          category !== "official" && (codexConfig ?? "").trim()
            ? removeCodexExperimentalBearerToken(
                setCodexWireApi(codexConfig ?? "", "responses"),
              )
            : (codexConfig ?? "");
        const requestedCodexEnvKey = (
          resolvedEnvKeyOverride ||
          getCodexProviderEnvKeyFromSettings({
            config: normalizedCodexConfig,
            env: { envKey: codexEnvKey },
          }) ||
          codexEnvKey
        ).trim();
        if (requestedCodexEnvKey) {
          normalizedCodexConfig = setCodexEnvKeyInConfig(
            normalizedCodexConfig,
            requestedCodexEnvKey,
          );
        }
        if (category !== "official") {
          normalizedCodexConfig = setCodexBaseUrlInConfig(
            normalizedCodexConfig,
            codexBaseUrl,
          );
        }
        const normalizedCatalogModels =
          category !== "official" && localCodexApiFormat === "openai_chat"
            ? normalizeCodexCatalogModelsForSave(codexCatalogModels)
            : [];

        if (normalizedCatalogModels.length > 0) {
          normalizedCodexConfig = setCodexModelNameInConfig(
            normalizedCodexConfig,
            normalizedCatalogModels[0].model,
          );
        }

        const routeIdMatch = normalizedCodexConfig.match(
          /^\s*model_provider\s*=\s*"([^"]+)"/m,
        );
        const routeId = routeIdMatch?.[1] || "tuziswitch";
        let resolvedCodexEnvKey = requestedCodexEnvKey;

        if (resolvedCodexEnvKey && codexBaseUrl) {
          const savedRoute = await invoke<SaveCodexRouteResult>(
            "save_codex_route",
            {
              routeId,
              baseUrl: codexBaseUrl,
              envKey: resolvedCodexEnvKey,
              apiKey: codexApiKey || "",
              model:
                normalizedCatalogModels[0]?.model ||
                codexModelName ||
                "gpt-5.5",
              modelReasoningEffort: "high",
              profileName: values.name.trim(),
              providerId,
              configText: normalizedCodexConfig,
            },
          );
          if (savedRoute?.config) {
            normalizedCodexConfig = savedRoute.config;
            resolvedCodexEnvKey = savedRoute.envKey || resolvedCodexEnvKey;
          }
        }

        const configObj: {
          auth: Record<string, unknown>;
          config: string;
          env: { envKey: string };
          modelCatalog?: { models: CodexCatalogModel[] };
        } = {
          auth: resolvedCodexEnvKey ? {} : codexAuthObject,
          config: normalizedCodexConfig,
          env: { envKey: resolvedCodexEnvKey },
        };
        if (normalizedCatalogModels.length > 0) {
          configObj.modelCatalog = { models: normalizedCatalogModels };
        }
        settingsConfig = JSON.stringify(configObj);
      } catch (err) {
        let fallbackConfig = (codexConfig ?? "").trim()
          ? removeCodexExperimentalBearerToken(
              setCodexWireApi(codexConfig ?? "", "responses"),
            )
          : (codexConfig ?? "");
        const fallbackEnvKey = (
          resolvedEnvKeyOverride ||
          getCodexProviderEnvKeyFromSettings({
            config: fallbackConfig,
            env: { envKey: codexEnvKey },
          }) ||
          codexEnvKey
        ).trim();
        if (fallbackEnvKey) {
          fallbackConfig = setCodexEnvKeyInConfig(
            fallbackConfig,
            fallbackEnvKey,
          );
        }
        settingsConfig = JSON.stringify({
          auth: fallbackEnvKey ? {} : parseCodexAuthObject(codexAuth),
          config: fallbackConfig,
          env: {
            envKey: fallbackEnvKey,
          },
        });
      }
    } else if (appId === "gemini") {
      try {
        const envObj = envStringToObj(geminiEnv);
        const configObj = geminiConfig.trim() ? JSON.parse(geminiConfig) : {};
        const combined = {
          env: envObj,
          config: configObj,
        };
        settingsConfig = JSON.stringify(combined);
      } catch (err) {
        settingsConfig = values.settingsConfig.trim();
      }
    } else if (
      appId === "opencode" &&
      (category === "omo" || category === "omo-slim")
    ) {
      const omoConfig: Record<string, unknown> = {};
      if (Object.keys(omoDraft.omoAgents).length > 0) {
        omoConfig.agents = omoDraft.omoAgents;
      }
      if (
        category === "omo" &&
        Object.keys(omoDraft.omoCategories).length > 0
      ) {
        omoConfig.categories = omoDraft.omoCategories;
      }
      if (omoDraft.omoOtherFieldsStr.trim()) {
        // 格式已在 handleSubmit 前置校验中验证过，此处可以安全解析
        const otherFields = parseOmoOtherFieldsObject(
          omoDraft.omoOtherFieldsStr,
        );
        if (otherFields) {
          omoConfig.otherFields = otherFields;
        }
      }
      settingsConfig = JSON.stringify(omoConfig);
    } else {
      settingsConfig = values.settingsConfig.trim();
    }

    const payload: ProviderFormValues = {
      ...values,
      name: values.name.trim(),
      settingsConfig,
    };

    if (appId === "opencode") {
      if (isAnyOmoCategory) {
        if (!isEditMode) {
          const prefix = category === "omo" ? "omo" : "omo-slim";
          payload.providerKey = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
        }
      } else {
        payload.providerKey = opencodeForm.opencodeProviderKey;
      }
    } else if (appId === "openclaw") {
      payload.providerKey = openclawForm.openclawProviderKey;
    } else if (appId === "hermes") {
      payload.providerKey = hermesForm.hermesProviderKey;
    }

    if (isAnyOmoCategory && !payload.presetCategory) {
      payload.presetCategory = category;
    }

    if (activePreset) {
      payload.presetId = activePreset.id;
      if (activePreset.category) {
        payload.presetCategory = activePreset.category;
      }
      // OpenClaw: 传递预设的 suggestedDefaults 到提交数据
      if (activePreset.suggestedDefaults) {
        payload.suggestedDefaults = activePreset.suggestedDefaults;
      }
    }

    if (!isEditMode && draftCustomEndpoints.length > 0) {
      const customEndpointsToSave: Record<
        string,
        import("@/types").CustomEndpoint
      > = draftCustomEndpoints.reduce(
        (acc, url) => {
          const now = Date.now();
          acc[url] = { url, addedAt: now, lastUsed: undefined };
          return acc;
        },
        {} as Record<string, import("@/types").CustomEndpoint>,
      );

      const hadEndpoints =
        initialData?.meta?.custom_endpoints &&
        Object.keys(initialData.meta.custom_endpoints).length > 0;
      const needsClearEndpoints =
        hadEndpoints && draftCustomEndpoints.length === 0;

      let mergedMeta = needsClearEndpoints
        ? mergeProviderMeta(initialData?.meta, {})
        : mergeProviderMeta(initialData?.meta, customEndpointsToSave);

      if (mergedMeta !== undefined) {
        payload.meta = mergedMeta;
      }
    }

    const baseMeta: ProviderMeta | undefined =
      payload.meta ?? (initialData?.meta ? { ...initialData.meta } : undefined);

    // 确定 providerType（新建时从预设获取，编辑时从现有数据获取）
    const providerType =
      templatePreset?.providerType || initialData?.meta?.providerType;

    const nextMeta: ProviderMeta = {
      ...(baseMeta ?? {}),
      commonConfigEnabled:
        appId === "claude"
          ? useCommonConfig
          : appId === "codex"
            ? useCodexCommonConfigFlag
            : appId === "gemini"
              ? useGeminiCommonConfigFlag
              : undefined,
      endpointAutoSelect,
      claudeDesktopMode: undefined,
      // 保存 providerType（用于识别 Copilot / Codex OAuth 等特殊供应商）
      providerType,
      authBinding: isCopilotProvider
        ? {
            source: "managed_account",
            authProvider: "github_copilot",
            accountId: selectedGitHubAccountId ?? undefined,
          }
        : isCodexOauthProvider
          ? {
              source: "managed_account",
              authProvider: "codex_oauth",
              accountId: selectedCodexAccountId ?? undefined,
            }
          : undefined,
      // GitHub Copilot 多账号：保存关联的账号 ID
      githubAccountId:
        isCopilotProvider && selectedGitHubAccountId
          ? selectedGitHubAccountId
          : undefined,
      codexFastMode: isCodexOauthProvider ? codexFastMode : undefined,
      codexSubagentThreads:
        appId === "codex" && resolvedCodexSubagentThreads
          ? Number(resolvedCodexSubagentThreads)
          : undefined,
      testConfig: testConfig.enabled ? testConfig : undefined,
      costMultiplier: pricingConfig.enabled
        ? pricingConfig.costMultiplier
        : undefined,
      pricingModelSource:
        pricingConfig.enabled && pricingConfig.pricingModelSource !== "inherit"
          ? pricingConfig.pricingModelSource
          : undefined,
      apiFormat:
        appId === "claude" && category !== "official"
          ? localApiFormat
          : appId === "codex" && category !== "official"
            ? localCodexApiFormat
            : undefined,
      codexChatReasoning:
        appId === "codex" &&
        category !== "official" &&
        localCodexApiFormat === "openai_chat"
          ? normalizeCodexChatReasoningForSave(codexChatReasoning)
          : undefined,
      apiKeyField:
        appId === "claude" &&
        category !== "official" &&
        localApiKeyField !== "ANTHROPIC_AUTH_TOKEN"
          ? localApiKeyField
          : undefined,
      isFullUrl:
        supportsFullUrl && category !== "official" && localIsFullUrl
          ? true
          : undefined,
    };

    if (!isCodexOauthProvider && "codexFastMode" in nextMeta) {
      delete nextMeta.codexFastMode;
    }

    payload.meta = nextMeta;

    await onSubmit(payload);
  };

  const groupedPresets = useMemo(() => {
    return presetEntries.reduce<Record<string, PresetEntry[]>>((acc, entry) => {
      const category = entry.preset.category ?? "others";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(entry);
      return acc;
    }, {});
  }, [presetEntries]);

  const categoryKeys = useMemo(() => {
    return Object.keys(groupedPresets).filter(
      (key) => key !== "custom" && groupedPresets[key]?.length,
    );
  }, [groupedPresets]);

  const shouldShowSpeedTest =
    category !== "official" && category !== "cloud_provider";

  const {
    shouldShowApiKeyLink: shouldShowClaudeApiKeyLink,
    websiteUrl: claudeApiKeyUrl,
  } = useApiKeyLink({
    appId: "claude",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    providerId,
  });

  const { shouldShowApiKeyLink: shouldShowCodexApiKeyLink } = useApiKeyLink({
    appId: "codex",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    providerId,
  });
  const selectedCodexPreset =
    appId === "codex" && selectedPresetId && selectedPresetId !== "custom"
      ? presetEntries.find((item) => item.id === selectedPresetId)?.preset
      : undefined;
  const codexApiKeyUrl =
    appId === "codex" &&
    selectedCodexPreset &&
    "apiKeyUrl" in selectedCodexPreset
      ? (selectedCodexPreset.apiKeyUrl as string | undefined)
      : appId === "codex" && !selectedPresetId && providerId
        ? // Edit mode: use provider's websiteUrl as apiKeyUrl
          (initialData as any)?.websiteUrl ||
          ((
            presetEntries.find(
              (entry) =>
                entry.id === providerId &&
                "apiKeyUrl" in entry.preset &&
                (entry.preset as any).apiKeyUrl,
            )?.preset as any
          )?.apiKeyUrl as string | undefined)
        : undefined;

  const {
    shouldShowApiKeyLink: shouldShowGeminiApiKeyLink,
    websiteUrl: geminiApiKeyUrl,
  } = useApiKeyLink({
    appId: "gemini",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    providerId,
  });

  const { shouldShowApiKeyLink: shouldShowOpencodeApiKeyLink } = useApiKeyLink({
    appId: "opencode",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    providerId,
  });

  // 使用 API Key 链接 hook (OpenClaw)
  const { shouldShowApiKeyLink: shouldShowOpenclawApiKeyLink } = useApiKeyLink({
    appId: "openclaw",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    providerId,
  });
  const { websiteUrl: openclawApiKeyUrl } = useApiKeyLink({
    appId: "openclaw",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    providerId,
  });
  const {
    shouldShowApiKeyLink: shouldShowHermesApiKeyLink,
    websiteUrl: hermesApiKeyUrl,
  } = useApiKeyLink({
    appId: "hermes",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
    providerId,
  });

  // 使用端点测速候选 hook
  const speedTestEndpoints = useSpeedTestEndpoints({
    appId,
    selectedPresetId,
    presetEntries,
    baseUrl,
    codexBaseUrl,
    initialData,
  });

  const handlePresetChange = (value: string) => {
    setSelectedPresetId(value);
    if (value === "custom") {
      setActivePreset(null);
      form.reset(defaultValues);

      if (appId === "codex") {
        const template = getCodexCustomTemplate();
        resetCodexConfig(
          template.auth,
          template.config,
          "CUSTOM_CODEX_API_KEY",
        );
        setCodexChatReasoning({});
        setLocalCodexApiFormat(
          codexApiFormatFromWireApi(extractCodexWireApi(template.config)) ??
            "openai_responses",
        );
      }
      if (appId === "gemini") {
        resetGeminiConfig({}, {});
      }
      if (appId === "opencode") {
        opencodeForm.resetOpencodeState();
        omoDraft.resetOmoDraftState();
      }
      // OpenClaw 自定义模式：重置为空配置
      if (appId === "openclaw") {
        openclawForm.resetOpenclawState();
      }
      if (appId === "hermes") {
        hermesForm.resetHermesState();
      }
      return;
    }

    const entry = presetEntries.find((item) => item.id === value);
    if (!entry) {
      return;
    }

    setActivePreset({
      id: value,
      category: entry.preset.category,
    });

    if (appId === "codex") {
      const preset = entry.preset as CodexProviderPreset;
      let config = preset.config ?? "";
      let envKey = preset.envKey ?? "";
      const baseName = preset.nameKey ? t(preset.nameKey) : preset.name;
      let displayName = buildPresetPrefixedName(
        baseName,
        CODEX_CUSTOM_NAME_DEFAULT,
      );

      let defaultApiKey = "";
      if (isCodexTuziPreset(preset)) {
        const nextTuziRoute = resolveNextCodexTuziRoute(
          existingCodexProviders,
          shellEnvKeys,
        );
        envKey = nextTuziRoute.envKey;
        config = generateThirdPartyConfig(
          nextTuziRoute.routeId,
          preset.endpointCandidates?.[0] || "https://api.tu-zi.com/v1",
          envKey,
          "gpt-5.5",
        );
        defaultApiKey = shellEnvKeys?.[envKey] ?? "";
        if (nextTuziRoute.index > 1) {
          displayName = `${displayName}_${nextTuziRoute.index}`;
        }
      } else if (isCodexCodingPreset(preset)) {
        const nextCodingRoute = resolveNextCodexCodingRoute(
          existingCodexProviders,
          shellEnvKeys,
        );
        envKey = nextCodingRoute.envKey;
        config = generateThirdPartyConfig(
          nextCodingRoute.routeId,
          preset.endpointCandidates?.[0] || "https://api.tu-zi.com/coding",
          envKey,
          "gpt-5.5",
        );
        defaultApiKey = shellEnvKeys?.[envKey] ?? "";
        if (nextCodingRoute.index > 1) {
          displayName = `${displayName}_${nextCodingRoute.index}`;
        }
      } else if (existingCodexProviders) {
        // Compute suffix: only count providers that actually have a key in shell rc
        const allMatching = Object.values(existingCodexProviders).filter(
          (p) => {
            const nameMatches =
              p.name === displayName ||
              p.name.match(
                new RegExp(
                  `^${displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_\\d+$`,
                ),
              );
            if (!nameMatches) return false;
            // Check if actually configured: env_key exists AND has value in shell rc
            const envKeyName = getCodexProviderEnvKeyFromSettings(
              p.settingsConfig,
            );
            if (!envKeyName) return false;
            return Boolean(shellEnvKeys?.[envKeyName]);
          },
        );
        const count = allMatching.length;

        if (count > 0) {
          const suffix = count + 1;
          displayName = `${displayName}_${suffix}`;

          // Extract base route_id from config
          const routeIdMatch = config.match(
            /^\s*model_provider\s*=\s*"([^"]+)"/m,
          );
          const baseRouteId = routeIdMatch?.[1] || "tuziswitch";
          const newRouteId = `${baseRouteId}_${suffix}`;

          // Generate new env_key with suffix
          const baseEnvKey = preset.envKey || "CUSTOM_CODEX_API_KEY";
          envKey = `${baseEnvKey}_${suffix}`;

          if (shellEnvKeys?.[baseEnvKey]) {
            defaultApiKey = shellEnvKeys[baseEnvKey];
          }

          // Regenerate config with suffixed route_id and env_key
          config = generateThirdPartyConfig(
            newRouteId,
            preset.endpointCandidates?.[0] || "",
            envKey,
            "gpt-5.5",
          );
        }
      }

      resetCodexConfig({}, config, envKey, defaultApiKey);
      setCodexChatReasoning({});
      setLocalCodexApiFormat(
        codexApiFormatFromWireApi(extractCodexWireApi(config)) ??
          "openai_responses",
      );

      form.reset({
        name: displayName,
        settingsConfig: JSON.stringify(
          { auth: {}, config, env: { envKey } },
          null,
          2,
        ),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    if (appId === "gemini") {
      const preset = entry.preset as GeminiProviderPreset;
      const env = (preset.settingsConfig as any)?.env ?? {};
      const config = (preset.settingsConfig as any)?.config ?? {};

      resetGeminiConfig(env, config);

      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        settingsConfig: JSON.stringify(preset.settingsConfig, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    if (appId === "opencode") {
      const preset = entry.preset as OpenCodeProviderPreset;
      const config = preset.settingsConfig;

      if (preset.category === "omo" || preset.category === "omo-slim") {
        omoDraft.resetOmoDraftState();
        form.reset({
          name: preset.category === "omo" ? "OMO" : "OMO Slim",
          settingsConfig: JSON.stringify({}, null, 2),
          icon: preset.icon ?? "",
          iconColor: preset.iconColor ?? "",
        });
        return;
      }

      opencodeForm.resetOpencodeState(config);

      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    // OpenClaw preset handling
    if (appId === "openclaw") {
      const preset = entry.preset as OpenClawProviderPreset;
      const config = preset.settingsConfig;

      // Update activePreset with suggestedDefaults for OpenClaw
      setActivePreset({
        id: value,
        category: preset.category,
        suggestedDefaults: preset.suggestedDefaults,
      });

      openclawForm.resetOpenclawState(config);

      openclawForm.setOpenclawProviderKey(
        preset.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, ""),
      );

      // Update form fields
      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    // Hermes preset handling
    if (appId === "hermes") {
      const preset = entry.preset as HermesProviderPreset;
      const config = preset.settingsConfig;

      hermesForm.resetHermesState(config);
      hermesForm.setHermesProviderKey(
        preset.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, ""),
      );

      form.reset({
        name: preset.nameKey ? t(preset.nameKey) : preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    const preset = entry.preset as ProviderPreset;
    const config = applyTemplateValues(
      preset.settingsConfig,
      preset.templateValues,
    );

    if (preset.apiFormat) {
      setLocalApiFormat(preset.apiFormat);
    } else {
      setLocalApiFormat("anthropic");
    }

    setLocalApiKeyField(preset.apiKeyField ?? "ANTHROPIC_AUTH_TOKEN");
    setLocalIsFullUrl(false);

    form.reset({
      name: preset.nameKey ? t(preset.nameKey) : preset.name,
      settingsConfig: JSON.stringify(config, null, 2),
      icon: preset.icon ?? "",
      iconColor: preset.iconColor ?? "",
    });
  };

  useEffect(() => {
    if (initialData || !selectedPresetId || selectedPresetId === "custom") {
      return;
    }
    if (activePreset?.id === selectedPresetId) {
      return;
    }
    handlePresetChange(selectedPresetId);
  }, [initialData, selectedPresetId, activePreset?.id]);

  const settingsConfigErrorField = (
    <FormField
      control={form.control}
      name="settingsConfig"
      render={() => (
        <FormItem className="space-y-0">
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <>
      <Form {...form}>
        <form
          id="provider-form"
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-6 glass rounded-xl p-6 border border-white/10"
        >
          {!initialData && (
            <ProviderPresetSelector
              selectedPresetId={selectedPresetId}
              groupedPresets={groupedPresets}
              categoryKeys={categoryKeys}
              presetCategoryLabels={presetCategoryLabels}
              onPresetChange={handlePresetChange}
              onUniversalPresetSelect={onUniversalPresetSelect}
              onManageUniversalProviders={onManageUniversalProviders}
              category={category}
            />
          )}

          <BasicFormFields
            form={form}
            hideNameAndNotes={appId === "openclaw" || appId === "hermes"}
            beforeNameSlot={
              appId === "opencode" && !isAnyOmoCategory ? (
                <div className="space-y-2">
                  <Label htmlFor="opencode-key">
                    {t("opencode.providerKey")}
                    <span className="text-destructive ml-1">*</span>
                  </Label>
                  <ImeSafeInput
                    id="opencode-key"
                    value={opencodeForm.opencodeProviderKey}
                    onValueChange={opencodeForm.setOpencodeProviderKey}
                    normalize={normalizeProviderKey}
                    placeholder={t("opencode.providerKeyPlaceholder")}
                    disabled={
                      isProviderKeyLocked || isProviderKeyLockStateLoading
                    }
                    className={
                      (additiveExistingProviderKeys.includes(
                        opencodeForm.opencodeProviderKey,
                      ) &&
                        !isProviderKeyLocked) ||
                      (opencodeForm.opencodeProviderKey.trim() !== "" &&
                        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                          opencodeForm.opencodeProviderKey,
                        ))
                        ? "border-destructive"
                        : ""
                    }
                  />
                  {additiveExistingProviderKeys.includes(
                    opencodeForm.opencodeProviderKey,
                  ) &&
                    !isProviderKeyLocked && (
                      <p className="text-xs text-destructive">
                        {t("opencode.providerKeyDuplicate")}
                      </p>
                    )}
                  {opencodeForm.opencodeProviderKey.trim() !== "" &&
                    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                      opencodeForm.opencodeProviderKey,
                    ) && (
                      <p className="text-xs text-destructive">
                        {t("opencode.providerKeyInvalid")}
                      </p>
                    )}
                  {!(
                    additiveExistingProviderKeys.includes(
                      opencodeForm.opencodeProviderKey,
                    ) && !isProviderKeyLocked
                  ) &&
                    (opencodeForm.opencodeProviderKey.trim() === "" ||
                      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                        opencodeForm.opencodeProviderKey,
                      )) && (
                      <p className="text-xs text-muted-foreground">
                        {isProviderKeyLocked
                          ? t("opencode.providerKeyLockedHint", {
                              defaultValue:
                                "该供应商已添加到应用配置中，供应商标识不可修改",
                            })
                          : t("opencode.providerKeyHint")}
                      </p>
                    )}
                </div>
              ) : appId === "openclaw" ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="openclaw-key">
                        {t("openclaw.providerKey")}
                        <span className="text-destructive ml-1">*</span>
                      </Label>
                      <ImeSafeInput
                        id="openclaw-key"
                        value={openclawForm.openclawProviderKey}
                        onValueChange={openclawForm.setOpenclawProviderKey}
                        normalize={normalizeProviderKey}
                        placeholder={t("openclaw.providerKeyPlaceholder")}
                        disabled={
                          isProviderKeyLocked || isProviderKeyLockStateLoading
                        }
                        className={
                          (additiveExistingProviderKeys.includes(
                            openclawForm.openclawProviderKey,
                          ) &&
                            !isProviderKeyLocked) ||
                          (openclawForm.openclawProviderKey.trim() !== "" &&
                            !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                              openclawForm.openclawProviderKey,
                            ))
                            ? "border-destructive"
                            : ""
                        }
                      />
                    </div>
                    <div className="w-[180px] space-y-1">
                      <Label htmlFor="openclaw-api-inline">
                        {t("openclaw.apiProtocol", {
                          defaultValue: "API 协议",
                        })}
                      </Label>
                      <Select
                        value={openclawForm.openclawApi}
                        onValueChange={openclawForm.handleOpenclawApiChange}
                      >
                        <SelectTrigger id="openclaw-api-inline">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {openclawApiProtocols.map((protocol) => (
                            <SelectItem
                              key={protocol.value}
                              value={protocol.value}
                            >
                              {protocol.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {additiveExistingProviderKeys.includes(
                    openclawForm.openclawProviderKey,
                  ) &&
                    !isProviderKeyLocked && (
                      <p className="text-xs text-destructive">
                        {t("openclaw.providerKeyDuplicate")}
                      </p>
                    )}
                  {openclawForm.openclawProviderKey.trim() !== "" &&
                    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                      openclawForm.openclawProviderKey,
                    ) && (
                      <p className="text-xs text-destructive">
                        {t("openclaw.providerKeyInvalid")}
                      </p>
                    )}
                  {!(
                    additiveExistingProviderKeys.includes(
                      openclawForm.openclawProviderKey,
                    ) && !isProviderKeyLocked
                  ) &&
                    (openclawForm.openclawProviderKey.trim() === "" ||
                      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                        openclawForm.openclawProviderKey,
                      )) && (
                      <p className="text-xs text-muted-foreground">
                        {isProviderKeyLocked
                          ? t("openclaw.providerKeyLockedHint", {
                              defaultValue:
                                "该供应商已添加到应用配置中，供应商标识不可修改",
                            })
                          : t("openclaw.providerKeyHint")}
                      </p>
                    )}
                </div>
              ) : appId === "hermes" ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="hermes-key">
                        {t("hermes.form.providerKey", {
                          defaultValue: "Provider Key",
                        })}
                        <span className="text-destructive ml-1">*</span>
                      </Label>
                      <ImeSafeInput
                        id="hermes-key"
                        value={hermesForm.hermesProviderKey}
                        onValueChange={hermesForm.setHermesProviderKey}
                        normalize={normalizeProviderKey}
                        placeholder={t("hermes.form.providerKeyPlaceholder", {
                          defaultValue: "my-provider",
                        })}
                        disabled={
                          isProviderKeyLocked || isProviderKeyLockStateLoading
                        }
                        className={
                          (additiveExistingProviderKeys.includes(
                            hermesForm.hermesProviderKey,
                          ) &&
                            !isProviderKeyLocked) ||
                          (hermesForm.hermesProviderKey.trim() !== "" &&
                            !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                              hermesForm.hermesProviderKey,
                            ))
                            ? "border-destructive"
                            : ""
                        }
                      />
                    </div>
                    <div className="w-[180px] space-y-1">
                      <Label htmlFor="hermes-api-mode-inline">
                        {t("hermes.form.apiMode", { defaultValue: "API 模式" })}
                      </Label>
                      <Select
                        value={hermesForm.hermesApiMode}
                        onValueChange={hermesForm.handleHermesApiModeChange}
                      >
                        <SelectTrigger id="hermes-api-mode-inline">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {hermesApiModes.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>
                              {t(mode.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {additiveExistingProviderKeys.includes(
                    hermesForm.hermesProviderKey,
                  ) &&
                    !isProviderKeyLocked && (
                      <p className="text-xs text-destructive">
                        {t("hermes.form.providerKeyDuplicate")}
                      </p>
                    )}
                  {hermesForm.hermesProviderKey.trim() !== "" &&
                    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                      hermesForm.hermesProviderKey,
                    ) && (
                      <p className="text-xs text-destructive">
                        {t("hermes.form.providerKeyInvalid")}
                      </p>
                    )}
                  {!(
                    additiveExistingProviderKeys.includes(
                      hermesForm.hermesProviderKey,
                    ) && !isProviderKeyLocked
                  ) &&
                    (hermesForm.hermesProviderKey.trim() === "" ||
                      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                        hermesForm.hermesProviderKey,
                      )) && (
                      <p className="text-xs text-muted-foreground">
                        {isProviderKeyLocked
                          ? t("hermes.form.providerKeyLockedHint", {
                              defaultValue:
                                "This provider is in Hermes config; key is locked.",
                            })
                          : t("hermes.form.providerKeyHint", {
                              defaultValue:
                                "Lowercase letters, numbers, and hyphens only. Used as the provider name in config.yaml.",
                            })}
                      </p>
                    )}
                </div>
              ) : undefined
            }
            afterNameSlot={
              appId === "gemini" ? (
                <div className="-mt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="gemini-model">
                      {t("provider.form.gemini.model", {
                        defaultValue: "模型",
                      })}
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFetchGeminiModels}
                      disabled={isFetchingGeminiModels}
                      className="h-7 gap-1"
                    >
                      {isFetchingGeminiModels ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {t("providerForm.fetchModels")}
                    </Button>
                  </div>
                  <ModelInputWithFetch
                    id="gemini-model"
                    value={geminiModel}
                    onChange={handleGeminiModelChange}
                    placeholder="gemini-3-pro-preview"
                    fetchedModels={geminiFetchedModels}
                    isLoading={isFetchingGeminiModels}
                  />
                </div>
              ) : appId === "codex" ? (
                <div className="-mt-1 space-y-2">
                  <div className="relative min-h-6 pr-28">
                    <Label htmlFor="codexModelName" className="leading-6">
                      {t("codexConfig.modelName", {
                        defaultValue: "模型名称",
                      })}
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFetchModels}
                      disabled={isFetchingModels}
                      className="absolute right-0 top-0 h-7 gap-1"
                    >
                      {isFetchingModels ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {t("providerForm.fetchModels")}
                    </Button>
                  </div>
                  <ModelInputWithFetch
                    id="codexModelName"
                    value={codexModelName}
                    onChange={(v) => handleCodexModelNameChange(v)}
                    placeholder={t("codexConfig.modelNamePlaceholder", {
                      defaultValue: "例如: gpt-5.4",
                    })}
                    fetchedModels={fetchedModels}
                    isLoading={isFetchingModels}
                  />
                  <p className="text-xs text-muted-foreground">
                    {codexModelName.trim()
                      ? t("codexConfig.modelNameHint", {
                          defaultValue:
                            "指定使用的模型，将自动更新到 config.toml 中",
                        })
                      : t("providerForm.modelHint", {
                          defaultValue: "💡 留空将使用供应商的默认模型",
                        })}
                  </p>
                </div>
              ) : undefined
            }
            hideNotes={appId === "codex" || appId === "gemini"}
          />

          {appId === "claude" && (
            <ClaudeFormFields
              providerId={providerId}
              shouldShowApiKey={
                (category !== "cloud_provider" ||
                  hasApiKeyField(watchedSettingsConfig, "claude")) &&
                shouldShowApiKey(watchedSettingsConfig, isEditMode)
              }
              apiKey={apiKey}
              onApiKeyChange={handleApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowClaudeApiKeyLink}
              websiteUrl={claudeApiKeyUrl}
              isCopilotPreset={
                templatePreset?.providerType === "github_copilot" ||
                initialData?.meta?.providerType === "github_copilot" ||
                baseUrl.includes("githubcopilot.com")
              }
              isCodexOauthPreset={
                templatePreset?.providerType === "codex_oauth" ||
                initialData?.meta?.providerType === "codex_oauth"
              }
              usesOAuth={
                templatePreset?.requiresOAuth === true ||
                templatePreset?.providerType === "github_copilot" ||
                initialData?.meta?.providerType === "github_copilot" ||
                baseUrl.includes("githubcopilot.com") ||
                templatePreset?.providerType === "codex_oauth" ||
                initialData?.meta?.providerType === "codex_oauth"
              }
              isCopilotAuthenticated={isCopilotAuthenticated}
              selectedGitHubAccountId={selectedGitHubAccountId}
              onGitHubAccountSelect={setSelectedGitHubAccountId}
              isCodexOauthAuthenticated={isCodexOauthAuthenticated}
              selectedCodexAccountId={selectedCodexAccountId}
              onCodexAccountSelect={setSelectedCodexAccountId}
              codexFastMode={codexFastMode}
              onCodexFastModeChange={setCodexFastMode}
              templateValueEntries={templateValueEntries}
              templateValues={templateValues}
              templatePresetName={templatePreset?.name || ""}
              onTemplateValueChange={handleTemplateValueChange}
              shouldShowSpeedTest={shouldShowSpeedTest}
              baseUrl={baseUrl}
              onBaseUrlChange={handleClaudeBaseUrlChange}
              isEndpointModalOpen={isEndpointModalOpen}
              onEndpointModalToggle={setIsEndpointModalOpen}
              onCustomEndpointsChange={
                isEditMode ? undefined : setDraftCustomEndpoints
              }
              autoSelect={endpointAutoSelect}
              onAutoSelectChange={setEndpointAutoSelect}
              showEndpointTools
              shouldShowModelSelector={category !== "official"}
              claudeModel={claudeModel}
              defaultHaikuModel={defaultHaikuModel}
              defaultSonnetModel={defaultSonnetModel}
              defaultOpusModel={defaultOpusModel}
              onModelChange={handleModelChange}
              speedTestEndpoints={speedTestEndpoints}
              apiFormat={localApiFormat}
              onApiFormatChange={handleApiFormatChange}
              apiKeyField={localApiKeyField}
              onApiKeyFieldChange={handleApiKeyFieldChange}
              isFullUrl={localIsFullUrl}
              onFullUrlChange={setLocalIsFullUrl}
            />
          )}

          {appId === "codex" && (
            <CodexFormFields
              providerId={providerId}
              codexEnvKey={codexEnvKey}
              onEnvKeyChange={handleCodexEnvKeyChange}
              envKeyError={codexEnvKeyError}
              codexApiKey={codexApiKey}
              onApiKeyChange={handleCodexApiKeyChange}
              credentialStatus={codexCredentialStatus}
              credentialError={codexCredentialError}
              onRetryCredentialLoad={retryCodexCredentialLoad}
              category={category}
              shouldShowApiKeyLink={shouldShowCodexApiKeyLink}
              websiteUrl={form.watch("websiteUrl") || ""}
              apiKeyUrl={codexApiKeyUrl}
              shouldShowSpeedTest={shouldShowSpeedTest}
              codexBaseUrl={codexBaseUrl}
              onBaseUrlChange={handleCodexBaseUrlChange}
              isFullUrl={localIsFullUrl}
              onFullUrlChange={setLocalIsFullUrl}
              isEndpointModalOpen={isCodexEndpointModalOpen}
              onEndpointModalToggle={setIsCodexEndpointModalOpen}
              onCustomEndpointsChange={
                isEditMode ? undefined : setDraftCustomEndpoints
              }
              autoSelect={endpointAutoSelect}
              onAutoSelectChange={setEndpointAutoSelect}
              apiFormat={localCodexApiFormat}
              onApiFormatChange={handleCodexApiFormatChange}
              codexChatReasoning={codexChatReasoning}
              onCodexChatReasoningChange={setCodexChatReasoning}
              subagentThreads={codexSubagentThreads}
              onSubagentThreadsChange={setCodexSubagentThreads}
              catalogModels={codexCatalogModels}
              onCatalogModelsChange={setCodexCatalogModels}
              speedTestEndpoints={speedTestEndpoints}
            />
          )}

          {appId === "gemini" && (
            <GeminiFormFields
              providerId={providerId}
              shouldShowApiKey={true}
              apiKey={geminiApiKey}
              onApiKeyChange={handleGeminiApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowGeminiApiKeyLink}
              websiteUrl={geminiApiKeyUrl}
              shouldShowSpeedTest={shouldShowSpeedTest}
              baseUrl={geminiBaseUrl}
              onBaseUrlChange={handleGeminiBaseUrlChange}
              isEndpointModalOpen={isEndpointModalOpen}
              onEndpointModalToggle={setIsEndpointModalOpen}
              onCustomEndpointsChange={setDraftCustomEndpoints}
              autoSelect={endpointAutoSelect}
              onAutoSelectChange={setEndpointAutoSelect}
              shouldShowModelField={false}
              model={geminiModel}
              onModelChange={handleGeminiModelChange}
              speedTestEndpoints={speedTestEndpoints}
            />
          )}

          {appId === "opencode" && !isAnyOmoCategory && (
            <OpenCodeFormFields
              npm={opencodeForm.opencodeNpm}
              onNpmChange={opencodeForm.handleOpencodeNpmChange}
              apiKey={opencodeForm.opencodeApiKey}
              onApiKeyChange={opencodeForm.handleOpencodeApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowOpencodeApiKeyLink}
              websiteUrl={form.watch("websiteUrl") || ""}
              baseUrl={opencodeForm.opencodeBaseUrl}
              onBaseUrlChange={opencodeForm.handleOpencodeBaseUrlChange}
              models={opencodeForm.opencodeModels}
              onModelsChange={opencodeForm.handleOpencodeModelsChange}
              extraOptions={opencodeForm.opencodeExtraOptions}
              onExtraOptionsChange={
                opencodeForm.handleOpencodeExtraOptionsChange
              }
            />
          )}

          {appId === "opencode" &&
            (category === "omo" || category === "omo-slim") && (
              <OmoFormFields
                modelOptions={omoModelOptions}
                modelVariantsMap={omoModelVariantsMap}
                presetMetaMap={omoPresetMetaMap}
                agents={omoDraft.omoAgents}
                onAgentsChange={omoDraft.setOmoAgents}
                categories={
                  category === "omo" ? omoDraft.omoCategories : undefined
                }
                onCategoriesChange={
                  category === "omo" ? omoDraft.setOmoCategories : undefined
                }
                otherFieldsStr={omoDraft.omoOtherFieldsStr}
                onOtherFieldsStrChange={omoDraft.setOmoOtherFieldsStr}
                isSlim={category === "omo-slim"}
              />
            )}

          {/* OpenClaw 专属字段 */}
          {appId === "openclaw" && (
            <OpenClawFormFields
              baseUrl={openclawForm.openclawBaseUrl}
              onBaseUrlChange={openclawForm.handleOpenclawBaseUrlChange}
              apiKey={openclawForm.openclawApiKey}
              onApiKeyChange={openclawForm.handleOpenclawApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowOpenclawApiKeyLink}
              websiteUrl={openclawApiKeyUrl}
              models={openclawForm.openclawModels}
              onModelsChange={openclawForm.handleOpenclawModelsChange}
              userAgent={openclawForm.openclawUserAgent}
              onUserAgentChange={openclawForm.handleOpenclawUserAgentChange}
              advancedExtra={
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("provider.name")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t("provider.namePlaceholder")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("provider.notes")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t("provider.notesPlaceholder")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              }
            />
          )}

          {/* Hermes 专属字段 */}
          {appId === "hermes" && (
            <HermesFormFields
              baseUrl={hermesForm.hermesBaseUrl}
              onBaseUrlChange={hermesForm.handleHermesBaseUrlChange}
              apiKey={hermesForm.hermesApiKey}
              onApiKeyChange={hermesForm.handleHermesApiKeyChange}
              category={category}
              shouldShowApiKeyLink={shouldShowHermesApiKeyLink}
              websiteUrl={hermesApiKeyUrl}
              apiMode={hermesForm.hermesApiMode}
              onApiModeChange={hermesForm.handleHermesApiModeChange}
              models={hermesForm.hermesModels}
              onModelsChange={hermesForm.handleHermesModelsChange}
              rateLimitDelay={hermesForm.hermesRateLimitDelay}
              onRateLimitDelayChange={
                hermesForm.handleHermesRateLimitDelayChange
              }
              advancedExtra={
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("provider.name")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t("provider.namePlaceholder")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("provider.notes")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t("provider.notesPlaceholder")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              }
            />
          )}

          {/* 配置编辑器：折叠面板 */}
          <div className="rounded-lg border border-border/50 bg-muted/20">
            <button
              type="button"
              className="flex w-full items-center justify-between p-4 hover:bg-muted/30 transition-colors"
              onClick={() => setIsConfigEditorOpen(!isConfigEditorOpen)}
            >
              <div className="flex items-center gap-3">
                {appId === "codex" ? (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <FileJson className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">
                  {appId === "codex"
                    ? t("codexConfig.configToml", { defaultValue: "TOML 配置" })
                    : t("provider.configJson", { defaultValue: "JSON 配置" })}
                </span>
              </div>
              {isConfigEditorOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <div
              className={cn(
                "overflow-hidden transition-all duration-200",
                isConfigEditorOpen
                  ? "max-h-[2000px] opacity-100"
                  : "max-h-0 opacity-0",
              )}
            >
              <div className="p-4 pt-0 space-y-4">
                {appId === "codex" ? (
                  <>
                    <CodexConfigEditor
                      authValue={codexAuth}
                      configValue={codexConfig}
                      onAuthChange={setCodexAuth}
                      onConfigChange={handleCodexConfigChange}
                      useCommonConfig={useCodexCommonConfigFlag}
                      onCommonConfigToggle={handleCodexCommonConfigToggle}
                      commonConfigSnippet={codexCommonConfigSnippet}
                      onCommonConfigSnippetChange={
                        handleCodexCommonConfigSnippetChange
                      }
                      onCommonConfigErrorClear={clearCodexCommonConfigError}
                      commonConfigError={codexCommonConfigError}
                      authError={codexAuthError}
                      configError={codexConfigError}
                      onExtract={handleCodexExtract}
                      isExtracting={isCodexExtracting}
                      isCommonConfigLoading={isCodexCommonConfigLoading}
                    />
                    {settingsConfigErrorField}
                  </>
                ) : appId === "gemini" ? (
                  <>
                    <GeminiConfigEditor
                      envValue={geminiEnv}
                      configValue={geminiConfig}
                      onEnvChange={handleGeminiEnvChange}
                      onConfigChange={handleGeminiConfigChange}
                      useCommonConfig={useGeminiCommonConfigFlag}
                      onCommonConfigToggle={handleGeminiCommonConfigToggle}
                      commonConfigSnippet={geminiCommonConfigSnippet}
                      onCommonConfigSnippetChange={
                        handleGeminiCommonConfigSnippetChange
                      }
                      onCommonConfigErrorClear={clearGeminiCommonConfigError}
                      commonConfigError={geminiCommonConfigError}
                      envError={envError}
                      configError={geminiConfigError}
                      onExtract={handleGeminiExtract}
                      isExtracting={isGeminiExtracting}
                    />
                    {settingsConfigErrorField}
                  </>
                ) : appId === "opencode" &&
                  (category === "omo" || category === "omo-slim") ? (
                  <div className="space-y-2">
                    <Label>{t("provider.configJson")}</Label>
                    <JsonEditor
                      value={omoDraft.mergedOmoJsonPreview}
                      onChange={() => {}}
                      rows={14}
                      showValidation={false}
                      language="json"
                    />
                  </div>
                ) : appId === "opencode" &&
                  category !== "omo" &&
                  category !== "omo-slim" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="settingsConfig">
                        {t("provider.configJson")}
                      </Label>
                      <JsonEditor
                        value={form.getValues("settingsConfig")}
                        onChange={(config) =>
                          form.setValue("settingsConfig", config)
                        }
                        placeholder={`{
  "npm": "@ai-sdk/openai-compatible",
  "options": {
    "baseURL": "https://your-api-endpoint.com",
    "apiKey": "your-api-key-here"
  },
  "models": {}
}`}
                        rows={14}
                        showValidation={true}
                        language="json"
                      />
                    </div>
                    {settingsConfigErrorField}
                  </>
                ) : appId === "openclaw" || appId === "hermes" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="settingsConfig">
                        {t("provider.configJson")}
                      </Label>
                      <JsonEditor
                        value={form.getValues("settingsConfig")}
                        onChange={(config) =>
                          form.setValue("settingsConfig", config)
                        }
                        placeholder={
                          appId === "hermes"
                            ? `{
  "name": "my-provider",
  "base_url": "https://api.example.com/v1",
  "api_key": ""
}`
                            : `{
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "your-api-key-here",
  "api": "openai-completions",
  "models": []
}`
                        }
                        rows={14}
                        showValidation={true}
                        language="json"
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="settingsConfig"
                      render={() => (
                        <FormItem className="space-y-0">
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                ) : (
                  <>
                    <CommonConfigEditor
                      value={form.getValues("settingsConfig")}
                      onChange={(value) =>
                        form.setValue("settingsConfig", value)
                      }
                      useCommonConfig={useCommonConfig}
                      onCommonConfigToggle={handleCommonConfigToggle}
                      commonConfigSnippet={commonConfigSnippet}
                      onCommonConfigSnippetChange={
                        handleCommonConfigSnippetChange
                      }
                      commonConfigError={commonConfigError}
                      onEditClick={() => setIsCommonConfigModalOpen(true)}
                      isModalOpen={isCommonConfigModalOpen}
                      onModalClose={() => setIsCommonConfigModalOpen(false)}
                      onExtract={handleClaudeExtract}
                      isExtracting={isClaudeExtracting}
                    />
                    {settingsConfigErrorField}
                  </>
                )}
              </div>
            </div>
          </div>

          {!isAnyOmoCategory &&
            appId !== "opencode" &&
            appId !== "openclaw" &&
            appId !== "hermes" && (
              <ProviderAdvancedConfig
                testConfig={testConfig}
                pricingConfig={pricingConfig}
                onTestConfigChange={setTestConfig}
                onPricingConfigChange={setPricingConfig}
              />
            )}

          {showButtons && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={onCancel}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || isConfirmSubmitting}
              >
                {submitLabel}
              </Button>
            </div>
          )}
        </form>
      </Form>

      <ConfirmDialog
        isOpen={showCommonConfigNotice}
        variant="info"
        title={t("confirm.commonConfig.title")}
        message={t("confirm.commonConfig.message")}
        confirmText={t("confirm.commonConfig.confirm")}
        onConfirm={() => void handleCommonConfigConfirm()}
        onCancel={() => void handleCommonConfigConfirm()}
      />

      <ConfirmDialog
        isOpen={softIssues !== null && softIssues.length > 0}
        variant="info"
        title={t("providerForm.softValidation.title", {
          defaultValue: "配置存在以下问题",
        })}
        message={
          (softIssues ?? []).map((issue) => `• ${issue}`).join("\n") +
          "\n\n" +
          t("providerForm.softValidation.hint", {
            defaultValue:
              "仍要保存吗？保存后切换此供应商时可能失败，可以之后再补全。",
          })
        }
        confirmText={t("providerForm.softValidation.saveAnyway", {
          defaultValue: "仍要保存",
        })}
        cancelText={t("common.cancel")}
        onConfirm={async () => {
          if (isConfirmSubmitting) return;
          const values = pendingFormValues;
          if (!values) {
            setSoftIssues(null);
            return;
          }
          const issuesToRestore = softIssues;
          // Commit the nested dialog close before submit can close the parent
          // panel; otherwise React's async event batching can leave its portal
          // mounted over the provider list.
          flushSync(() => {
            setSoftIssues(null);
            setIsConfirmSubmitting(true);
          });
          try {
            await performSubmit(values, pendingCodexEnvKeyOverride);
            setPendingFormValues(null);
            setPendingCodexEnvKeyOverride(undefined);
          } catch (error) {
            console.error("[ProviderForm] soft-confirm submit failed:", error);
            // Restore the confirmation only when the actual save failed.
            setSoftIssues(issuesToRestore);
          } finally {
            setIsConfirmSubmitting(false);
          }
        }}
        onCancel={() => {
          if (isConfirmSubmitting) return;
          setSoftIssues(null);
          setPendingFormValues(null);
          setPendingCodexEnvKeyOverride(undefined);
        }}
      />
    </>
  );
}

export type ProviderFormValues = ProviderFormData & {
  presetId?: string;
  presetCategory?: ProviderCategory;
  meta?: ProviderMeta;
  providerKey?: string; // OpenCode/OpenClaw: user-defined provider key
  suggestedDefaults?: OpenClawSuggestedDefaults; // OpenClaw: suggested default model configuration
};
