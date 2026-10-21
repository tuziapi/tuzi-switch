import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AddProviderDialog } from "./AddProviderDialog";
import { generateThirdPartyConfig } from "@/config/codexProviderPresets";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { AppId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { Provider } from "@/types";
import {
  TUZI_TOOL_TARGETS,
  type TuziProviderDraft,
} from "@/lib/tuziToolCompatibility";
import type { ProviderFormProps } from "./forms/ProviderForm";

export function tuziCreationPrefill(
  draft: TuziProviderDraft,
): ProviderFormProps["initialData"] {
  const endpoint = TUZI_TOOL_TARGETS.find(
    (t) => t.appId === draft.appId && t.protocol === draft.protocol,
  )!.endpoint;
  const model = draft.model ?? "";
  const keyName = draft.name?.trim();
  const name = keyName ? `兔子线路-${keyName}` : "兔子线路";
  let settingsConfig: Record<string, unknown> = {};
  let meta: Provider["meta"];
  if (draft.appId === "claude" || draft.appId === "claude-desktop") {
    settingsConfig = {
      env: {
        ANTHROPIC_BASE_URL: endpoint,
        ANTHROPIC_AUTH_TOKEN: draft.key,
        ...(model ? { ANTHROPIC_MODEL: model } : {}),
      },
    };
    meta = {
      apiFormat: "anthropic",
      ...(draft.appId === "claude-desktop"
        ? {
            claudeDesktopMode: "proxy" as const,
            ...(model
              ? { claudeDesktopModelRoutes: { "claude-sonnet-4-6": { model } } }
              : {}),
          }
        : {}),
    };
  } else if (draft.appId === "codex") {
    const suffix = crypto
      .randomUUID()
      .replace(/-/g, "")
      .slice(0, 12)
      .toUpperCase();
    const envKey = `TUZI_SWITCH_${suffix}_CODEX_API_KEY`;
    settingsConfig = {
      auth: { OPENAI_API_KEY: draft.key },
      env: { envKey },
      config: generateThirdPartyConfig("兔子线路", endpoint, envKey, model),
    };
  } else if (draft.appId === "gemini")
    settingsConfig = {
      env: {
        GEMINI_API_KEY: draft.key,
        GOOGLE_GEMINI_BASE_URL: endpoint,
        ...(model ? { GEMINI_MODEL: model } : {}),
      },
      config: {},
    };
  else if (draft.appId === "opencode")
    settingsConfig = {
      npm: {
        responses: "@ai-sdk/openai",
        chat: "@ai-sdk/openai-compatible",
        anthropic: "@ai-sdk/anthropic",
        gemini: "@ai-sdk/google",
      }[draft.protocol],
      options: { baseURL: endpoint, apiKey: draft.key },
      models: model ? { [model]: { name: model } } : {},
    };
  else if (draft.appId === "openclaw")
    settingsConfig = {
      baseUrl: endpoint,
      apiKey: draft.key,
      api:
        draft.protocol === "anthropic"
          ? "anthropic-messages"
          : "openai-completions",
      models: model ? [{ id: model, name: model }] : [],
    };
  else
    settingsConfig = {
      base_url: endpoint,
      api_key: draft.key,
      api_mode:
        draft.protocol === "anthropic"
          ? "anthropic_messages"
          : "codex_responses",
      models: model ? [{ id: model }] : [],
    };
  return {
    name,
    notes: draft.name ? `账户密钥：${draft.name}` : undefined,
    websiteUrl: "https://api.tu-zi.com",
    settingsConfig,
    category: "aggregator",
    icon: "tuzi",
    meta,
    providerKey: `tuzi-${crypto.randomUUID()}`,
  };
}
interface Preview {
  id: string;
  changes: string[];
}
export function TuziProviderDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: TuziProviderDraft;
  onClose: () => void;
  onSaved?: (providerId: string) => void;
}) {
  const initial = useMemo(() => tuziCreationPrefill(draft), [draft]);
  const savingRef = useRef(false);
  const alive = useRef(true);
  const queryClient = useQueryClient();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const safeError = (error: unknown) =>
    String(error).split(draft.key).join("[已脱敏]");
  return (
    <AddProviderDialog
      open
      appId={draft.appId}
      creationPrefill={initial}
      onOpenChange={(open) => {
        if (!open && !savingRef.current) onClose();
      }}
      onSubmit={async (value) => {
        if (savingRef.current) return false;
        savingRef.current = true;
        const { providerKey, ...fields } = value;
        const provider = {
          ...fields,
          id: providerKey || crypto.randomUUID(),
        } as Provider;
        try {
          // The Add action authorizes the transaction. Prepare a fresh plan for
          // each attempt so native conflict checks and backups stay intact.
          const preview = await invoke<Preview>("tuzi_provider_preview", {
            app: draft.appId,
            provider,
          });
          if (!alive.current) return false;
          const outcome = await invoke<{
            backupId: string;
            enabled: boolean;
            tested: boolean;
          }>("tuzi_provider_save", {
            app: draft.appId,
            provider,
            previewId: preview.id,
            source: {
              site: "https://api.tu-zi.com",
              userId: draft.userId,
              tokenId: draft.tokenId,
              generation: draft.generation,
            },
          });
          await queryClient.invalidateQueries({
            queryKey: ["providers", draft.appId],
          });
          await queryClient.invalidateQueries({
            queryKey: ["tuziProviderSources"],
          });
          if (!alive.current) return false;
          toast.success(
            outcome.enabled ? "已保存并按工具规则启用" : "已保存，尚未启用",
          );
          onSaved?.(provider.id);
        } catch (error) {
          if (alive.current)
            toast.error("无法添加供应商", { description: safeError(error) });
          return false;
        } finally {
          savingRef.current = false;
        }
      }}
    />
  );
}

