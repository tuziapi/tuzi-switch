import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { universalProvidersApi } from "@/lib/api";
import type { UniversalProvider } from "@/types";

/** Only expose known tool labels, never raw IPC/parser errors or credentials. */
export function universalSyncFailedTools(error: unknown): string | undefined {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  const match = message.match(/以下工具未完成同步：([a-z、]+)。/);
  const labels: Record<string, string> = {
    claude: "Claude Code",
    codex: "Codex",
    gemini: "Gemini CLI",
  };
  const tools = match?.[1]
    .split("、")
    .filter((tool) => Object.prototype.hasOwnProperty.call(labels, tool))
    .map((tool) => labels[tool]);
  return tools?.length ? tools.join(" / ") : undefined;
}

/** Both entry points use the same save/sync semantics. False keeps the draft open. */
export function useUniversalProviderSave(onSaved?: () => Promise<void>) {
  const { t } = useTranslation();
  return useCallback(
    async (provider: UniversalProvider): Promise<boolean> => {
      try {
        await universalProvidersApi.upsert(provider);
      } catch {
        toast.error(t("universalProvider.saveError"), {
          position: "top-center",
        });
        return false;
      }
      try {
        await universalProvidersApi.sync(provider.id);
      } catch (error) {
        await onSaved?.();
        const tools = universalSyncFailedTools(error);
        toast.warning(t("universalProvider.savedButSyncFailed"), {
          position: "top-center",
          ...(tools ? { description: tools } : {}),
        });
        return false;
      }
      await onSaved?.();
      toast.success(t("universalProvider.savedAndSynced"), {
        position: "top-center",
      });
      return true;
    },
    [onSaved, t],
  );
}
