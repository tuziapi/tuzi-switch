import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BasicFormFields } from "./BasicFormFields";
import { EndpointField } from "./shared/EndpointField";
import { ClaudeModelCatalog } from "./ClaudeModelCatalog";
import {
  isAutomaticCatalogRoute,
  isKnownNonChatModel,
  modelRouteId,
  routesNeedProxy,
  mergeCatalogRoutes,
  sortCatalog,
} from "@/lib/claudeDesktopModels";
import { ModelDropdown } from "./shared/ModelDropdown";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import type {
  ClaudeApiFormat,
  ClaudeDesktopModelRoute,
  ProviderCategory,
  ProviderMeta,
} from "@/types";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import {
  claudeDesktopProviderPresets,
  type ClaudeDesktopProviderPreset,
} from "@/config/claudeDesktopProviderPresets";
import {
  fetchClaudeDesktopModels,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";

export type ClaudeDesktopProviderFormValues = ProviderFormData & {
  presetId?: string;
  presetCategory?: ProviderCategory;
  meta?: ProviderMeta;
  providerKey?: string;
  suggestedDefaults?: OpenClawSuggestedDefaults;
};

type ApiKeyField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

type PresetEntry = {
  id: string;
  preset: ClaudeDesktopProviderPreset;
};

export interface ClaudeDesktopProviderFormProps {
  submitLabel: string;
  onSubmit: (values: ClaudeDesktopProviderFormValues) => Promise<void> | void;
  onCancel: () => void;
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
  creationPrefill?: ClaudeDesktopProviderFormProps["initialData"];
  showButtons?: boolean;
}

type RouteRow = {
  route: string;
  model: string;
  displayName: string;
  supports1m: boolean;
};

function envString(
  settingsConfig: Record<string, unknown> | undefined,
  key: string,
) {
  const env = settingsConfig?.env;
  if (!env || typeof env !== "object") return "";
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function clonePlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function initialRouteRows(
  routes: Record<string, ClaudeDesktopModelRoute> | undefined,
): RouteRow[] {
  return Object.entries(routes ?? {}).map(([route, value]) => ({
    route,
    model: value.model ?? "",
    displayName: value.displayName ?? "",
    supports1m: value.supports1m ?? false,
  }));
}

function resolveRouteRows(rows: RouteRow[]): RouteRow[] {
  const occupied = new Set(rows.map((row) => row.route.trim()).filter(Boolean));
  return rows
    .filter((row) => row.route.trim() || row.model.trim())
    .map((row) => {
      const model = row.model.trim();
      const route = row.route.trim() || modelRouteId(model, occupied);
      occupied.add(route);
      return { ...row, route, model, displayName: row.displayName.trim() };
    });
}

function isClaudeSafeRoute(route: string) {
  const normalized = route.trim().toLowerCase();
  return (
    normalized.startsWith("claude-") ||
    normalized.startsWith("anthropic/claude-")
  );
}

export function ClaudeDesktopProviderForm({
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  initialData: editData,
  creationPrefill,
  showButtons = true,
}: ClaudeDesktopProviderFormProps) {
  const { t } = useTranslation();
  const initialData = editData ?? creationPrefill;
  const initialMode = initialData?.meta?.claudeDesktopMode ?? "direct";
  const [mode, setMode] = useState<"direct" | "proxy">(initialMode);
  const [apiFormat, setApiFormat] = useState<ClaudeApiFormat>(
    initialData?.meta?.apiFormat ?? "anthropic",
  );
  const [baseUrl, setBaseUrl] = useState(
    envString(initialData?.settingsConfig, "ANTHROPIC_BASE_URL"),
  );
  const [apiKey, setApiKey] = useState(
    envString(initialData?.settingsConfig, "ANTHROPIC_AUTH_TOKEN") ||
      envString(initialData?.settingsConfig, "ANTHROPIC_API_KEY"),
  );
  const [apiKeyField, setApiKeyField] = useState<ApiKeyField>(() =>
    envString(initialData?.settingsConfig, "ANTHROPIC_API_KEY")
      ? "ANTHROPIC_API_KEY"
      : "ANTHROPIC_AUTH_TOKEN",
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    "custom",
  );
  const [activePreset, setActivePreset] = useState<{
    id: string;
    category?: ProviderCategory;
  } | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>(() =>
    initialRouteRows(initialData?.meta?.claudeDesktopModelRoutes).map((row) =>
      initialMode === "direct" ? { ...row, model: row.route } : row,
    ),
  );
  const needsModelMapping =
    mode === "proxy" || apiFormat !== "anthropic" || routesNeedProxy(routes);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>(() =>
    (initialData?.meta?.claudeDesktopModelCatalog ?? []).map((model) => ({
      ...model,
      ownedBy: null,
    })),
  );
  const [defaultModel, setDefaultModel] = useState(
    envString(initialData?.settingsConfig, "ANTHROPIC_MODEL"),
  );
  const [catalogError, setCatalogError] = useState("");
  const fetchedFor = useRef<{
    baseUrl: string;
    apiKey: string;
    at: number;
  } | null>(null);
  const credentials = useRef({ baseUrl, apiKey });
  useEffect(() => {
    if (
      credentials.current.baseUrl === baseUrl &&
      credentials.current.apiKey === apiKey
    )
      return;
    credentials.current = { baseUrl, apiKey };
    const automatic = new Set(fetchedModels.map((model) => model.id));
    setRoutes((rows) =>
      rows.filter(
        (row) =>
          !(
            automatic.has(row.model) && isAutomaticCatalogRoute(row.route, row)
          ),
      ),
    );
    if (automatic.has(defaultModel)) setDefaultModel("");
    setFetchedModels([]);
    fetchedFor.current = null;
    setCatalogError("");
  }, [baseUrl, apiKey]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [directModelsExpanded, setDirectModelsExpanded] = useState(
    initialMode === "direct" &&
      Object.keys(initialData?.meta?.claudeDesktopModelRoutes ?? {}).length > 0,
  );
  const defaultValues: ProviderFormData = useMemo(
    () => ({
      name: initialData?.name ?? "",
      websiteUrl: initialData?.websiteUrl ?? "",
      notes: initialData?.notes ?? "",
      settingsConfig: JSON.stringify(
        initialData?.settingsConfig ?? { env: {} },
        null,
        2,
      ),
      icon: initialData?.icon ?? "",
      iconColor: initialData?.iconColor ?? "",
    }),
    [initialData],
  );

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues,
    mode: "onSubmit",
  });

  useEffect(() => {
    onSubmittingChange?.(form.formState.isSubmitting || isFetchingModels);
  }, [form.formState.isSubmitting, isFetchingModels, onSubmittingChange]);

  const presetEntries = useMemo<PresetEntry[]>(
    () =>
      claudeDesktopProviderPresets.map((preset, index) => ({
        id: `claude-desktop-${index}`,
        preset,
      })),
    [],
  );

  const groupedPresets = useMemo(
    () =>
      presetEntries.reduce<Record<string, PresetEntry[]>>((acc, entry) => {
        const cat = entry.preset.category ?? "others";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(entry);
        return acc;
      }, {}),
    [presetEntries],
  );

  const categoryKeys = useMemo(
    () =>
      Object.keys(groupedPresets).filter(
        (key) => key !== "custom" && groupedPresets[key]?.length,
      ),
    [groupedPresets],
  );

  const presetCategoryLabels: Record<string, string> = useMemo(
    () => ({
      official: t("providerForm.categoryOfficial", { defaultValue: "官方" }),
      cn_official: t("providerForm.categoryCnOfficial", {
        defaultValue: "国内官方",
      }),
      aggregator: t("providerForm.categoryAggregation", {
        defaultValue: "聚合服务",
      }),
      third_party: t("providerForm.categoryThirdParty", {
        defaultValue: "第三方",
      }),
    }),
    [t],
  );

  const applyDesktopPreset = (preset: ClaudeDesktopProviderPreset) => {
    form.setValue("name", preset.nameKey ? t(preset.nameKey) : preset.name);
    form.setValue("websiteUrl", preset.websiteUrl);
    form.setValue("notes", "");
    form.setValue("icon", preset.icon ?? "");
    form.setValue("iconColor", preset.iconColor ?? "");

    setBaseUrl(preset.baseUrl);
    setApiKey("");
    setDefaultModel("");
    setApiKeyField(preset.apiKeyField ?? "ANTHROPIC_AUTH_TOKEN");
    setApiFormat(preset.apiFormat ?? "anthropic");

    setMode(preset.mode);
    if (preset.mode === "proxy" && preset.modelRoutes) {
      setRoutes(
        preset.modelRoutes.map((r) => ({
          route: r.routeId,
          model: r.upstreamModel,
          displayName: r.displayName,
          supports1m: r.supports1m,
        })),
      );
    } else {
      setRoutes([]);
    }
  };

  const handlePresetChange = (value: string) => {
    setSelectedPresetId(value);

    if (value === "custom") {
      setActivePreset(null);
      form.reset(defaultValues);
      setBaseUrl("");
      setApiKey("");
      setDefaultModel("");
      setApiKeyField("ANTHROPIC_AUTH_TOKEN");
      setApiFormat("anthropic");
      setMode("direct");
      setRoutes([]);
      return;
    }

    const entry = presetEntries.find((item) => item.id === value);
    if (!entry) return;

    setActivePreset({
      id: value,
      category: entry.preset.category,
    });
    applyDesktopPreset(entry.preset);
  };

  const updateRoute = (index: number, patch: Partial<RouteRow>) => {
    setRoutes((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        if (
          patch.model !== undefined &&
          (!row.route || isAutomaticCatalogRoute(row.route, row))
        ) {
          return { ...row, ...patch, route: "", displayName: "" };
        }
        return { ...row, ...patch };
      }),
    );
  };

  const loadCatalog = async () => {
    fetchedFor.current = null;
    setIsFetchingModels(true);
    setCatalogError("");
    try {
      const fetched = await fetchClaudeDesktopModels(
        baseUrl.trim(),
        apiKey.trim(),
      );
      const models = sortCatalog(fetched, defaultModel).map((model) => ({
        ...model,
        ownedBy: null,
      }));
      if (!models.length) throw new Error("empty catalog");
      const previousIds = new Set(fetchedModels.map((model) => model.id));
      const currentIds = new Set(models.map((model) => model.id));
      const existing = Object.fromEntries(
        resolveRouteRows(routes)
          .filter(
            (row) =>
              !isAutomaticCatalogRoute(row.route, row) ||
              !previousIds.has(row.model) ||
              currentIds.has(row.model),
          )
          .map((row) => [
            row.route,
            {
              model: row.model,
              displayName: row.displayName,
              supports1m: row.supports1m,
            },
          ]),
      );
      const merged = mergeCatalogRoutes(existing, models);
      const rows = initialRouteRows(merged);
      const chosen = rows.some((row) => row.model === defaultModel)
        ? defaultModel
        : (models.find((model) => !isKnownNonChatModel(model.id))?.id ??
          rows[0]?.model ??
          "");
      setFetchedModels(models);
      setRoutes(rows);
      setDefaultModel(chosen);
      fetchedFor.current = { baseUrl, apiKey, at: Date.now() };
      return { models, rows, chosen };
    } catch (error) {
      setCatalogError(t("claudeDesktop.catalogFailed"));
      showFetchModelsError(error, t);
      throw error;
    } finally {
      setIsFetchingModels(false);
    }
  };
  const handleFetchModels = async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      showFetchModelsError(null, t, {
        hasBaseUrl: Boolean(baseUrl.trim()),
        hasApiKey: Boolean(apiKey.trim()),
      });
      return;
    }
    try {
      await loadCatalog();
    } catch {
      /* Error is shown inline; keep manual configuration editable. */
    }
  };

  const handleSubmit = async (values: ProviderFormData, useManual = false) => {
    if (isFetchingModels) return;
    if (!values.name.trim()) {
      toast.error(
        t("providerForm.fillSupplierName", {
          defaultValue: "请填写供应商名称",
        }),
      );
      return;
    }
    if (!baseUrl.trim()) {
      toast.error(
        t("providerForm.fetchModelsNeedEndpoint", {
          defaultValue: "请先填写接口地址",
        }),
      );
      return;
    }
    if (!apiKey.trim()) {
      toast.error(
        t("providerForm.fetchModelsNeedApiKey", {
          defaultValue: "请先填写 API Key",
        }),
      );
      return;
    }

    let effectiveRows = routes;
    let effectiveModels = fetchedModels;
    let effectiveDefault = defaultModel;
    const cache = fetchedFor.current;
    if (
      !useManual &&
      (!cache ||
        cache.baseUrl !== baseUrl ||
        cache.apiKey !== apiKey ||
        Date.now() - cache.at > 300000)
    ) {
      try {
        const catalog = await loadCatalog();
        effectiveRows = catalog.rows;
        effectiveModels = catalog.models;
        effectiveDefault = catalog.chosen;
      } catch {
        return;
      }
    }
    const routeEntries = resolveRouteRows(effectiveRows);
    if (!routeEntries.length) {
      setCatalogError(t("claudeDesktop.catalogNoClaude"));
      setDirectModelsExpanded(true);
      return;
    }
    if (
      routeEntries.some((row) => !isClaudeSafeRoute(row.route)) ||
      new Set(routeEntries.map((row) => row.route)).size !== routeEntries.length
    ) {
      toast.error(t("claudeDesktop.routeAliasInvalid"));
      return;
    }
    if (routeEntries.some((row) => !row.model)) {
      toast.error(t("claudeDesktop.routeInvalid"));
      return;
    }
    if (routeEntries.some((row) => isKnownNonChatModel(row.model))) {
      toast.error(t("claudeDesktop.catalogNonChat"));
      return;
    }
    const effectiveMode =
      mode === "proxy" ||
      apiFormat !== "anthropic" ||
      routesNeedProxy(routeEntries)
        ? "proxy"
        : "direct";

    const settingsConfig = clonePlainRecord(initialData?.settingsConfig);
    const env = clonePlainRecord(settingsConfig.env);
    const otherKey: ApiKeyField =
      apiKeyField === "ANTHROPIC_AUTH_TOKEN"
        ? "ANTHROPIC_API_KEY"
        : "ANTHROPIC_AUTH_TOKEN";
    delete env[otherKey];
    settingsConfig.env = {
      ...env,
      ANTHROPIC_BASE_URL: baseUrl.trim().replace(/\/+$/, ""),
      [apiKeyField]: apiKey.trim(),
    };

    const routeMap = routeEntries.reduce<
      Record<string, ClaudeDesktopModelRoute>
    >((acc, route) => {
      acc[route.route] = {
        model: route.model || route.route,
        displayName:
          route.displayName ||
          (route.route !== route.model ? route.model : undefined),
        supports1m: route.supports1m || undefined,
      };
      return acc;
    }, {});

    const meta: ProviderMeta = {
      ...(initialData?.meta ?? {}),
      claudeDesktopMode: effectiveMode,
      apiFormat,
    };

    meta.claudeDesktopModelRoutes = routeMap;
    meta.claudeDesktopModelCatalog = effectiveModels.map(
      ({ id, createdAt }) => ({ id, ...(createdAt ? { createdAt } : {}) }),
    );
    const mappedModels = Object.values(routeMap).map((route) => route.model);
    const selectedModel = mappedModels.includes(effectiveDefault)
      ? effectiveDefault
      : mappedModels[0];
    (settingsConfig.env as Record<string, unknown>).ANTHROPIC_MODEL =
      selectedModel;

    delete meta.endpointAutoSelect;
    delete meta.providerType;
    delete meta.isFullUrl;

    await onSubmit({
      ...values,
      name: values.name.trim(),
      websiteUrl: values.websiteUrl?.trim() ?? "",
      notes: values.notes?.trim() ?? "",
      settingsConfig: JSON.stringify(settingsConfig, null, 2),
      meta,
      presetId: activePreset?.id,
      presetCategory: activePreset?.category ?? initialData?.category,
    });
  };

  const renderActionButtons = (onAdd: () => void, addLabel: string) => (
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
        {t("providerForm.fetchModels", { defaultValue: "获取模型" })}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        className="h-7 gap-1"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );

  return (
    <Form {...form}>
      <form
        id="provider-form"
        onSubmit={form.handleSubmit((values) => handleSubmit(values))}
        className="provider-form-shell space-y-6"
      >
        <fieldset
          disabled={isFetchingModels || form.formState.isSubmitting}
          className="space-y-6 min-w-0"
        >
          {!editData && (
            <ProviderPresetSelector
              selectedPresetId={selectedPresetId}
              groupedPresets={groupedPresets}
              categoryKeys={categoryKeys}
              presetCategoryLabels={presetCategoryLabels}
              onPresetChange={handlePresetChange}
              category={activePreset?.category}
            />
          )}

          <BasicFormFields form={form} />

          <div className="space-y-1">
            <Label htmlFor="claude-desktop-api-key">{"API Key"}</Label>
            <Input
              id="claude-desktop-api-key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              placeholder="sk-..."
            />
          </div>

          <EndpointField
            id="baseUrl"
            label={t("providerForm.apiEndpoint")}
            value={baseUrl}
            onChange={(v) => setBaseUrl(v)}
            placeholder={t("providerForm.apiEndpointPlaceholder")}
            hint={
              needsModelMapping && apiFormat === "openai_responses"
                ? t("providerForm.apiHintResponses")
                : needsModelMapping && apiFormat === "openai_chat"
                  ? t("providerForm.apiHintOAI")
                  : needsModelMapping && apiFormat === "gemini_native"
                    ? t("providerForm.apiHintGeminiNative")
                    : t("providerForm.apiHint")
            }
            showManageButton={false}
          />

          <div className="space-y-2">
            <Label htmlFor="claude-desktop-api-format">
              {t("providerForm.apiFormat", {
                defaultValue: "API 格式",
              })}
            </Label>
            <Select
              value={apiFormat}
              onValueChange={(value) => setApiFormat(value as ClaudeApiFormat)}
            >
              <SelectTrigger id="claude-desktop-api-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic Messages</SelectItem>
                <SelectItem value="openai_chat">
                  OpenAI Chat Completions
                </SelectItem>
                <SelectItem value="openai_responses">
                  OpenAI Responses
                </SelectItem>
                <SelectItem value="gemini_native">
                  Gemini generateContent
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("claudeDesktop.protocolHint")}
            </p>
          </div>

          <ClaudeModelCatalog
            models={fetchedModels}
            defaultModel={defaultModel}
            onSelect={(id) => {
              setDefaultModel(id);
              setRoutes((current) =>
                current.some((row) => row.model === id)
                  ? current
                  : [
                      ...current,
                      {
                        route: modelRouteId(
                          id,
                          current.map((row) => row.route),
                        ),
                        model: id,
                        displayName: id,
                        supports1m: false,
                      },
                    ],
              );
            }}
            onRefresh={() => void handleFetchModels()}
            busy={isFetchingModels || form.formState.isSubmitting}
            error={catalogError}
          />
          {catalogError && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void form.handleSubmit((values) =>
                  handleSubmit(values, true),
                )();
              }}
            >
              {t("claudeDesktop.catalogManualSave")}
            </Button>
          )}
          {needsModelMapping && (
            <p role="status" className="text-xs text-muted-foreground">
              {t("claudeDesktop.autoMappingHint")}
            </p>
          )}
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              {t("claudeDesktop.catalogAdvanced")}
            </summary>
            <div className="space-y-4 pt-4">
              <Collapsible
                open={directModelsExpanded}
                onOpenChange={setDirectModelsExpanded}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant={null}
                    size="sm"
                    className="h-8 gap-1.5 px-0 text-sm font-medium text-foreground hover:opacity-70"
                  >
                    {directModelsExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    {t("claudeDesktop.directModelListTitle")}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 rounded-lg border p-4 mt-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="flex-1 text-xs text-muted-foreground">
                      {t("claudeDesktop.directModelListHint")}
                    </p>
                    {renderActionButtons(
                      () =>
                        setRoutes((current) => [
                          ...current,
                          {
                            route: "",
                            model: "",
                            displayName: "",
                            supports1m: false,
                          },
                        ]),
                      t("claudeDesktop.addModel"),
                    )}
                  </div>
                  {routes.map((route, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_72px_36px]"
                    >
                      <div className="flex gap-1">
                        <Input
                          value={route.model}
                          onChange={(event) =>
                            updateRoute(index, { model: event.target.value })
                          }
                          aria-label={`${t("claudeDesktop.upstreamModelLabel")} ${index + 1}`}
                          placeholder="deepseek-chat / claude-sonnet-4-6"
                          className="flex-1"
                        />
                        {fetchedModels.length > 0 && (
                          <ModelDropdown
                            models={fetchedModels.filter(
                              (model) => !isKnownNonChatModel(model.id),
                            )}
                            onSelect={(id) => updateRoute(index, { model: id })}
                          />
                        )}
                      </div>
                      <Input
                        value={route.displayName}
                        onChange={(event) =>
                          updateRoute(index, {
                            displayName: event.target.value,
                          })
                        }
                        aria-label={`${t("claudeDesktop.displayNameLabel")} ${index + 1}`}
                        placeholder={t("claudeDesktop.displayNameLabel")}
                      />
                      <label className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                          checked={route.supports1m}
                          onCheckedChange={(checked) =>
                            updateRoute(index, { supports1m: checked === true })
                          }
                        />
                        1M
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${t("common.delete")} ${index + 1}`}
                        onClick={() =>
                          setRoutes((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>

              <FormField
                control={form.control}
                name="settingsConfig"
                render={() => (
                  <FormItem className="space-y-0">
                    <FormControl>
                      <input type="hidden" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </details>
        </fieldset>
        {showButtons && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || isFetchingModels}
            >
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
