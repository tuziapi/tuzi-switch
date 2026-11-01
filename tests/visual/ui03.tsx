// Synthetic UI only: every IPC is intercepted; mutations and external actions rejected.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ThemeProvider } from "@/components/theme-provider";
import { TuziSidebar } from "@/components/shell/TuziSidebar";
import Mcp, {
  type UnifiedMcpPanelHandle,
} from "@/components/mcp/UnifiedMcpPanel";
import Skills from "@/components/skills/UnifiedSkillsPanel";
import { SkillsPage as Discovery } from "@/components/skills/SkillsPage";
import Prompts, {
  type PromptPanelHandle,
} from "@/components/prompts/PromptPanel";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import Env from "@/components/openclaw/EnvPanel";
import Tools from "@/components/openclaw/ToolsPanel";
import Defaults from "@/components/openclaw/AgentsDefaultsPanel";
import Memory from "@/components/hermes/HermesMemoryPanel";
import Workspace from "@/components/workspace/WorkspaceFilesPanel";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";
import "@/index.css";
import "@/components/shell/workspace-pages.css";
void i18n.changeLanguage("zh");
const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "normal";
const dark = params.get("theme") === "dark";
const apps = {
  claude: true,
  "claude-desktop": true,
  codex: true,
  gemini: true,
  opencode: true,
  openclaw: true,
  hermes: true,
};
const enabledApps = { ...apps, codex: false, opencode: false };
const longName = "合成开发工作区 — 长名称与多工具配置兼容验证";
mockWindows("main");
mockIPC(
  async (command) => {
    if (command === "set_window_theme") return;
    if (
      scenario === "loading" &&
      [
        "get_mcp_servers",
        "get_installed_skills",
        "list_sessions",
        "get_prompts",
      ].includes(command)
    )
      return new Promise(() => {});
    if (
      scenario === "error" &&
      ["get_mcp_servers", "get_installed_skills", "list_sessions"].includes(
        command,
      )
    )
      throw new Error("SYNTHETIC_READ_FAILURE");
    const empty = scenario === "empty";
    if (command === "get_settings")
      return { visibleApps: apps, commonConfigConfirmed: true };
    if (command === "get_mcp_servers")
      return empty
        ? {}
        : Object.fromEntries(
            [1, 2, 3].map((n) => [
              "synthetic-" + n,
              {
                id: "synthetic-" + n,
                name: longName + " " + n,
                description: "仅本地合成数据，未连接真实服务。",
                server: {
                  type: "stdio",
                  command: "synthetic-command",
                  args: [],
                },
                apps: enabledApps,
              },
            ]),
          );
    if (command === "get_installed_skills")
      return empty
        ? []
        : [1, 2, 3].map((n) => ({
            id: "synthetic-" + n,
            name: longName + " " + n,
            directory: "synthetic-" + n,
            description: "仅用于排版检查，不安装或启用任何真实工具。",
            apps: enabledApps,
            installedAt: 1,
            updatedAt: 1,
          }));
    if (
      [
        "scan_unmanaged_skills",
        "check_skill_updates",
        "get_skill_repos",
        "get_providers",
        "get_openclaw_live_provider_ids",
      ].includes(command)
    )
      return command === "get_providers" ? {} : [];
    if (command === "discover_available_skills")
      return empty
        ? []
        : [
            {
              key: "synthetic",
              name: longName,
              description: "合成发现结果",
              directory: "synthetic",
              repoOwner: "synthetic",
              repoName: "local-only",
              repoBranch: "main",
            },
          ];
    if (command === "get_prompts")
      return empty
        ? {}
        : {
            synthetic: {
              id: "synthetic",
              name: longName.repeat(3),
              description: "包含长标题的合成提示词。",
              content: "# 合成内容\n只用于本机视觉验证。",
              enabled: false,
            },
          };
    if (command === "get_current_prompt_file_content") return null;
    if (command === "list_sessions")
      return empty
        ? []
        : [1, 2, 3].map((n) => ({
            providerId: "claude",
            sessionId: "synthetic-" + n,
            title: longName + " " + n,
            sourcePath: "/synthetic/session-" + n,
            createdAt: 1793000000,
            lastActiveAt: 1793000060,
          }));
    if (command === "get_session_messages")
      return [
        { role: "user", content: "请检查窄窗口的阅读区和列表。" },
        {
          role: "assistant",
          content: "合成答复：页面应保留搜索、筛选和删除确认。",
        },
      ];
    if (command === "get_openclaw_env")
      return { vars: { SYNTHETIC_LABEL: "preview-only" } };
    if (command === "get_openclaw_tools")
      return { profile: "coding", allow: ["synthetic-tool"], deny: [] };
    if (command === "get_openclaw_agents_defaults") return {};
    if (command === "get_openclaw_default_model") return null;
    if (command === "read_workspace_file")
      return "# 合成工作区\n不读取用户文件。";
    if (command === "get_hermes_memory")
      return "# 合成记忆\n用于预览，不读写真实记忆。";
    if (command === "get_hermes_memory_limits")
      return {
        memory: 2200,
        user: 1375,
        memoryEnabled: true,
        userEnabled: true,
      };
    throw new Error("Synthetic preview rejects IPC: " + command);
  },
  { shouldMockEvents: true },
);
function Canvas() {
  const [page, setPage] = useState(params.get("page") ?? "mcp");
  const [collapsed, setCollapsed] = useState(
    params.get("collapsed") === "true",
  );
  const mcp = useRef<UnifiedMcpPanelHandle>(null);
  const prompt = useRef<PromptPanelHandle>(null);
  const left = collapsed ? 68 : 228;
  return (
    <div
      className="tuzi-shell flex flex-col h-screen bg-background text-foreground"
      style={{ paddingTop: 52 }}
    >
      <TuziSidebar
        activeApp={page === "hermesMemory" ? "hermes" : "openclaw"}
        currentView={page}
        visibleApps={apps}
        topOffset={0}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onSwitchApp={() => {}}
        onNavigate={setPage}
        onOpenSettings={() => {}}
      />
      <header
        className="workspace-header fixed top-0 h-[52px] z-30 border-b border-border flex items-center justify-between px-4 bg-background"
        style={{ left, width: `calc(100% - ${left}px)` }}
      >
        <span>{page} · 合成预览</span>
        <div className="workspace-header-actions flex gap-2">
          {page === "mcp" && (
            <Button onClick={() => mcp.current?.openAdd()}>添加 MCP</Button>
          )}
          {page === "prompts" && (
            <Button onClick={() => prompt.current?.openAdd()}>
              添加提示词
            </Button>
          )}
        </div>
      </header>
      <main
        className="flex flex-1 min-h-0 flex-col"
        style={{ marginLeft: left }}
      >
        <div
          className="workspace-view flex flex-col flex-1 min-h-0 min-w-0"
          data-view={page}
        >
          {page === "mcp" ? (
            <Mcp ref={mcp} onOpenChange={() => {}} />
          ) : page === "skills" ? (
            <Skills
              currentApp="claude"
              onOpenDiscovery={() => setPage("skillsDiscovery")}
            />
          ) : page === "skillsDiscovery" ? (
            <Discovery initialApp="claude" />
          ) : page === "prompts" ? (
            <Prompts ref={prompt} appId="claude" open onOpenChange={() => {}} />
          ) : page === "sessions" ? (
            <SessionManagerPage appId="claude" />
          ) : page === "openclawEnv" ? (
            <Env />
          ) : page === "openclawTools" ? (
            <Tools />
          ) : page === "openclawAgents" ? (
            <Defaults />
          ) : page === "hermesMemory" ? (
            <Memory />
          ) : page === "workspace" ? (
            <Workspace />
          ) : (
            <p>请选择验证页面</p>
          )}
        </div>
      </main>
    </div>
  );
}
function Preview() {
  const [page, setPage] = useState(params.get("page") ?? "mcp");
  const [width, setWidth] = useState(900);
  const [theme, setTheme] = useState("light");
  const [mode, setMode] = useState("normal");
  return (
    <div>
      <div
        style={{ padding: 8, display: "flex", gap: 12, alignItems: "center" }}
      >
        <strong>合成预览 · 拒绝真实读写</strong>
        <select
          aria-label="页面"
          value={page}
          onChange={(e) => setPage(e.target.value)}
        >
          {[
            "mcp",
            "skills",
            "skillsDiscovery",
            "prompts",
            "sessions",
            "workspace",
            "openclawEnv",
            "openclawTools",
            "openclawAgents",
            "hermesMemory",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="宽度"
          value={width}
          onChange={(e) => setWidth(+e.target.value)}
        >
          {[900, 1280].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="主题"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          {["light", "dark"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="场景"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          {["normal", "empty", "loading", "error"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <iframe
        title="隔离应用画布"
        style={{
          width,
          height: 760,
          border: "1px solid #888",
          display: "block",
        }}
        src={`ui03.html?canvas=1&page=${page}&theme=${theme}&scenario=${mode}`}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("canvas") ? (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ThemeProvider
        defaultTheme={dark ? "dark" : "light"}
        storageKey={`ui03-preview-${dark}`}
      >
        <Canvas />
      </ThemeProvider>
    </QueryClientProvider>
  ) : (
    <Preview />
  ),
);
