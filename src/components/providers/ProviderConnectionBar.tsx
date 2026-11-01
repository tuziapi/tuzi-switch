import { useState } from "react";
import { CircleHelp, Layers, Loader2, Plug, Route } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ProviderConnectionBarProps {
  mode: "direct" | "route" | "aggregate" | "unknown";
  status: string;
  busy?: boolean;
  unavailable?: boolean;
  onChange: (mode: "direct" | "route") => void;
  onOpenSettings: () => void;
  onOpenAggregation?: () => void;
  aggregationSupported?: boolean;
}

/** Presentation only: the caller supplies verified native state and actions. */
export function ProviderConnectionBar({
  mode,
  status,
  busy = false,
  unavailable = false,
  onChange,
  onOpenSettings,
  onOpenAggregation,
  aggregationSupported = true,
}: ProviderConnectionBarProps) {
  const { t } = useTranslation();
  const [aggregationOpen, setAggregationOpen] = useState(false);
  return (
    <section
      className="provider-connection-bar"
      aria-label={t("connectionMode.label")}
    >
      <div
        className="provider-mode-options"
        role="group"
        aria-label={t("connectionMode.label")}
      >
        {(["direct", "route"] as const).map((value) => {
          const Icon = value === "direct" ? Plug : Route;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={busy || unavailable}
              onClick={() => onChange(value)}
              className={cn(
                "provider-mode-button",
                mode === value && "is-selected",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(`connectionMode.${value}`)}
              {mode === value && (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </button>
          );
        })}
        {aggregationSupported && (
          <button
            type="button"
            className={cn(
              "provider-mode-button",
              mode === "aggregate" && "is-selected",
            )}
            onClick={() =>
              onOpenAggregation ? onOpenAggregation() : setAggregationOpen(true)
            }
            aria-pressed={mode === "aggregate"}
            aria-label={t(
              onOpenAggregation
                ? "aggregation.title"
                : "connectionMode.aggregationPlanned",
            )}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            {t("connectionMode.aggregate")}
            {!onOpenAggregation && (
              <span className="text-[9px] text-muted-foreground">
                {t("connectionMode.planned")}
              </span>
            )}
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={t("connectionMode.settings")}
        onClick={onOpenSettings}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </Button>
      <p
        role="status"
        className="min-w-0 text-xs text-muted-foreground break-words"
      >
        {busy && (
          <Loader2
            className="mr-1 inline h-3 w-3 animate-spin"
            aria-hidden="true"
          />
        )}
        {status}
      </p>
      <Dialog open={aggregationOpen} onOpenChange={setAggregationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("connectionMode.aggregationPlanned")}</DialogTitle>
            <DialogDescription>
              {t("connectionMode.aggregationDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end p-4">
            <Button onClick={() => setAggregationOpen(false)}>
              {t("common.close")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