interface RecoveryEntry {
  backupId: string;
  app: string;
  providerId: string;
  createdAt: number;
  manualRecovery: boolean;
  backupPath: string;
}
export function TuziProviderRecovery({ appId }: { appId?: AppId } = {}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<RecoveryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const sources = useQuery({
    queryKey: ["tuziProviderSources", appId],
    queryFn: () =>
      invoke<
        {
          site: string;
          userId: string;
          tokenId: string;
          app: string;
          providerId: string;
        }[]
      >("tuzi_provider_sources", { app: appId ?? null }),
    enabled: open,
    staleTime: 0,
  });
  const backups = useQuery({
    queryKey: ["tuziProviderBackups", appId],
    queryFn: () =>
      invoke<RecoveryEntry[]>("tuzi_provider_backups", { app: appId ?? null }),
    enabled: open,
    staleTime: 0,
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(!open)}>
        工具配置备份与恢复
      </Button>
      {open && (
        <div className="space-y-2 rounded border p-3">
          <p className="text-sm">
            恢复会还原本次保存前的工具文件与供应商状态。检测到后续修改时停止，保留当前配置。
          </p>
          <p className="text-sm">
            已知本地来源关联（历史未关联卡片保持未知）：
          </p>
          {sources.data?.map((source) => (
            <p key={`${source.app}-${source.providerId}`} className="text-sm">
              {source.app} · {source.site} · 用户 {source.userId} · Key{" "}
              {source.tokenId} · 卡片 {source.providerId}
            </p>
          ))}
          {sources.error && <p role="alert">{String(sources.error)}</p>}
          {backups.isLoading && <p>正在读取本机备份…</p>}
          {backups.error && <p role="alert">{String(backups.error)}</p>}
          {backups.data?.length === 0 && <p>暂无可恢复的本机备份。</p>}
          {backups.data?.map((entry) => (
            <div
              key={entry.backupId}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>
                {entry.app} ·{" "}
                {new Date(entry.createdAt * 1000).toLocaleString()} ·{" "}
                {entry.backupId.slice(0, 8)}
              </span>
              <span>
                {entry.manualRecovery ? (
                  `需人工核对：${entry.backupPath}`
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setSelected(entry)}
                  >
                    恢复
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={!!selected}
        title="恢复工具配置"
        message="确认恢复至该次保存前的完整状态？恢复会核对文件和数据库，若已被其他操作修改则中止。"
        confirmText="核对并恢复"
        cancelText="取消"
        onCancel={() => setSelected(null)}
        onConfirm={async () => {
          if (!selected || busy) return;
          setBusy(true);
          try {
            await invoke("tuzi_provider_restore", {
              backupId: selected.backupId,
            });
            await client.invalidateQueries({ queryKey: ["providers"] });
            await backups.refetch();
            toast.success("已恢复保存前配置");
            setSelected(null);
          } catch (error) {
            toast.error(String(error));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
