import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const PRESET_VALUES = [1, 2, 4, 6, 8, 12, 16];

interface CodexSubagentProviderFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function CodexSubagentProviderField({
  value,
  onChange,
}: CodexSubagentProviderFieldProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-muted/20 p-4">
      <div className="space-y-1">
        <Label htmlFor="codexSubagentThreads">
          {t("codexConfig.subagentThreadsLabel")}
        </Label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("codexConfig.subagentThreadsHint")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={value === "" ? "default" : "outline"}
          onClick={() => onChange("")}
          data-testid="codex-subagent-inherit"
        >
          {t("codexConfig.subagentThreadsInherit")}
        </Button>
        <Input
          id="codexSubagentThreads"
          type="number"
          min={1}
          max={2147483647}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("codexConfig.subagentThreadsCustom")}
          className="h-9 w-28"
          data-testid="codex-subagent-provider-input"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESET_VALUES.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant={value === String(preset) ? "default" : "secondary"}
            onClick={() => onChange(String(preset))}
            className="min-w-9"
            data-testid={`codex-subagent-preset-${preset}`}
          >
            {preset}
          </Button>
        ))}
      </div>
    </div>
  );
}
