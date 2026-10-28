import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Provider } from "@/types";
import {
  aggregationApi,
  type AggregationState,
  type AggregationPlan,
} from "@/lib/api/aggregation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AggregationDialog({
  appId,
  providers,
  currentProviderId,
  state,
  onClose,
}: {
  appId: string;
  providers: Record<string, Provider>;
  currentProviderId: string;
  state: AggregationState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [plan, setPlan] = useState<AggregationPlan>(() =>
    state.plan.models.length
      ? state.plan
      : { defaultProviderId: currentProviderId, models: [] },
  );
  const [error, setError] = useState(false);
  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      aggregationApi.apply(appId, plan, enabled),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["aggregation", appId] }),
        client.invalidateQueries({ queryKey: ["proxyStatus"] }),
        client.invalidateQueries({ queryKey: ["proxyTakeoverStatus"] }),
      ]);
      onClose();
    },
    onError: () => setError(true),
  });
  const eligible = Object.values(providers).filter(
    (p) =>
      p.category !== "official" &&
      !["codex_oauth", "github_copilot"].includes(p.meta?.providerType ?? ""),
  );
  const locked = state.enabled || state.needsRecovery || mutation.isPending;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("aggregation.title")}</DialogTitle>
          <DialogDescription>{t("aggregation.description")}</DialogDescription>
        </DialogHeader>
        <div className="p-5 space-y-4 min-h-0 overflow-y-auto">
          <p className="text-xs text-muted-foreground">
            {t("aggregation.limitations")}
          </p>
          <label className="block text-sm">
            {t("aggregation.defaultProvider")}
            <select
              aria-label={t("aggregation.defaultProvider")}
              className="block w-full mt-1 h-9 rounded border border-border bg-background px-2"
              value={plan.defaultProviderId}
              disabled={locked}
              onChange={(e) =>
                setPlan({ ...plan, defaultProviderId: e.target.value })
              }
            >
              <option value="">{t("aggregation.choose")}</option>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            {t("aggregation.defaultHint")}
          </p>
          {plan.models.map((model, index) => (
            <div
              key={index}
              className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border border-border p-3"
            >
              <select
                aria-label={t("aggregation.provider")}
                className="h-9 rounded border border-border bg-background px-2 text-sm"
                disabled={locked}
                value={model.providerId}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    models: plan.models.map((m, i) =>
                      i === index ? { ...m, providerId: e.target.value } : m,
                    ),
                  })
                }
              >
                <option value="">{t("aggregation.choose")}</option>
                {eligible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Input
                aria-label={t("aggregation.model")}
                placeholder={t("aggregation.model")}
                disabled={locked}
                value={model.model}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    models: plan.models.map((m, i) =>
                      i === index
                        ? {
                            ...m,
                            model: e.target.value,
                            displayName: e.target.value,
                          }
                        : m,
                    ),
                  })
                }
              />
              <label className="text-xs text-muted-foreground flex items-center gap-2">
                {t("aggregation.context")}
                <Input
                  type="number"
                  min={1}
                  disabled={locked}
                  value={model.contextWindow}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      models: plan.models.map((m, i) =>
                        i === index
                          ? { ...m, contextWindow: +e.target.value }
                          : m,
                      ),
                    })
                  }
                />
              </label>
              <Button
                variant="ghost"
                disabled={locked}
                onClick={() =>
                  setPlan({
                    ...plan,
                    models: plan.models.filter((_, i) => i !== index),
                  })
                }
              >
                {t("common.delete")}
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            disabled={locked || plan.models.length >= 200}
            onClick={() =>
              setPlan({
                ...plan,
                models: [
                  ...plan.models,
                  {
                    providerId: plan.defaultProviderId,
                    model: "",
                    displayName: "",
                    contextWindow: 128000,
                  },
                ],
              })
            }
          >
            {t("aggregation.addModel")}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t("aggregation.failed")}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common.close")}
            </Button>
            {state.enabled || state.needsRecovery ? (
              <Button
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(false)}
              >
                {t("aggregation.exit")}
              </Button>
            ) : (
              <Button
                disabled={
                  mutation.isPending ||
                  !plan.defaultProviderId ||
                  !plan.models.length ||
                  plan.models.some(
                    (m) =>
                      !m.providerId ||
                      !m.model.trim() ||
                      !Number.isFinite(m.contextWindow) ||
                      m.contextWindow <= 0,
                  )
                }
                onClick={() => mutation.mutate(true)}
              >
                {t("aggregation.enable")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
