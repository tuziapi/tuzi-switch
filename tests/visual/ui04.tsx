import { nativePreviewIPC } from "./native-tool-fixture";
// Synthetic provider workspace. No real IPC, filesystem or external requests.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Toaster, toast } from "sonner";
import { Plus } from "lucide-react";
import { ThemeProvider } from "@/components/theme-provider";
import { TuziSidebar } from "@/components/shell/TuziSidebar";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { ProviderConnectionControls } from "@/components/providers/ProviderConnectionControls";
import { NativeToolPage } from "@/components/providers/NativeToolPage";
import Mcp from "@/components/mcp/UnifiedMcpPanel";
import Skills from "@/components/skills/UnifiedSkillsPanel";
import { SkillsPage } from "@/components/skills/SkillsPage";
import Prompts from "@/components/prompts/PromptPanel";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { AccountWorkspacePreview } from "./AccountWorkspacePreview";
import { accountPreviewIPC } from "./account-fixture";
import {
  agentTemplate,
  type AgentTool,
  type AgentSnapshot,
  type AgentChange,
} from "@/lib/api/agents";
import { UniversalProviderPanel } from "@/components/universal/UniversalProviderPanel";
import { WorkspaceScope } from "@/components/shell/WorkspaceScope";
import {
  WorkspaceAuthPage,
  WorkspaceUsagePage,
} from "@/components/shell/WorkspaceGlobalPages";
import {
  WORKSPACE_SUPPORT,
  WORKSPACE_TOOL_NAMES,
  type WorkspaceTool,
} from "@/config/workspace";
import type { AppId } from "@/lib/api";
import { nativeToolNames, type NativeTool } from "@/lib/api/nativeTools";
import type { AggregationState, AggregationPlan } from "@/lib/api/aggregation";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import type { Provider } from "@/types";
import i18n from "@/i18n";
import "@/index.css";
import "@/components/shell/workspace-pages.css";
void i18n.changeLanguage("zh");
const params = new URLSearchParams(location.search);
const mcpFixture = {
  fixture: {
    id: "fixture",
    name: "合成 MCP 服务",
    server: { type: "stdio", command: "fixture" },
    apps: { claude: true, codex: false, gemini: false, opencode: false, hermes: false, grokbuild: true, pi: true, mcode: true },
    tags: [],
  },
};
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const providers: Provider[] = [
  "coding",
  "codex coding",
  "图片测试",
  "tuzi codex",
].map((name, index) => ({
  id: `synthetic-${index}`,
  name,
  icon: index === 2 ? "image" : undefined,
  settingsConfig: {
    auth: { OPENAI_API_KEY: "sk-SYNTHETIC_PREVIEW_ONLY" },
    config: `model_provider = "synthetic"\n[model_providers.synthetic]\nbase_url = "https://synthetic.example/${index === 2 ? "coding" : "v1"}"\nwire_api = "responses"`,
  },
}));
let currentId = "synthetic-2";
let routed =
  params.get("scenario") === "route" || params.get("scenario") === "stopped";
