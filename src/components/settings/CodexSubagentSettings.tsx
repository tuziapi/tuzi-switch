import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { settingsApi } from "@/lib/api";
import type { CodexSubagentSettings as CodexSubagentSettingsState } from "@/lib/api/settings";

const PRESET_VALUES = [1, 2, 4, 6, 8, 12, 16];

export function CodexSubagentSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState<CodexSubagentSettingsState | null>(null);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void settingsApi
      .getCodexSubagentSettings()
      .then((next) => {
        if (cancelled) return;
        setState(next);
        setDraft(next.maxConcurrentThreadsPerSession?.toString() ?? "");
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load Codex subagent settings", error);
          toast.error(t("settings.codexSubagents.loadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const save = async (value: number | null) => {
    setIsSaving(true);
    try {
      const next =
        await settingsApi.setCodexSubagentMaxConcurrentThreads(value);
      setState(next);
      setDraft(next.maxConcurrentThreadsPerSession?.toString() ?? "");
      toast.success(t("settings.codexSubagents.saved"));
    } catch (error) {
      console.error("Failed to save Codex subagent settings", error);
      toast.error(t("settings.codexSubagents.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      void save(null);
      return;
    }
    if (!/^[1-9][0-9]*$/.test(trimmed)) {
      toast.error(t("settings.codexSubagents.invalid"));
      return;
    }
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
      toast.error(t("settings.codexSubagents.invalid"));
      return;
    }
    void save(value);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <Settings2 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">
          {t("settings.codexSubagents.title")}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.codexSubagents.description")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("settings.codexSubagents.inputLabel")}
          data-testid="codex-subagent-thread-input"
          type="number"
          min={1}
          max={2147483647}
          value={draft}
          disabled={isLoading || isSaving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSave();
          }}
          placeholder={t("settings.codexSubagents.defaultPlaceholder")}
          className="w-32"
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isLoading || isSaving}
          data-testid="codex-subagent-thread-save"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("common.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft("");
            void save(null);
          }}
          disabled={isLoading || isSaving || !draft}
          title={t("settings.codexSubagents.reset")}
          data-testid="codex-subagent-thread-reset"
        >
          <RotateCcw className="h-4 w-4" />
          {t("settings.codexSubagents.defaultOption")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESET_VALUES.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={draft === String(value) ? "default" : "secondary"}
            onClick={() => {
              setDraft(String(value));
              void save(value);
            }}
            disabled={isLoading || isSaving}
          >
            {value}
          </Button>
        ))}
      </div>
      {state ? (
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p className="break-all font-mono">{state.configPath}</p>
          {state.usedLegacyAlias ? (
            <p>{t("settings.codexSubagents.legacyDetected")}</p>
          ) : null}
          <p>{t("settings.codexSubagents.restartHint")}</p>
        </div>
      ) : null}
    </section>
  );
}
