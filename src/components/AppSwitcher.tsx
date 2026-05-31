import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { Monitor, Terminal } from "lucide-react";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";

interface AppSwitcherProps {
  activeApp: AppId;
  onSwitch: (app: AppId) => void;
  visibleApps?: VisibleApps;
  compact?: boolean;
}

const ALL_APPS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
];
const STORAGE_KEY = "tuzi-switch-last-app";

export function AppSwitcher({
  activeApp,
  onSwitch,
  visibleApps,
  compact,
}: AppSwitcherProps) {
  const handleSwitch = (app: AppId) => {
    if (app === activeApp) return;
    localStorage.setItem(STORAGE_KEY, app);
    onSwitch(app);
  };
  const iconSize = 20;
  const appIconName: Record<AppId, string> = {
    claude: "claude",
    "claude-desktop": "claude",
    codex: "openai",
    gemini: "gemini",
    opencode: "opencode",
    openclaw: "openclaw",
    hermes: "hermes",
  };
  const appDisplayName: Record<AppId, string> = {
    claude: "Claude",
    "claude-desktop": "Claude Desktop",
    codex: "Codex",
    gemini: "Gemini",
    opencode: "OpenCode",
    openclaw: "OpenClaw",
    hermes: "Hermes",
  };
  const appBadgeIcon: Partial<Record<AppId, React.ReactNode>> = {
    claude: <Terminal className="h-2.5 w-2.5" strokeWidth={2.4} />,
    "claude-desktop": <Monitor className="h-2.5 w-2.5" strokeWidth={2.4} />,
  };

  // Filter apps based on visibility settings (default all visible)
  const appsToShow = ALL_APPS.filter((app) => {
    if (!visibleApps) return true;
    return visibleApps[app];
  });

  return (
    <div className="inline-flex bg-muted rounded-xl p-1 gap-1">
      {appsToShow.map((app) => (
        <button
          key={app}
          type="button"
          onClick={() => handleSwitch(app)}
          className={cn(
            "group inline-flex items-center px-3 h-8 rounded-md text-sm font-medium transition-all duration-200",
            activeApp === app
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-background/50",
          )}
        >
          <span className="relative inline-flex items-center justify-center flex-shrink-0">
            <ProviderIcon
              icon={appIconName[app]}
              name={appDisplayName[app]}
              size={iconSize}
            />
            {appBadgeIcon[app] ? (
              <span className="absolute -right-0.5 -bottom-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border border-border bg-background shadow-sm">
                {appBadgeIcon[app]}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "transition-all duration-200 whitespace-nowrap overflow-hidden",
              compact
                ? "max-w-0 opacity-0 ml-0"
                : "max-w-[80px] opacity-100 ml-2",
            )}
          >
            {appDisplayName[app]}
          </span>
        </button>
      ))}
    </div>
  );
}
