import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AddProviderDialog } from "./AddProviderDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
    name: "兔子线路",
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
  type Pending = {
    provider: Provider;
    preview: Preview;
    resolve: (saved: boolean) => void;
  };
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const savingRef = useRef(false);
  const alive = useRef(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, []);
  const finish = (saved: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(saved);
  };
  const cancel = () => {
    if (savingRef.current) return;
    finish(false);
  };
  const safeError = (error: unknown) =>
    String(error).split(draft.key).join("[已脱敏]");
  return (
    <>
      <AddProviderDialog
        open
        appId={draft.appId}
        creationPrefill={initial}
        onOpenChange={(open) => {
          if (!open && !savingRef.current) {
            cancel();
            onClose();
          }
        }}
        onSubmit={async (value) => {
          setError("");
          const { providerKey, ...fields } = value;
          const provider = {
            ...fields,
            id: providerKey || crypto.randomUUID(),
          } as Provider;
          try {
            const preview = await invoke<Preview>("tuzi_provider_preview", {
              app: draft.appId,
              provider,
            });
            if (!alive.current) return false;
            const saved = await new Promise<boolean>((resolve) => {
              const next = { provider, preview, resolve };
              pendingRef.current = next;
              setPending(next);
            });
            if (!saved) return false;
          } catch (error) {
            if (alive.current)
              toast.error("无法添加供应商", { description: safeError(error) });
            return false;
          }
        }}
      />
      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
      >
        <DialogContent
          zIndex="top"
          className="max-w-2xl overflow-hidden"
          onEscapeKeyDown={(event) => {
            if (savingRef.current) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>确认配置变更</DialogTitle>
            <DialogDescription>
              模型 Key 已脱敏。保存前会备份配置；不会自动调用模型。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
              {pending?.preview.changes.join("\n\n")}
            </pre>
          </div>
          {error && <p role="alert" className="shrink-0 px-6 py-3 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={cancel}>
              返回修改
            </Button>
            <Button
              disabled={saving || !!error}
              onClick={async () => {
                const current = pendingRef.current;
                if (!current || savingRef.current) return;
                savingRef.current = true;
                setSaving(true);
                setError("");
                try {
                  const outcome = await invoke<{
                    backupId: string;
                    enabled: boolean;
                    tested: boolean;
                  }>("tuzi_provider_save", {
                    app: draft.appId,
                    provider: current.provider,
                    previewId: current.preview.id,
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
                  if (!alive.current) return;
                  toast.success(
                    outcome.enabled
                      ? "已保存并按工具规则启用"
                      : "已保存，尚未启用",
                    {
                      description: "未执行模型测试。可从本次完整备份恢复。",
                      duration: 20000,
                      action: {
                        label: "恢复配置",
                        onClick: () => {
                          void invoke("tuzi_provider_restore", {
                            backupId: outcome.backupId,
                          })
                            .then(async () => {
                              await queryClient.invalidateQueries({
                                queryKey: ["providers", draft.appId],
                              });
                              toast.success("已恢复保存前配置");
                            })
                            .catch(() =>
                              toast.error("恢复失败，请核对备份与当前配置"),
                            );
                        },
                      },
                    },
                  );
                  finish(true);
                  onSaved?.(current.provider.id);
                } catch (error) {
                  if (alive.current)
                    setError(
                      `保存失败：${safeError(error)}。请返回修改后重新添加。`,
                    );
                } finally {
                  savingRef.current = false;
                  if (alive.current) setSaving(false);
                }
              }}
            >
              {saving ? "正在备份并保存…" : "备份并保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface RecoveryEntry {backupId:string;app:string;providerId:string;createdAt:number;manualRecovery:boolean;backupPath:string}
export function TuziProviderRecovery({appId}:{appId?:AppId}={}) {
 const client=useQueryClient();
 const [open,setOpen]=useState(false);
 const [selected,setSelected]=useState<RecoveryEntry|null>(null);
 const [busy,setBusy]=useState(false);
 const sources=useQuery({queryKey:['tuziProviderSources',appId],queryFn:()=>invoke<{site:string;userId:string;tokenId:string;app:string;providerId:string}[]>('tuzi_provider_sources',{app:appId??null}),enabled:open,staleTime:0});
 const backups=useQuery({queryKey:['tuziProviderBackups',appId],queryFn:()=>invoke<RecoveryEntry[]>('tuzi_provider_backups',{app:appId??null}),enabled:open,staleTime:0});
 return <><Button variant="outline" onClick={()=>setOpen(!open)}>工具配置备份与恢复</Button>{open&&<div className="space-y-2 rounded border p-3">
 <p className="text-sm">恢复会还原本次保存前的工具文件与供应商状态。检测到后续修改时停止，保留当前配置。</p>
 <p className="text-sm">已知本地来源关联（历史未关联卡片保持未知）：</p>{sources.data?.map(source=><p key={`${source.app}-${source.providerId}`} className="text-sm">{source.app} · {source.site} · 用户 {source.userId} · Key {source.tokenId} · 卡片 {source.providerId}</p>)}{sources.error&&<p role="alert">{String(sources.error)}</p>}
 {backups.isLoading&&<p>正在读取本机备份…</p>}{backups.error&&<p role="alert">{String(backups.error)}</p>}
 {backups.data?.length===0&&<p>暂无可恢复的本机备份。</p>}
 {backups.data?.map(entry=><div key={entry.backupId} className="flex items-center justify-between gap-2 text-sm"><span>{entry.app} · {new Date(entry.createdAt*1000).toLocaleString()} · {entry.backupId.slice(0,8)}</span><span>{entry.manualRecovery?`需人工核对：${entry.backupPath}`:<Button variant="outline" size="sm" disabled={busy} onClick={()=>setSelected(entry)}>恢复</Button>}</span></div>)}
 </div>}<ConfirmDialog isOpen={!!selected} title="恢复工具配置" message="确认恢复至该次保存前的完整状态？恢复会核对文件和数据库，若已被其他操作修改则中止。" confirmText="核对并恢复" cancelText="取消" onCancel={()=>setSelected(null)} onConfirm={async()=>{if(!selected||busy)return;setBusy(true);try{await invoke('tuzi_provider_restore',{backupId:selected.backupId});await client.invalidateQueries({queryKey:['providers']});await backups.refetch();toast.success('已恢复保存前配置');setSelected(null);}catch(error){toast.error(String(error));}finally{setBusy(false);}}}/></>;
}
