import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import EndpointSpeedTest from "./EndpointSpeedTest";
import { ApiKeySection, EndpointField, ModelDropdown } from "./shared";
import {
  fetchModelsForConfig,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import type {
  CodexApiFormat,
  CodexCatalogModel,
  CodexChatReasoning,
  ProviderCategory,
} from "@/types";

interface EndpointCandidate {
  url: string;
}

interface CodexFormFieldsProps {
  providerId?: string;
  // Environment variable name
  codexEnvKey: string;
  onEnvKeyChange: (key: string) => void;
  envKeyError?: string;

  // API Key
  codexApiKey: string;
  onApiKeyChange: (key: string) => void;
  category?: ProviderCategory;
  shouldShowApiKeyLink: boolean;
  websiteUrl: string;
  apiKeyUrl?: string;

  // Base URL
  shouldShowSpeedTest: boolean;
  codexBaseUrl: string;
  onBaseUrlChange: (url: string) => void;
  isFullUrl: boolean;
  onFullUrlChange: (value: boolean) => void;
  isEndpointModalOpen: boolean;
  onEndpointModalToggle: (open: boolean) => void;
  onCustomEndpointsChange?: (endpoints: string[]) => void;
  autoSelect: boolean;
  onAutoSelectChange: (checked: boolean) => void;

  // API Format
  apiFormat: CodexApiFormat;
  onApiFormatChange: (format: CodexApiFormat) => void;
  codexChatReasoning?: CodexChatReasoning;
  onCodexChatReasoningChange?: (value: CodexChatReasoning) => void;

  // Model Catalog
  catalogModels?: CodexCatalogModel[];
  onCatalogModelsChange?: (models: CodexCatalogModel[]) => void;

  // Speed Test Endpoints
  speedTestEndpoints: EndpointCandidate[];
}

type CodexCatalogRow = CodexCatalogModel & { rowId: string };

function createCatalogRow(seed?: Partial<CodexCatalogModel>): CodexCatalogRow {
  return {
    rowId: crypto.randomUUID(),
    model: seed?.model ?? "",
    displayName: seed?.displayName ?? "",
    contextWindow: seed?.contextWindow ?? "",
  };
}

function catalogRowsMatchModels(
  rows: Array<Pick<CodexCatalogRow, "model" | "displayName" | "contextWindow">>,
  models: CodexCatalogModel[],
): boolean {
  if (rows.length !== models.length) return false;
  return rows.every((row, i) => {
    const incoming = models[i];
    return (
      row.model === (incoming.model ?? "") &&
      (row.displayName ?? "") === (incoming.displayName ?? "") &&
      String(row.contextWindow ?? "") === String(incoming.contextWindow ?? "")
    );
  });
}

export function CodexFormFields({
  providerId,
  codexEnvKey,
  onEnvKeyChange,
  envKeyError,
  codexApiKey,
  onApiKeyChange,
  category,
  shouldShowApiKeyLink,
  websiteUrl,
  apiKeyUrl,
  shouldShowSpeedTest,
  codexBaseUrl,
  onBaseUrlChange,
  isFullUrl,
  onFullUrlChange,
  isEndpointModalOpen,
  onEndpointModalToggle,
  onCustomEndpointsChange,
  autoSelect,
  onAutoSelectChange,
  apiFormat,
  onApiFormatChange,
  codexChatReasoning = {},
  onCodexChatReasoningChange,
  catalogModels = [],
  onCatalogModelsChange,
  speedTestEndpoints,
}: CodexFormFieldsProps) {
  const { t } = useTranslation();
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const needsLocalRouting = apiFormat === "openai_chat";
  const canEditCatalog = Boolean(onCatalogModelsChange);
  const canEditReasoning = Boolean(onCodexChatReasoningChange);
  const supportsThinking =
    codexChatReasoning.supportsThinking === true ||
    codexChatReasoning.supportsEffort === true;
  const supportsEffort = codexChatReasoning.supportsEffort === true;

  const [catalogRows, setCatalogRows] = useState<CodexCatalogRow[]>(() =>
    catalogModels.map((m) => createCatalogRow(m)),
  );
  const lastSentModelsRef = useRef<CodexCatalogModel[]>(catalogModels);

  useEffect(() => {
    setCatalogRows((current) => {
      if (catalogRowsMatchModels(current, catalogModels)) return current;
      return catalogModels.map((m) => createCatalogRow(m));
    });
    lastSentModelsRef.current = catalogModels;
  }, [catalogModels]);

  useEffect(() => {
    if (!onCatalogModelsChange) return;
    const next: CodexCatalogModel[] = catalogRows.map(
      ({ rowId: _rowId, ...rest }) => rest,
    );
    if (catalogRowsMatchModels(catalogRows, lastSentModelsRef.current)) return;
    lastSentModelsRef.current = next;
    onCatalogModelsChange(next);
  }, [catalogRows, onCatalogModelsChange]);

  const handleLocalRoutingChange = useCallback(
    (checked: boolean) => {
      onApiFormatChange(checked ? "openai_chat" : "openai_responses");
    },
    [onApiFormatChange],
  );

  const handleReasoningThinkingChange = useCallback(
    (checked: boolean) => {
      if (!onCodexChatReasoningChange) return;
      onCodexChatReasoningChange({
        ...codexChatReasoning,
        supportsThinking: checked,
        supportsEffort: checked ? codexChatReasoning.supportsEffort : false,
      });
    },
    [codexChatReasoning, onCodexChatReasoningChange],
  );

  const handleReasoningEffortChange = useCallback(
    (checked: boolean) => {
      if (!onCodexChatReasoningChange) return;
      onCodexChatReasoningChange({
        ...codexChatReasoning,
        supportsThinking: checked ? true : codexChatReasoning.supportsThinking,
        supportsEffort: checked,
        effortParam: checked
          ? (codexChatReasoning.effortParam ?? "reasoning_effort")
          : "none",
      });
    },
    [codexChatReasoning, onCodexChatReasoningChange],
  );

  const handleFetchModels = useCallback(() => {
    if (!codexBaseUrl || !codexApiKey) {
      showFetchModelsError(null, t, {
        hasApiKey: !!codexApiKey,
        hasBaseUrl: !!codexBaseUrl,
      });
      return;
    }
    setIsFetchingModels(true);
    fetchModelsForConfig(codexBaseUrl, codexApiKey, isFullUrl)
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
  }, [codexBaseUrl, codexApiKey, isFullUrl, t]);

  const handleAddCatalogRow = useCallback(() => {
    if (!onCatalogModelsChange) return;
    setCatalogRows((current) => [...current, createCatalogRow()]);
  }, [onCatalogModelsChange]);

  const handleUpdateCatalogRow = useCallback(
    (index: number, patch: Partial<CodexCatalogModel>) => {
      setCatalogRows((current) =>
        current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const handleRemoveCatalogRow = useCallback((index: number) => {
    setCatalogRows((current) => current.filter((_, i) => i !== index));
  }, []);

  return (
    <>
      <div className="space-y-2">
        <FormLabel htmlFor="codexEnvKey">
          {t("providerForm.envKeyName", {
            defaultValue: "环境变量名",
          })}
        </FormLabel>
        <Input
          id="codexEnvKey"
          value={codexEnvKey}
          onChange={(event) =>
            onEnvKeyChange(event.target.value.replace(/[^A-Za-z0-9_]/g, ""))
          }
          placeholder="TUZI01_CODEX_API_KEY"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={Boolean(envKeyError)}
        />
        {envKeyError ? (
          <p className="text-xs leading-relaxed text-destructive">
            {envKeyError}
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("providerForm.envKeyHint", {
              defaultValue:
                "用于写入 shell 环境变量，并同步到 config.toml 的 env_key",
            })}
          </p>
        )}
      </div>

      {/* Codex API Key 输入框 */}
      <ApiKeySection
        id="codexApiKey"
        label="API Key"
        value={codexApiKey}
        onChange={onApiKeyChange}
        category={category}
        shouldShowLink={shouldShowApiKeyLink}
        websiteUrl={apiKeyUrl || websiteUrl}
        linkPlacement="right"
        placeholder={{
          official: t("providerForm.codexApiKeyAutoFill", {
            defaultValue: "输入 API Key，将自动填充到配置",
          }),
          thirdParty: t("providerForm.codexApiKeyAutoFill", {
            defaultValue: "输入 API Key，将自动填充到配置",
          }),
        }}
      />

      {/* Codex Base URL 输入框 */}
      {shouldShowSpeedTest && (
        <EndpointField
          id="codexBaseUrl"
          label={t("codexConfig.apiUrlLabel")}
          value={codexBaseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("providerForm.codexApiEndpointPlaceholder")}
          showFullUrlToggle
          isFullUrl={isFullUrl}
          onFullUrlChange={onFullUrlChange}
          showManageButton={false}
          hideInput
        />
      )}

      {shouldShowSpeedTest && (
        <EndpointSpeedTest
          appId="codex"
          providerId={providerId}
          value={codexBaseUrl}
          onChange={onBaseUrlChange}
          initialEndpoints={speedTestEndpoints}
          variant="inline"
          visible
          onClose={() => onEndpointModalToggle(false)}
          autoSelect={autoSelect}
          onAutoSelectChange={onAutoSelectChange}
          onCustomEndpointsChange={onCustomEndpointsChange}
        />
      )}

      {shouldShowSpeedTest && (
        <div className="space-y-3 rounded-md border border-border-default bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <FormLabel>
                {t("codexConfig.localRoutingToggle", {
                  defaultValue: "需要本地路由映射",
                })}
              </FormLabel>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {needsLocalRouting
                  ? t("codexConfig.localRoutingOnHint", {
                      defaultValue:
                        "供应商使用 Chat Completions 或非 GPT 模型时，需保持本地路由开启。",
                    })
                  : t("codexConfig.localRoutingOffHint", {
                      defaultValue:
                        "原生 OpenAI Responses 线路可保持关闭；非原生线路请开启。",
                    })}
              </p>
            </div>
            <Switch
              checked={needsLocalRouting}
              onCheckedChange={handleLocalRoutingChange}
              aria-label={t("codexConfig.localRoutingToggle", {
                defaultValue: "需要本地路由映射",
              })}
            />
          </div>
        </div>
      )}

      {needsLocalRouting && canEditReasoning && (
        <Collapsible
          open={reasoningExpanded}
          onOpenChange={setReasoningExpanded}
          className="rounded-md border border-border-default p-4"
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant={null}
              size="sm"
              className="h-8 w-full justify-start gap-1.5 px-0 text-sm font-medium text-foreground hover:opacity-70"
            >
              {reasoningExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {t("codexConfig.reasoningSectionToggle", {
                defaultValue: "思考能力（高级·通常自动识别）",
              })}
            </Button>
          </CollapsibleTrigger>
          {!reasoningExpanded && (
            <p className="ml-1 mt-1 text-xs text-muted-foreground">
              {t("codexConfig.reasoningSectionHint", {
                defaultValue: "仅当自动识别不准时展开手动覆盖。",
              })}
            </p>
          )}
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <FormLabel>
                  {t("codexConfig.reasoningModeToggle", {
                    defaultValue: "支持思考模式",
                  })}
                </FormLabel>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("codexConfig.reasoningModeHint", {
                    defaultValue:
                      "上游 Chat Completions 接口支持 thinking 开关时启用。",
                  })}
                </p>
              </div>
              <Switch
                checked={supportsThinking}
                onCheckedChange={handleReasoningThinkingChange}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border-default pt-3">
              <div className="space-y-1">
                <FormLabel>
                  {t("codexConfig.reasoningEffortToggle", {
                    defaultValue: "支持思考等级",
                  })}
                </FormLabel>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("codexConfig.reasoningEffortHint", {
                    defaultValue:
                      "上游支持 low/high/max 等思考深度控制时启用。",
                  })}
                </p>
              </div>
              <Switch
                checked={supportsEffort}
                onCheckedChange={handleReasoningEffortChange}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {needsLocalRouting && canEditCatalog && (
        <div className="space-y-4 rounded-md border border-border-default p-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <FormLabel>
                {t("codexConfig.modelMappingTitle", {
                  defaultValue: "模型映射",
                })}
              </FormLabel>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels}
                  className="h-7 gap-1"
                >
                  {isFetchingModels ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t("providerForm.fetchModels")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddCatalogRow}
                  className="h-7 gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("codexConfig.addCatalogModel", {
                    defaultValue: "添加模型",
                  })}
                </Button>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("codexConfig.modelMappingHint", {
                defaultValue:
                  "生成 Codex model_catalog_json，让 /model 命令显示这些第三方模型名。",
              })}
            </p>
          </div>

          {catalogRows.length > 0 && (
            <div className="space-y-2">
              <div className="hidden grid-cols-[1fr_1fr_140px_36px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
                <span>
                  {t("codexConfig.catalogColumnDisplay", {
                    defaultValue: "菜单显示名",
                  })}
                </span>
                <span>
                  {t("codexConfig.catalogColumnModel", {
                    defaultValue: "实际请求模型",
                  })}
                </span>
                <span>
                  {t("codexConfig.catalogColumnContext", {
                    defaultValue: "上下文窗口",
                  })}
                </span>
                <span />
              </div>

              {catalogRows.map((row, index) => (
                <div
                  key={row.rowId}
                  className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_140px_36px]"
                >
                  <Input
                    value={row.displayName ?? ""}
                    onChange={(event) =>
                      handleUpdateCatalogRow(index, {
                        displayName: event.target.value,
                      })
                    }
                    placeholder={t(
                      "codexConfig.catalogDisplayNamePlaceholder",
                      {
                        defaultValue: "例如: DeepSeek V4 Flash",
                      },
                    )}
                  />
                  <div className="flex gap-1">
                    <Input
                      value={row.model}
                      onChange={(event) =>
                        handleUpdateCatalogRow(index, {
                          model: event.target.value,
                        })
                      }
                      placeholder={t("codexConfig.catalogModelPlaceholder", {
                        defaultValue: "例如: deepseek-v4-flash",
                      })}
                      className="flex-1"
                    />
                    {fetchedModels.length > 0 && (
                      <ModelDropdown
                        models={fetchedModels}
                        onSelect={(id) =>
                          handleUpdateCatalogRow(index, {
                            model: id,
                            displayName: row.displayName?.trim()
                              ? row.displayName
                              : id,
                          })
                        }
                      />
                    )}
                  </div>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={row.contextWindow ?? ""}
                    onChange={(event) =>
                      handleUpdateCatalogRow(index, {
                        contextWindow: event.target.value.replace(/[^\d]/g, ""),
                      })
                    }
                    placeholder={t("codexConfig.contextWindowPlaceholder", {
                      defaultValue: "例如: 128000",
                    })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveCatalogRow(index)}
                    title={t("common.delete", { defaultValue: "删除" })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 端点测速弹窗 - Codex（兼容旧入口；当前表单默认内嵌） */}
      {shouldShowSpeedTest && isEndpointModalOpen && (
        <EndpointSpeedTest
          appId="codex"
          providerId={providerId}
          value={codexBaseUrl}
          onChange={onBaseUrlChange}
          initialEndpoints={speedTestEndpoints}
          visible={isEndpointModalOpen}
          onClose={() => onEndpointModalToggle(false)}
          autoSelect={autoSelect}
          onAutoSelectChange={onAutoSelectChange}
          onCustomEndpointsChange={onCustomEndpointsChange}
        />
      )}
    </>
  );
}
