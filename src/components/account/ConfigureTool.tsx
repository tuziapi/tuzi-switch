import { trackInteraction } from "@/lib/analytics";
import { supportsTuziProtocol } from "@/lib/tuziEndpointCompatibility";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
} from "@/components/ui/command";
import { ChevronsUpDown, Check } from "lucide-react";
import { ProviderIcon } from "@/components/ProviderIcon";
import { isNativeTool } from "@/lib/api/nativeTools";

import { desktopRequest, type AccountState } from "@/lib/api/account";
import type {
  DesktopKey,
  DesktopPricing,
  DesktopError,
} from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import {
  TUZI_TOOL_TARGETS,
  type TuziProviderDraft,
  type TuziTool,
} from "@/lib/tuziToolCompatibility";
import { AccountDialog } from "./AccountDialog";
import { QueryState, WriteError } from "./BusinessShared";

const labels: Record<TuziTool, string> = {
  claude: "Claude",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  grokbuild: "Grok Build",
  pi: "Pi",
  mcode: "MiniMax Code",
};
const icons: Record<TuziTool, string> = {
  claude: "claude",
  "claude-desktop": "claude",
  codex: "openai",
  gemini: "gemini",
  opencode: "opencode",
  openclaw: "openclaw",
  hermes: "hermes",
  grokbuild: "xai",
  pi: "pi",
  mcode: "minimax",
};
interface Source {
  site: string;
  userId: string;
  tokenId: string;
  app: TuziTool;
  providerId: string;
}
function ConfigureToolSession({
  state,
  keyDto,
  model: initial,
  onClose,
  onReady,
  onExisting,
}: {
  state: AccountState;
  keyDto: DesktopKey;
  model?: DesktopPricing;
  onClose: () => void;
  onReady: (draft: TuziProviderDraft<TuziTool>) => void;
  onExisting?: (app: TuziTool, providerId: string) => void;
}) {
  const [app, setApp] = useState<TuziTool | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [model, setModel] = useState<
    | Pick<
        DesktopPricing,
        "model_name" | "supported_endpoint_types" | "endpoints"
      >
    | undefined
  >(initial);
  const [protocol, setProtocol] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DesktopError | null>(null);
  const sources = useQuery({
    queryKey: ["tuziProviderSources", state.identity?.userId, state.generation],
    queryFn: () => invoke<Source[]>("tuzi_provider_sources", { app: null }),
    retry: false,
    staleTime: 0,
  });
  const nativeSources = useQuery({
    queryKey: [
      "tuziProviderSources",
      "native",
      state.identity?.userId,
      state.generation,
    ],
    queryFn: () =>
      invoke<{ sources: Source[]; unavailable: string[] }>(
        "tuzi_native_tool_sources",
      ),
    retry: false,
    staleTime: 0,
  });
  const models = useDesktop<{
    items: Pick<
      DesktopPricing,
      "model_name" | "supported_endpoint_types" | "endpoints"
    >[];
  }>(
    app ? state : { ...state, identity: null },
    `/account/keys/${keyDto.id}/models`,
    {},
    0,
  );
  const alive = useRef(true),
    lock = useRef(false),
    abort = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    abort.current = new AbortController();
    return () => {
      alive.current = false;
      abort.current.abort();
    };
  }, []);
  const existing = [
    ...(sources.data ?? []),
    ...(nativeSources.data?.sources ?? []),
  ].filter(
    (s) =>
      s.site === "https://api.tu-zi.com" &&
      s.userId === state.identity?.userId &&
      s.tokenId === keyDto.id,
  );
  const targets = TUZI_TOOL_TARGETS.filter((t) => t.appId === app);
  const compatible = (
    m: Pick<DesktopPricing, "supported_endpoint_types" | "endpoints">,
  ) =>
    app === "codex"
      ? targets
      : targets.filter((target) => supportsTuziProtocol(m, target.protocol));
  const items = models.data?.data.items ?? [];
  const matching = items.filter((m) =>
    m.model_name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const choices = matching.filter((m) => compatible(m).length > 0);
  const selected = targets.find((t) => t.protocol === protocol);
  const currentModel = items.find((m) => m.model_name === model?.model_name);
  const reason =
    selected &&
    currentModel &&
    compatible(currentModel).some((t) => t.protocol === selected.protocol)
      ? null
      : "请选择可用模型";
  const selectedSourceUnavailable =
    !!app &&
    isNativeTool(app) &&
    (nativeSources.isLoading ||
      !!nativeSources.error ||
      !!nativeSources.data?.unavailable?.includes(app));
  const proceed = async () => {
    if (
      !selected ||
      !model ||
      reason ||
      models.error ||
      models.isFetching ||
      selectedSourceUnavailable ||
      lock.current
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await desktopRequest<{ key: string }>(
        {
          method: "POST",
          path: `/account/keys/${keyDto.id}/reveal`,
          generation: state.generation,
        },
        abort.current.signal,
      );
      if (alive.current)
        onReady({
          appId: selected.appId,
          protocol: selected.protocol,
          key: r.data.key,
          tokenId: keyDto.id,
          userId: state.identity!.userId,
          generation: state.generation,
          model: model.model_name,
          name: keyDto.name,
        });
    } catch (e) {
      if (alive.current) setError(e as DesktopError);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const unavailable =
    keyDto.status !== 1
      ? "此密钥未启用"
      : keyDto.expired_time !== -1 && keyDto.expired_time <= Date.now() / 1000
        ? "此密钥已过期"
        : !keyDto.unlimited_quota && BigInt(keyDto.remain_quota) <= 0n
          ? "此密钥额度不足"
          : null;
  return (
    <AccountDialog
      title="配置到工具"
      description={`使用「${keyDto.name}」创建工具配置，已有配置不会被覆盖。`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {app && (
            <Button
              disabled={
                busy ||
                !!reason ||
                !!models.error ||
                models.isFetching ||
                !!unavailable ||
                sources.isLoading ||
                !!sources.error ||
                selectedSourceUnavailable
              }
              onClick={() => void proceed()}
            >
              {busy ? "准备中…" : "下一步"}
            </Button>
          )}
        </>
      }
    >
      {sources.isLoading && <p role="status">正在检查已有配置…</p>}
      {sources.error && (
        <p role="alert">
          无法读取已有配置，请重试。
          <Button variant="link" onClick={() => void sources.refetch()}>
            重试
          </Button>
        </p>
      )}
      {unavailable && (
        <p className="account-form-hint">
          {unavailable}，可查看已有配置；恢复密钥后再新增配置。
        </p>
      )}
      <div className="account-tool-grid">
        {(Object.keys(labels) as TuziTool[])
          .filter(
            (id) =>
              id !== "claude-desktop" || !/linux/i.test(navigator.platform),
          )
          .map((id) => {
            const saved = existing.filter((s) => s.app === id);
            const nativeUnavailable =
              isNativeTool(id) &&
              (!!nativeSources.error ||
                nativeSources.data?.unavailable?.includes(id));
            return (
              <Button
                key={id}
                variant={app === id ? "secondary" : "outline"}
                aria-pressed={app === id}
                disabled={
                  busy ||
                  sources.isLoading ||
                  !!sources.error ||
                  (isNativeTool(id) && nativeSources.isLoading) ||
                  nativeUnavailable ||
                  (!saved.length && !!unavailable)
                }
                onClick={() => {
                  if (saved.length && onExisting) {
                    onExisting(id, saved[0].providerId);
                    return;
                  }
                  if (app !== id)
                    trackInteraction("configure_tool", "select_tool", {
                      tool: id,
                    });
                  setApp(id);
                  setModel(undefined);
                  setProtocol("");
                  setSearch("");
                  setError(null);
                }}
              >
                <span>
                  {labels[id]}
                  <small>
                    {nativeUnavailable
                      ? "配置读取失败 · 请在工具页检查"
                      : saved.length
                        ? "已配置 · 查看配置"
                        : "选择并配置"}
                  </small>
                </span>
                <span className="account-tool-icon" aria-hidden="true">
                  <ProviderIcon icon={icons[id]} name={labels[id]} size={26} />
                </span>
              </Button>
            );
          })}
      </div>
      {app && (
        <div className="account-tool-options">
          <div className="space-y-2">
            <span className="text-sm font-medium">选择模型</span>
            <Popover modal open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-label="模型"
                  aria-expanded={pickerOpen}
                  className="w-full justify-between"
                >
                  <span className="truncate">
                    {model?.model_name || "搜索并选择模型"}
                  </span>
                  <ChevronsUpDown size={16} className="shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="account-model-picker z-[80] w-[var(--radix-popover-trigger-width)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-0"
                onEscapeKeyDown={(event) => event.stopPropagation()}
              >
                <Command shouldFilter={false}>
                  <CommandInput
                    aria-label="搜索模型"
                    placeholder="输入模型名称搜索…"
                    value={search}
                    onValueChange={setSearch}
                  />
                  <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-44px))] overscroll-contain">
                    {models.isFetching ? (
                      <p className="p-3 text-sm" role="status">
                        正在加载模型…
                      </p>
                    ) : (
                      choices.map((m) => (
                        <CommandItem
                          key={m.model_name}
                          value={m.model_name}
                          onSelect={() => {
                            setModel(m);
                            setProtocol(compatible(m)[0]?.protocol ?? "");
                            setPickerOpen(false);
                          }}
                        >
                          <Check
                            size={16}
                            className={
                              model?.model_name === m.model_name
                                ? "opacity-100"
                                : "opacity-0"
                            }
                          />
                          {m.model_name}
                        </CommandItem>
                      ))
                    )}
                    {!models.isFetching && !models.error && !choices.length && (
                      <p className="p-3 text-sm">
                        {search
                          ? "没有匹配的可用模型。"
                          : "暂无可用于此工具的模型。"}
                      </p>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <QueryState query={models} showUpdated={false} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {models.data && !models.error
                ? `已获取 ${items.length} 个模型`
                : null}
            </span>
            <Button
              variant="link"
              disabled={models.isFetching || busy}
              onClick={() => void models.refetch()}
            >
              刷新模型
            </Button>
          </div>
          {model && compatible(model).length > 1 && (
            <label>
              接口格式
              <select
                className="account-tool-select"
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
              >
                {compatible(model).map((t) => (
                  <option key={t.protocol} value={t.protocol}>
                    {
                      {
                        responses: "OpenAI Responses",
                        anthropic: "Anthropic Messages",
                        chat: "OpenAI Chat",
                        gemini: "Gemini",
                      }[t.protocol]
                    }
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="account-form-hint">
            下一步可检查配置后保存。保存不会发起模型测试。
          </p>
          <WriteError error={error} />
        </div>
      )}
    </AccountDialog>
  );
}

// Remount per account/Key so late reads or reveal results cannot cross selections.
export function ConfigureTool(
  props: ComponentProps<typeof ConfigureToolSession>,
) {
  return (
    <ConfigureToolSession
      key={`${props.state.generation}:${props.state.identity?.userId}:${props.keyDto.id}`}
      {...props}
    />
  );
}
