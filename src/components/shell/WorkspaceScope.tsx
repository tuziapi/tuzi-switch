import { useTranslation } from "react-i18next";
import type { AppId } from "@/lib/api";
import {
  WORKSPACE_SUPPORT,
  WORKSPACE_TOOLS,
  WORKSPACE_TOOL_NAMES,
  type WorkspaceTool,
} from "@/config/workspace";

export function WorkspaceScope({
  feature,
  origin,
  target,
  onTargetChange,
}: {
  feature: keyof typeof WORKSPACE_SUPPORT;
  origin: WorkspaceTool;
  target?: AppId | null;
  onTargetChange?: (tool: AppId) => void;
}) {
  const { t } = useTranslation();
  const supported = WORKSPACE_SUPPORT[feature];
  const originSupported = supported.includes(origin as AppId);
  return (
    <section
      className="workspace-scope mx-6 mb-3 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shrink-0 space-y-2"
      aria-label={t("navigation.supportScope")}
    >
      <p>
        {t("navigation.supportedTools", {
          tools: supported
            .map((tool) => WORKSPACE_TOOL_NAMES[tool])
            .join(" / "),
        })}
      </p>
      {!originSupported && (
        <p>
          {t("navigation.unsupportedOrigin", {
            tool: WORKSPACE_TOOL_NAMES[origin],
          })}
        </p>
      )}
      {onTargetChange && (
        <label className="flex flex-wrap items-center gap-3 text-foreground">
          {t("navigation.targetTool")}
          <select
            aria-label={t("navigation.targetTool")}
            value={target ?? ""}
            onChange={(e) => onTargetChange(e.target.value as AppId)}
            className="h-8 max-w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="" disabled>
              {t("navigation.chooseTarget")}
            </option>
            {WORKSPACE_TOOLS.map((tool) => (
              <option
                key={tool}
                value={tool}
                disabled={!supported.includes(tool as AppId)}
              >
                {WORKSPACE_TOOL_NAMES[tool]}
                {!supported.includes(tool as AppId)
                  ? ` · ${t("navigation.notSupported")}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}
