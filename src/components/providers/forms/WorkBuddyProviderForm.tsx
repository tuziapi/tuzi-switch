import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormMessage } from "@/components/ui/form";
import { BasicFormFields } from "./BasicFormFields";
import JsonEditor from "@/components/JsonEditor";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import { authApi, providersApi } from "@/lib/api";
import type { WorkBuddyModelOwner } from "@/lib/api/providers";
import {
  WORKBUDDY_DEFAULT_CONFIG,
  WORKBUDDY_EFFORTS,
  setWorkBuddyCanDisableThinking,
  setWorkBuddyEffort,
  workbuddyProviderPresets,
  type WorkBuddyModel,
} from "@/config/workbuddyProviderPresets";
import type { ProviderFormProps, ProviderFormValues } from "./ProviderForm";

type WorkBuddyConfig = {
  vendor?: string;
  url?: string;
  apiKey?: string;
  api?: string;
  models?: WorkBuddyModel[];
};

const parseConfig = (
  value: Record<string, unknown> | undefined,
): WorkBuddyConfig =>
  value && typeof value === "object" ? (value as WorkBuddyConfig) : {};

const cloneModel = (model: WorkBuddyModel): WorkBuddyModel =>
  JSON.parse(JSON.stringify(model)) as WorkBuddyModel;