let running = params.get("scenario") !== "stopped" && routed;
let aggregation: AggregationState = {
  enabled: false,
  needsRecovery: false,
  plan: { defaultProviderId: currentId, models: [] },
};
const agentSnapshots = Object.fromEntries(
  (["claude", "opencode"] as AgentTool[]).map((tool) => [
    tool,
    {
      revision: "synthetic-agent-1",
      path: `/synthetic/${tool}/agents`,
      canRestore: false,
      files: [
        {
          id: "synthetic-review.md",
          content: agentTemplate(tool),
          validationError: null,
        },
      ],
    },
  ]),
) as Record<AgentTool, AgentSnapshot>;
const agentBackups: Partial<Record<AgentTool, AgentSnapshot>> = {};
mockWindows("main");
mockIPC(
  async (command, args) => {
    if (command === "set_window_theme") return;
    if (
      [
        "account_request",
        "account_cancel_request",
        "tuzi_provider_sources",
        "tuzi_native_tool_sources",
        "tuzi_provider_backups",
      ].includes(command)
    )
      return accountPreviewIPC(command, args);
    if (command === "account_cancel_token_prefill") return;
    if (command.startsWith("agents_")) {
      const payload = args as {
        tool: AgentTool;
        revision?: string;
        change?: AgentChange;
      };
      const current = agentSnapshots[payload.tool];
      if (!current) throw new Error("Unsupported synthetic Agent tool");
      if (command === "agents_read") return current;
      const expected = payload.change?.revision ?? payload.revision;
      if (expected !== current.revision)
        throw new Error("Synthetic Agent conflict");
      if (command === "agents_restore") {
        const backup = agentBackups[payload.tool];
        if (!backup) throw new Error("No synthetic Agent recovery record");
        agentSnapshots[payload.tool] = { ...backup, canRestore: false };
        delete agentBackups[payload.tool];
        return agentSnapshots[payload.tool];
      }
      if (command !== "agents_write" || !payload.change)
        throw new Error("Unknown synthetic Agent IPC");
      agentBackups[payload.tool] = structuredClone(current);
      const change = payload.change;
      const next = structuredClone(current);
      next.files = next.files.filter((file) => file.id !== change.id);
      if (change.content !== null)
        next.files.push({
          id: change.id,
          content: change.content,
          validationError: null,
        });
      next.revision = `synthetic-agent-${Date.now()}`;
      next.canRestore = true;
      agentSnapshots[payload.tool] = next;
      return next;
    }
    if (command === "get_settings") return { commonConfigConfirmed: true };
    if (command === "get_mcp_servers") return params.get("scenario") === "mcp" ? mcpFixture : {};
    if (command === "toggle_mcp_app" && params.get("scenario") === "mcp") {
      const { app, enabled } = args as { app: keyof typeof mcpFixture.fixture.apps; enabled: boolean };
      mcpFixture.fixture.apps[app] = enabled;
      return;
    }
    if (["get_prompts", "get_universal_providers"].includes(command))
      return {};
    if (
      [
        "get_installed_skills",
        "get_skill_backups",
        "scan_unmanaged_skills",
        "check_skill_updates",
        "get_skill_repos",
        "discover_available_skills",
        "list_sessions",
        "get_usage_summary_by_app",
        "get_usage_trends",
        "get_provider_stats",
        "get_model_stats",
        "get_model_pricing",
        "get_usage_data_sources",
      ].includes(command)
    )
      return [];
    if (command === "get_current_prompt_file_content") return null;
    if (command === "auth_get_status")
      return {
        provider: (args as { authProvider: string }).authProvider,
        authenticated: false,
        default_account_id: null,
        accounts: [],
      };
    if (command === "get_request_logs")
      return { data: [], total: 0, page: 0, pageSize: 20 };
    if (command === "get_usage_summary")
      return {
        totalRequests: 0,
        totalCost: "0",
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        successRate: 0,
        realTotalTokens: 0,
        cacheHitRate: 0,
      };
    if (command === "aggregation_read") return aggregation;
    if (command === "aggregation_apply") {
      const change = args as { enabled: boolean; plan: AggregationPlan };
      aggregation = {
        enabled: change.enabled,
        plan: change.plan,
        needsRecovery: false,
      };
      routed = true;
      running = true;
      return;
    }
    if (
      command.startsWith("native_tool_") ||
      command === "tuzi_native_tool_save"
    )
      return nativePreviewIPC(command, args);
    if (command === "get_proxy_status") {
      if (params.get("scenario") === "error")
        throw new Error("SYNTHETIC_FAILURE");
      return {
        running,
        address: "127.0.0.1",
        port: 15721,
        active_targets:
          running && routed
            ? [
                {
                  app_type: "codex",
                  provider_id: currentId,
                  provider_name: providers.find((p) => p.id === currentId)
                    ?.name,
                },
              ]
            : [],
      };
    }
    if (command === "get_proxy_takeover_status")
      return { codex: routed, claude: false, gemini: false };
    if (command === "set_proxy_takeover_for_app") {
      routed = !!(args as { enabled?: boolean } | undefined)?.enabled;
      running ||= routed;
      return;
    }
    if (command === "start_proxy_server") {
      running = true;
      return { address: "127.0.0.1", port: 15721 };
    }
    if (command === "get_provider_health") return null;
    throw new Error(`Synthetic preview rejects IPC: ${command}`);
  },
  { shouldMockEvents: true },
);

