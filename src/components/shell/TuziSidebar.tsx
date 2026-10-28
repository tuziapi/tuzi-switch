import { useMemo } from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Brain,
  Cpu,
  FolderOpen,
  History,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  Network,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { VisibleApps } from "@/types";
import type { AppId } from "@/lib/api";
import { ProviderIcon } from "@/components/ProviderIcon";
import { TuziAccountIcon } from "@/components/icons/TuziAccountIcon";
import { cn } from "@/lib/utils";

export type TuziView =
  | "account"
  | "providers"
  | "settings"
  | "prompts"
  | "skills"
  | "mcp"
  | "agents"
  | "universal"
  | "sessions"
  | "workspace"
  | "openclawEnv"
  | "openclawTools"
  | "openclawAgents"
  | "hermesMemory"
  | "grokbuild"
  | "pi"
  | "mcode"
  | "auth"
  | "usage";

interface TuziSidebarProps {
  activeApp: AppId;
  currentView: TuziView | string;
  visibleApps: VisibleApps;
  topOffset: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSwitchApp: (app: AppId) => void;
  onNavigate: (view: TuziView) => void;
  onOpenSettings: () => void;
}

const APP_ORDER: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
];

const APP_NAMES: Record<AppId, string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
};

export function TuziSidebar({
  activeApp,
  currentView,
  visibleApps,
  topOffset,
  collapsed,
  onToggleCollapsed,
  onSwitchApp,
  onNavigate,
  onOpenSettings,
}: TuziSidebarProps) {
  const { t } = useTranslation();
  const apps = useMemo(
    () => APP_ORDER.filter((app) => visibleApps[app]),
    [visibleApps],
  );
  const isNativePage = ["grokbuild", "pi", "mcode"].includes(currentView);
  const isAppPage = currentView === "providers";

  const itemClass = (selected: boolean) =>
    cn(
      "group flex h-9 w-full items-center rounded-lg text-[13px] transition-colors",
      collapsed ? "justify-center px-2" : "gap-3 px-3",
      selected
        ? "bg-foreground/[0.08] font-medium text-foreground"
        : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
    );

  const navigateApp = (app: AppId) => {
    onSwitchApp(app);
    onNavigate("providers");
  };

  return (
    <aside
      className={cn(
        "fixed left-0 z-30 flex flex-col border-r border-border bg-muted/45 pt-3 transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-[228px]",
      )}
      style={{ top: topOffset, bottom: 0 }}
      aria-label="应用导航"
    >
      <div
        className={cn(
          "flex items-center px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-2.5 px-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">兔子助手</div>
              <div className="truncate text-[10px] text-muted-foreground">
                Assistant workspace
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={onToggleCollapsed}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onNavigate("account")}
            className={itemClass(currentView === "account")}
            title={t("navigation.account")}
            aria-label={t("navigation.account")}
            aria-current={currentView === "account" ? "page" : undefined}
          >
            <TuziAccountIcon size={18} aria-hidden="true" />
            {!collapsed && (
              <span className="truncate">{t("navigation.account")}</span>
            )}
          </button>
          {!collapsed && (
            <div className="px-3 pb-1 pt-4 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              {t("navigation.tools")}
            </div>
          )}
          {apps.map((app) => (
            <button
              key={app}
              type="button"
              onClick={() => navigateApp(app)}
              className={itemClass(isAppPage && activeApp === app)}
              title={APP_NAMES[app]}
              aria-label={APP_NAMES[app]}
              aria-current={isAppPage && activeApp === app ? "page" : undefined}
            >
              <ProviderIcon
                icon={
                  app === "codex"
                    ? "openai"
                    : app === "claude-desktop"
                      ? "claude"
                      : app
                }
                name={APP_NAMES[app]}
                size={18}
              />
              {!collapsed && <span className="truncate">{APP_NAMES[app]}</span>}
            </button>
          ))}
          {(["grokbuild", "pi", "mcode"] as const).map((tool) => {
            const name = {
              grokbuild: "Grok Build",
              pi: "Pi",
              mcode: "MiniMax Code",
            }[tool];
            return (
              <button
                key={tool}
                type="button"
                aria-label={name}
                title={name}
                aria-current={currentView === tool ? "page" : undefined}
                className={itemClass(currentView === tool)}
                onClick={() => onNavigate(tool)}
              >
                <ProviderIcon
                  icon={
                    tool === "mcode"
                      ? "minimax"
                      : tool === "grokbuild"
                        ? "grok"
                        : undefined
                  }
                  name={name}
                  size={18}
                />
                {!collapsed && <span>{name}</span>}
              </button>
            );
          })}
        </div>

        <nav
          className="mt-5 space-y-1 shrink-0"
          aria-label={t("navigation.workspace")}
        >
          {!collapsed && (
            <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              {t("navigation.workspace")}
            </div>
          )}
          {[
            { view: "mcp", label: t("mcp.title"), icon: Network },
            { view: "skills", label: t("skills.title"), icon: Wrench },
            {
              view: "prompts",
              label: t("navigation.prompts"),
              icon: MessageSquareText,
            },
            {
              view: "sessions",
              label: t("sessionManager.title"),
              icon: History,
            },
            { view: "auth", label: t("navigation.auth"), icon: KeyRound },
            {
              view: "usage",
              label: t("navigation.localUsage"),
              icon: BarChart3,
            },
            { view: "agents", label: t("agents.title"), icon: Cpu },
            {
              view: "universal",
              label: t("universalProvider.title", {
                defaultValue: "统一供应商",
              }),
              icon: LayoutDashboard,
            },
          ].map(({ view, label, icon: Icon }) => {
            const selected =
              currentView === view ||
              (view === "skills" && currentView === "skillsDiscovery");
            return (
              <button
                key={view}
                type="button"
                onClick={() => onNavigate(view as TuziView)}
                className={itemClass(selected)}
                title={label}
                aria-label={label}
                aria-current={selected ? "page" : undefined}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate">{label}</span>
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {!isNativePage && activeApp === "openclaw" && (
          <div className="mt-5 space-y-1">
            {!collapsed && (
              <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                OpenClaw
              </div>
            )}
            <button
              type="button"
              onClick={() => onNavigate("workspace")}
              aria-label={t("workspace.title")}
              aria-current={currentView === "workspace" ? "page" : undefined}
              className={itemClass(currentView === "workspace")}
              title={t("workspace.title")}
            >
              <FolderOpen className="h-[18px] w-[18px]" />
              {!collapsed && <span>{t("workspace.title")}</span>}
            </button>
            <button
              type="button"
              onClick={() => onNavigate("openclawEnv")}
              aria-label={t("openclaw.env.title")}
              aria-current={currentView === "openclawEnv" ? "page" : undefined}
              className={itemClass(currentView === "openclawEnv")}
              title={t("openclaw.env.title")}
            >
              <KeyRound className="h-[18px] w-[18px]" />
              {!collapsed && <span>{t("openclaw.env.title")}</span>}
            </button>
            <button
              type="button"
              onClick={() => onNavigate("openclawTools")}
              aria-label={t("openclaw.tools.title")}
              aria-current={
                currentView === "openclawTools" ? "page" : undefined
              }
              className={itemClass(currentView === "openclawTools")}
              title={t("openclaw.tools.title")}
            >
              <Shield className="h-[18px] w-[18px]" />
              {!collapsed && <span>{t("openclaw.tools.title")}</span>}
            </button>
            <button
              type="button"
              onClick={() => onNavigate("openclawAgents")}
              aria-label={t("openclaw.agents.title")}
              aria-current={
                currentView === "openclawAgents" ? "page" : undefined
              }
              className={itemClass(currentView === "openclawAgents")}
              title={t("openclaw.agents.title")}
            >
              <Cpu className="h-[18px] w-[18px]" />
              {!collapsed && <span>{t("openclaw.agents.title")}</span>}
            </button>
          </div>
        )}
        {!isNativePage && activeApp === "hermes" && (
          <div className="mt-5 space-y-1">
            {!collapsed && (
              <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                Hermes
              </div>
            )}
            <button
              type="button"
              onClick={() => onNavigate("hermesMemory")}
              aria-label={t("hermes.memory.title")}
              aria-current={currentView === "hermesMemory" ? "page" : undefined}
              className={itemClass(currentView === "hermesMemory")}
              title={t("hermes.memory.title")}
            >
              <Brain className="h-[18px] w-[18px]" />
              {!collapsed && <span>{t("hermes.memory.title")}</span>}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-border p-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className={itemClass(currentView === "settings")}
          title={t("common.settings")}
          aria-label={t("common.settings")}
          aria-current={currentView === "settings" ? "page" : undefined}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
          {!collapsed && <span>{t("common.settings")}</span>}
        </button>
      </div>
    </aside>
  );
}