const editorSchema = z
  .object({
    vendor: z.string().optional(),
    url: z.string().optional(),
    apiKey: z.string().optional(),
    api: z.string().optional(),
    models: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          reasoning: z
            .object({
              supportedEfforts: z.array(z.enum(WORKBUDDY_EFFORTS)),
              defaultEffort: z.enum(WORKBUDDY_EFFORTS),
              canDisableThinking: z.boolean(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export function WorkBuddyProviderForm({
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  providerId,
  initialData,
  creationPrefill,
  showButtons = true,
}: ProviderFormProps) {
  const { t } = useTranslation();
  const source = initialData ?? creationPrefill;
  const initialConfig = parseConfig(source?.settingsConfig);
  const isOfficial = source?.category === "official";
  const [preset, setPreset] = useState(isOfficial ? "official" : "custom");
  const [vendor, setVendor] = useState(initialConfig.vendor ?? "");
  const [url, setUrl] = useState(initialConfig.url ?? "");
  const [apiKey, setApiKey] = useState(initialConfig.apiKey ?? "");
  const [models, setModels] = useState<WorkBuddyModel[]>(
    (initialConfig.models ?? []).map(cloneModel),
  );
  const [jsonMode, setJsonMode] = useState(false);
  const [baseConfig, setBaseConfig] = useState(initialConfig);
  const [jsonValue, setJsonValue] = useState(
    source?.settingsConfig
      ? JSON.stringify(source.settingsConfig, null, 2)
      : WORKBUDDY_DEFAULT_CONFIG,
  );
  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      name: source?.name ?? "",
      notes: source?.notes ?? "",
      websiteUrl: source?.websiteUrl ?? "",
      icon: source?.icon ?? "workbuddy",
      iconColor: source?.iconColor ?? "",
      settingsConfig: jsonValue,
    },
  });
  const { isSubmitting } = form.formState;
  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);
  const { data: modelOwners = [] } = useQuery({
    queryKey: ["workbuddy", "modelOwners"],
    queryFn: providersApi.workbuddyModelOwners,
  });

  const applyPreset = (value: string) => {
    setPreset(value);
    setJsonMode(false);
    if (value === "official") return;
    if (value === "custom") return;
    const selected = workbuddyProviderPresets[Number(value)];
    if (!selected) return;
    setVendor(selected.vendor);
    setUrl(selected.url);
    setApiKey(selected.apiKey ?? "");
    setModels(selected.models.map(cloneModel));
  };

  const updateModel = (index: number, patch: Partial<WorkBuddyModel>) =>
    setModels((current) =>
      current.map((model, item) =>
        item === index ? { ...model, ...patch } : model,
      ),
    );

  const updateEfforts = (
    index: number,
    effort: (typeof WORKBUDDY_EFFORTS)[number],
    enabled: boolean,
  ) =>
    setModels((current) =>
      current.map((model, position) =>
        position === index
          ? setWorkBuddyEffort(
              { ...model, supportsReasoning: true },
              effort,
              enabled,
            )
          : model,
      ),
    );

  const updateCanDisableThinking = (index: number, enabled: boolean) =>
    updateModel(index, setWorkBuddyCanDisableThinking(models[index], enabled));

  const structuredConfig = (): WorkBuddyConfig => ({
    ...baseConfig,
    vendor: vendor.trim() || undefined,
    url: url.trim() || undefined,
    apiKey: apiKey || undefined,
    api: baseConfig.api ?? "openai-completions",
    models,
  });
  const readEditor = () => {
    try {
      return editorSchema.parse(JSON.parse(jsonValue));
    } catch {
      toast.error(t("workbuddyForm.invalidJson"));
      return null;
    }
  };
  const toggleEditor = () => {
    if (jsonMode) {
      const edited = readEditor();
      if (!edited) return;
      setBaseConfig(edited);
      setVendor(edited.vendor ?? "");
      setUrl(edited.url ?? "");
      setApiKey(edited.apiKey ?? "");
      setModels(edited.models);
    } else setJsonValue(JSON.stringify(structuredConfig(), null, 2));
    setJsonMode(!jsonMode);
  };

  const submit = async (values: ProviderFormData) => {
    let config: WorkBuddyConfig;
    if (preset === "official") {
      config = {};
    } else if (jsonMode) {
      const edited = readEditor();
      if (!edited) return;
      config = edited;
    } else {
      config = structuredConfig();
    }
    const payload: ProviderFormValues = {
      ...values,
      name: values.name.trim(),
      settingsConfig: JSON.stringify(config, null, 2),
      presetCategory: preset === "official" ? "official" : "custom",
      meta: {
        ...(source?.meta ?? {}),
        authBinding: undefined,
      },
    };
    setJsonValue(JSON.stringify(config, null, 2));
    await onSubmit(payload);
  };

  const ownerFor = (modelId: string): WorkBuddyModelOwner | undefined =>
    modelOwners.find((item) => item.id === modelId.trim());

  return (
    <Form {...form}>
      <form
        id="provider-form"
        className="provider-form-shell space-y-6"
        onSubmit={form.handleSubmit(submit)}
      >
        {!initialData && (
          <div className="space-y-2">
            <Label>{t("providerPreset.title", { defaultValue: "预设" })}</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2"
              value={preset}
              onChange={(event) => applyPreset(event.target.value)}
            >
              <option value="custom">
                {t("providerPreset.custom", { defaultValue: "自定义" })}
              </option>
              <option value="official">WorkBuddy 官方登录</option>
              {workbuddyProviderPresets.map((item, index) => (
                <option key={item.name} value={String(index)}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <BasicFormFields form={form} />
        {preset === "official" ? (
          <div className="space-y-3 rounded-lg border p-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void authApi.workbuddyAccountOpenApp()}
              >
                <ExternalLink className="mr-1 h-4 w-4" />
                打开 WorkBuddy
              </Button>
          </div>
        ) : (
          !jsonMode && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Input
                    value={vendor}
                    onChange={(event) => setVendor(event.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>URL</Label>
                  <Input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://.../chat/completions"
                  />
                </div>
                <div className="space-y-2 md:col-span-3">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <Label>模型</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setModels((current) => [
                        ...current,
                        { id: "", supportsToolCall: true },
                      ])
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    添加模型
                  </Button>
                </div>
                {models.map((model, index) => (
                  <div className="space-y-3 rounded-md border p-3" key={index}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <Input
                        placeholder="模型 ID"
                        value={model.id}
                        onChange={(event) =>
                          updateModel(index, { id: event.target.value })
                        }
                      />
                      <Input
                        placeholder="显示名称"
                        value={model.name ?? ""}
                        onChange={(event) =>
                          updateModel(index, { name: event.target.value })
                        }
                      />
                    </div>
                    {(() => {
                      const owner = ownerFor(model.id);
                      if (!owner || owner.owner === providerId) return null;
                      return (
                        <p className="text-xs text-amber-600">
                          模型 ID 已被 {owner.owner ?? "WorkBuddy 自带模型"}{" "}
                          占用，保存前请先换一个 ID。
                        </p>
                      );
                    })()}
                    <div className="flex flex-wrap gap-3 text-sm">
                      <label>
                        <input
                          type="checkbox"
                          checked={model.supportsToolCall ?? false}
                          onChange={(event) =>
                            updateModel(index, {
                              supportsToolCall: event.target.checked,
                            })
                          }
                        />{" "}
                        工具调用
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={model.supportsImages ?? false}
                          onChange={(event) =>
                            updateModel(index, {
                              supportsImages: event.target.checked,
                            })
                          }
                        />{" "}
                        图片
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {WORKBUDDY_EFFORTS.map((effort) => (
                        <label key={effort}>
                          <input
                            type="checkbox"
                            checked={
                              model.reasoning?.supportedEfforts.includes(
                                effort,
                              ) ?? false
                            }
                            onChange={(event) =>
                              updateEfforts(index, effort, event.target.checked)
                            }
                          />{" "}
                          {effort}
                        </label>
                      ))}
                      <label>
                        <input
                          type="checkbox"
                          checked={model.reasoning?.canDisableThinking ?? true}
                          disabled={!model.reasoning}
                          onChange={(event) =>
                            updateCanDisableThinking(
                              index,
                              event.target.checked,
                            )
                          }
                        />{" "}
                        允许关闭思考
                      </label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setModels((current) =>
                          current.filter((_, item) => item !== index),
                        )
                      }
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )
        )}
        {preset !== "official" && (
          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleEditor}
            >
              {jsonMode ? "使用表单" : "编辑 JSON"}
            </Button>
            {jsonMode && (
              <JsonEditor
                value={jsonValue}
                onChange={setJsonValue}
                rows={16}
                showValidation
                language="json"
              />
            )}
          </div>
        )}
        {form.formState.errors.name && (
          <FormMessage>
            {String(form.formState.errors.name.message ?? "")}
          </FormMessage>
        )}
        {showButtons && (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
