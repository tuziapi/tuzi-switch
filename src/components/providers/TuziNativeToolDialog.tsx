import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AccountDialog } from "@/components/account/AccountDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  nativeToolsApi,
  nativeToolNames,
  type NativeTool,
  type NativeToolSnapshot,
} from "@/lib/api/nativeTools";
import {
  TUZI_TOOL_TARGETS,
  type TuziProviderDraft,
} from "@/lib/tuziToolCompatibility";

export function TuziNativeToolDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: TuziProviderDraft<NativeTool>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [id] = useState(() => `tuzi-${crypto.randomUUID()}`);
  const [name, setName] = useState(() =>
    draft.name?.trim() ? `兔子线路-${draft.name.trim()}` : "兔子线路",
  );
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false),
    alive = useRef(true);
  const client = useQueryClient();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const file = useQuery({
    queryKey: ["tuziNativePreview", draft.appId, id],
    queryFn: () => nativeToolsApi.read(draft.appId),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const endpoint = TUZI_TOOL_TARGETS.find(
    (t) => t.appId === draft.appId && t.protocol === draft.protocol,
  )?.endpoint;
  const invalid =
    !name.trim() ||
    name.length > 200 ||
    !draft.model ||
    !endpoint ||
    (context !== "" &&
      (!/^\d+$/.test(context) ||
        !Number.isSafeInteger(Number(context)) ||
        Number(context) <= 0));
  const close = () => {
    if (!saving.current) onClose();
  };
  const save = async () => {
    if (
      saving.current ||
      !file.data ||
      file.isFetching ||
      file.error ||
      invalid
    )
      return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const snapshot = await invoke<NativeToolSnapshot>(
        "tuzi_native_tool_save",
        {
          tool: draft.appId,
          revision: file.data.revision,
          selection: {
            id,
            name: name.trim(),
            model: draft.model,
            protocol: draft.protocol,
            key: draft.key,
            contextWindow:
              draft.appId === "grokbuild" && context ? Number(context) : null,
          },
          source: {
            site: "https://api.tu-zi.com",
            userId: draft.userId,
            tokenId: draft.tokenId,
            generation: draft.generation,
          },
        },
      );
      client.setQueryData(["nativeTool", draft.appId], snapshot);
      await client.invalidateQueries({ queryKey: ["tuziProviderSources"] });
      if (alive.current) {
        toast.success(
          draft.appId === "grokbuild"
            ? "已保存，可在工具页启用"
            : "已保存，请在原工具中选择模型",
        );
        onSaved(id);
      }
    } catch (failure) {
      if (alive.current)
        setError(String(failure).split(draft.key).join("[已脱敏]"));
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <AccountDialog
      title={`配置 ${nativeToolNames[draft.appId]}`}
      description="检查后保存为独立配置，已有供应商与登录状态保留。"
      onClose={close}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            disabled={
              busy || invalid || !file.data || !!file.error || file.isFetching
            }
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "添加"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-2 text-sm">
          配置名称
          <Input
            value={name}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <dl className="rounded-2xl border bg-muted/30 p-4 text-sm space-y-2">
          <div>
            <dt className="text-muted-foreground">模型</dt>
            <dd className="break-all">{draft.model}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">接口格式</dt>
            <dd>
              {
                {
                  responses: "OpenAI Responses",
                  chat: "OpenAI Chat",
                  anthropic: "Anthropic Messages",
                  gemini: "Gemini",
                }[draft.protocol]
              }
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">服务地址</dt>
            <dd>{endpoint}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">模型 Key</dt>
            <dd>已从当前账户密钥读取</dd>
          </div>
          {file.data && (
            <div>
              <dt className="text-muted-foreground">配置文件</dt>
              <dd className="break-all">{file.data.path}</dd>
            </div>
          )}
        </dl>
        {draft.appId === "grokbuild" && (
          <label className="block space-y-2 text-sm">
            上下文长度（可选）
            <Input
              inputMode="numeric"
              placeholder="留空使用工具默认值"
              value={context}
              disabled={busy}
              onChange={(e) => setContext(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              填写模型实际支持的 Token 数量。
            </span>
          </label>
        )}
        <p className="account-form-hint">
          {draft.appId === "grokbuild"
            ? "保存后可在 Grok Build 页面启用此档案。"
            : "保存后请在原工具中选择此供应商和模型。"}{" "}
          保存会备份原文件，不发起模型测试。
        </p>
        {file.isLoading && <p role="status">正在检查本机配置…</p>}
        {(file.error || error) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? "无法读取工具配置，请重试。"}
          </p>
        )}
        {(file.error || error) && (
          <Button
            variant="outline"
            disabled={busy || file.isFetching}
            onClick={async () => {
              await file.refetch();
            }}
          >
            重新读取配置
          </Button>
        )}
      </div>
    </AccountDialog>
  );
}