const notice = () =>
  toast.info("这是合成供应商主页预览，该入口的实际业务请在桌面版验收。");
function Canvas() {
  const proxy = useProxyStatus();
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState(currentId);
  const [page, setPage] = useState(params.get("page") ?? "providers");
  const [nativeFocus, setNativeFocus] = useState<
    { providerId: string } | undefined
  >();
  const [app, setApp] = useState<AppId>("codex");
  const [origin, setOrigin] = useState<WorkspaceTool>("codex");
  const [target, setTarget] = useState<AppId | null>("codex");
  const native = ["grokbuild", "pi", "mcode"].includes(page);
  const titles: Record<string, string> = {
    account: "兔子账户",
    providers: WORKSPACE_TOOL_NAMES[app],
    mcp: "MCP 管理",
    skills: "Skills 管理",
    skillsDiscovery: "Skills 发现",
    prompts: "提示词",
    sessions: "会话管理",
    auth: "授权管理",
    usage: "本机使用统计",
    agents: "智能体",
    universal: "统一供应商",
  };
  const scopedFeature = page === "skillsDiscovery" ? "skills" : page;
  const validTarget =
    target &&
    ["skills", "prompts"].includes(scopedFeature) &&
    WORKSPACE_SUPPORT[scopedFeature as "skills" | "prompts"].includes(target)
      ? target
      : null;
  const globalContent = () => {
    switch (page) {
      case "account":
        return (
          <AccountWorkspacePreview
            onNativeSaved={(tool, providerId) => {
              setNativeFocus({ providerId });
              setOrigin(tool);
              setTarget(null);
              setPage(tool);
            }}
          />
        );
      case "mcp":
        return (
          <>
            <WorkspaceScope feature="mcp" origin={origin} />
            <Mcp onOpenChange={() => {}} />
          </>
        );
      case "skills":
      case "skillsDiscovery":
      case "prompts":
        return (
          <>
            <WorkspaceScope
              feature={scopedFeature as "skills" | "prompts"}
              origin={origin}
              target={validTarget}
              onTargetChange={setTarget}
            />
            {validTarget ? (
              page === "prompts" ? (
                <Prompts
                  key={validTarget}
                  appId={validTarget}
                  open
                  onOpenChange={() => {}}
                />
              ) : page === "skills" ? (
                <Skills
                  key={validTarget}
                  currentApp={validTarget}
                  onOpenDiscovery={() => setPage("skillsDiscovery")}
                />
              ) : (
                <SkillsPage key={validTarget} initialApp={validTarget} />
              )
            ) : (
              <p className="px-6 text-sm text-muted-foreground">
                请选择目标工具后继续
              </p>
            )}
          </>
        );
      case "sessions":
        return (
          <>
            <WorkspaceScope feature="sessions" origin={origin} />
            <SessionManagerPage appId="all" />
          </>
        );
      case "auth":
        return <WorkspaceAuthPage />;
      case "usage":
        return <WorkspaceUsagePage />;
      case "agents":
        return (
          <AgentsPanel
            origin={origin}
            target={target}
            onTargetChange={setTarget}
          />
        );
      case "universal":
        return <UniversalProviderPanel />;
      default:
        return (
          <p className="px-6 text-muted-foreground">
            请在桌面版验收此工具的完整配置。
          </p>
        );
    }
  };
  const left = collapsed ? 68 : 228;
  return (
    <div
      className="tuzi-shell h-screen flex flex-col bg-background text-foreground"
      style={{ paddingTop: 52 }}
    >
      <Toaster />
      <TuziSidebar
        activeApp={app}
        currentView={page}
        visibleApps={{
          claude: true,
          "claude-desktop": true,
          codex: true,
          gemini: true,
          opencode: true,
          openclaw: true,
          hermes: true,
        }}
        topOffset={0}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onSwitchApp={(next) => {
          setApp(next);
          setOrigin(next);
          setTarget(WORKSPACE_SUPPORT.prompts.includes(next) ? next : null);
        }}
        onNavigate={(view) => {
          if (["grokbuild", "pi", "mcode"].includes(view)) {
            setOrigin(view as NativeTool);
            setTarget(null);
          }
          setPage(view);
        }}
        onOpenSettings={notice}
      />
      <header
        className="workspace-header fixed top-0 h-[52px] border-b border-border bg-background flex items-center justify-between px-6"
        style={{ left, width: `calc(100% - ${left}px)` }}
      >
        <div className="flex items-center gap-3">
          {page === "providers" && app === "codex" && (
            <ProviderIcon icon="openai" name="Codex" size={20} />
          )}
          <strong className="text-base">
            {native
              ? nativeToolNames[page as NativeTool]
              : (titles[page] ?? page)}
          </strong>
          <span className="text-xs text-muted-foreground">合成预览</span>
        </div>
        {page === "providers" && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="添加供应商"
            onClick={notice}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </header>
      <main
        className="workspace-view flex flex-1 flex-col min-h-0"
        data-view={page}
        style={{ marginLeft: left }}
      >
        {native ? (
          <NativeToolPage
            key={page}
            tool={page as NativeTool}
            focusRequest={nativeFocus}
          />
        ) : page !== "providers" || app !== "codex" ? (
          globalContent()
        ) : (
          <div className="flex flex-col min-h-0 flex-1 px-6">
            <ProviderConnectionControls
              appId="codex"
              currentProviderId={selected}
              providers={Object.fromEntries(providers.map((p) => [p.id, p]))}
              routeEnabled
              onOpenSettings={notice}
            />
            <div className="overflow-y-auto min-h-0 flex-1 pb-6 px-1">
              <div className="provider-list flex flex-col gap-2 mt-3">
                {providers.map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    appId="codex"
                    isCurrent={selected === provider.id}
                    isProxyRunning={proxy.isRunning}
                    isProxyTakeover={
                      proxy.isRunning && !!proxy.takeoverStatus?.codex
                    }
                    onSwitch={(next) => {
                      currentId = next.id;
                      setSelected(next.id);
                      void client.invalidateQueries({
                        queryKey: ["proxyStatus"],
                      });
                    }}
                    onEdit={notice}
                    onDelete={notice}
                    onDuplicate={notice}
                    onConfigureUsage={notice}
                    onOpenWebsite={notice}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
function Preview() {
  const [width, setWidth] = useState(1000);
  const [theme, setTheme] = useState("light");
  const [scenario, setScenario] = useState("direct");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <strong>兔子助手工作区 · 合成数据</strong>
        <select
          aria-label="宽度"
          value={width}
          onChange={(e) => setWidth(+e.target.value)}
        >
          {[900, 1000, 1280].map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <select
          aria-label="主题"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
        <select
          aria-label="连接场景"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        >
          <option value="direct">直连</option>
          <option value="route">路由</option>
          <option value="stopped">路由停止</option>
          <option value="error">状态读取失败</option>
        </select>
        <span>
          可检查完整全局导航、支持范围和目标工具选择；数据均为合成值。
        </span>
      </div>
      <iframe
        title="供应商主页画布"
        src={`ui04.html?canvas=1&theme=${theme}&scenario=${scenario}`}
        style={{
          width,
          height: 760,
          border: "1px solid #888",
          display: "block",
        }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("canvas") ? (
    <QueryClientProvider client={client}>
      <ThemeProvider
        defaultTheme={params.get("theme") === "dark" ? "dark" : "light"}
        storageKey={`ui04-${params.get("theme")}`}
      >
        <Canvas />
      </ThemeProvider>
    </QueryClientProvider>
  ) : (
    <Preview />
  ),
);
