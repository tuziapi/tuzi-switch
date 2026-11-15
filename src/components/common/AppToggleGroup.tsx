import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AppId } from "@/lib/api/types";
import type { NativeTool } from "@/lib/api/nativeTools";
import { APP_ICON_MAP } from "@/config/appConfig";

interface AppToggleGroupProps<T extends AppId | NativeTool> {
  apps: Partial<Record<T, boolean>>;
  onToggle: (app: T, enabled: boolean) => void;
  appIds: T[];
}

export const AppToggleGroup = <T extends AppId | NativeTool>({
  apps,
  onToggle,
  appIds,
}: AppToggleGroupProps<T>) => {
  return (
    <div className="workspace-app-toggles flex flex-wrap items-center gap-1.5">
      {appIds.map((app) => {
        const { label, icon, activeClass } = APP_ICON_MAP[app];
        const enabled = apps[app];
        return (
          <Tooltip key={app}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-pressed={!!enabled}
                onClick={() => onToggle(app, !enabled)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                  enabled ? activeClass : "opacity-35 hover:opacity-70"
                }`}
              >
                {icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>
                {label}
                {enabled ? " ✓" : ""}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
};
