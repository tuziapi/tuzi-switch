import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isKnownNonChatModel,
  sortCatalog,
  type CatalogModel,
} from "@/lib/claudeDesktopModels";

export function ClaudeModelCatalog({
  models,
  defaultModel,
  onSelect,
  onRefresh,
  busy,
  error,
}: {
  models: CatalogModel[];
  defaultModel: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  busy: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const matches = useMemo(
    () =>
      sortCatalog(models, defaultModel).filter((model) =>
        model.id.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [models, defaultModel, search],
  );
  return (
    <section
      aria-label={t("claudeDesktop.catalogTitle")}
      className="space-y-3 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {t("claudeDesktop.catalogTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {models.length
              ? t("claudeDesktop.catalogCount", { count: models.length })
              : t("claudeDesktop.catalogAutoHint")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onRefresh}
        >
          {t(
            busy
              ? "claudeDesktop.catalogLoading"
              : "claudeDesktop.catalogRefresh",
          )}
        </Button>
      </div>
      {defaultModel && !models.some((model) => model.id === defaultModel) && (
        <p className="text-xs text-muted-foreground break-all">
          {t("claudeDesktop.catalogDefault")}: {defaultModel}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {models.length > 0 && (
        <>
          <Input
            aria-label={t("claudeDesktop.catalogSearch")}
            placeholder={t("claudeDesktop.catalogSearch")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div
            className="max-h-72 overflow-y-auto divide-y"
            role="radiogroup"
            aria-label={t("claudeDesktop.catalogDefault")}
          >
            {matches.map((model) => (
              <label
                key={model.id}
                className="flex items-center gap-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="claude-catalog-default"
                  checked={defaultModel === model.id}
                  disabled={busy || isKnownNonChatModel(model.id)}
                  onChange={() => onSelect(model.id)}
                  aria-label={model.id}
                />
                <span className="min-w-0 flex-1 break-all">{model.id}</span>
                {isKnownNonChatModel(model.id) && (
                  <span className="text-xs text-muted-foreground">
                    {t("claudeDesktop.catalogNonChatBadge")}
                  </span>
                )}
                {defaultModel === model.id && (
                  <span className="shrink-0 text-xs text-primary">
                    {t("claudeDesktop.catalogDefault")}
                  </span>
                )}
              </label>
            ))}
            {!matches.length && (
              <p className="py-3 text-sm text-muted-foreground">
                {t("claudeDesktop.catalogNoMatches")}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("claudeDesktop.catalogScope")}
          </p>
        </>
      )}
    </section>
  );
}
