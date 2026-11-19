import {
  ArrowRight,
  Check,
  Loader2,
  Monitor,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import type { Provider } from "@/types";
import { configuredModels } from "@/lib/claudeDesktopModels";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface ClaudeGatewayWizardProps {
  providerId?: string;
  providers: (Pick<Provider, "id" | "name"> &
    Partial<Pick<Provider, "meta" | "settingsConfig">>)[];
  installed: boolean;
  installationPending: boolean;
  connectionReady: boolean;
  desktopRunning: boolean | null;
  busy: boolean;
  working: boolean;
  onSelectProvider?: (id: string) => void;
  onAddProvider?: () => void;
  onEditProvider?: (id: string) => void;
  onImport: () => void;
  onPrepare: () => void;
  onConnect: () => void;
  onLaunch: () => void;
  expandProviders: boolean;
  children?: ReactNode;
  advanced: ReactNode;
  error?: ReactNode;
}

export function ClaudeGatewayWizard({
  providerId,
  providers,
  installed,
  installationPending,
  connectionReady,
  desktopRunning,
  busy,
  working,
  onSelectProvider,
  onAddProvider,
  onEditProvider,
  onImport,
  onPrepare,
  onConnect,
  onLaunch,
  expandProviders,
  children,
  advanced,
  error,
}: ClaudeGatewayWizardProps) {
  const { t } = useTranslation();
  const selected = providers.find((provider) => provider.id === providerId);
  const models = configuredModels(selected);
  const official = selected?.id === "claude-desktop-official";
  const needsModels = Boolean(selected && !official && models.length === 0);
  const stage =
    !selected || needsModels ? 0 : !installed ? 1 : !connectionReady ? 2 : 3;
  const action = needsModels
    ? () => onEditProvider?.(providerId!)
    : !installed
      ? onPrepare
      : !connectionReady
        ? onConnect
        : onLaunch;
  const label = needsModels
    ? "configureModels"
    : !installed
      ? "recheckInstallation"
      : !connectionReady
        ? "checkConnection"
        : "launchAction";
  const hint = !selected
    ? "lineHint"
    : needsModels
      ? "modelsMissingHint"
      : !installed
        ? "installMessage"
        : desktopRunning === null
          ? "processDetectionError"
          : desktopRunning
            ? "closeClaudeHint"
            : !connectionReady
              ? "connectionHint"
              : "gatewayLaunchHint";
  return (
    <section
      aria-label={t("claudeLocal.title")}
      className="w-full overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
              <Monitor className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Claude Desktop
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("claudeLocal.subtitle")}
              </p>
            </div>
          </div>
          <span
            role="status"
            className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
          >
            {t(
              `claudeLocal.${desktopRunning === null ? "processUnknown" : desktopRunning ? "desktopRunning" : "idle"}`,
            )}
          </span>
        </div>
        <ol
          aria-label={t("claudeLocal.stepsLabel")}
          className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {["lineStep", "prepareStep", "connectionStep", "launchStep"].map(
            (step, index) => (
              <li
                key={step}
                aria-current={stage === index ? "step" : undefined}
                className="flex items-center gap-2 text-xs sm:text-sm"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${index < stage ? "bg-primary/10 text-primary" : index === stage ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {index < stage ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                {t(`claudeLocal.${step}`)}
              </li>
            ),
          )}
        </ol>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-4">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="claude-local-provider"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("claudeLocal.lineLabel")}
            </label>
            <select
              id="claude-local-provider"
              value={providerId || ""}
              disabled={busy || desktopRunning !== false}
              onChange={(event) => onSelectProvider?.(event.target.value)}
              className="mt-1 block w-full max-w-sm rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="" disabled>
                {t("claudeLocal.chooseLine")}
              </option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
          {onAddProvider && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onAddProvider}
              disabled={busy}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("claudeLocal.addLine")}
            </Button>
          )}
          {providers.length === 0 && (
            <Button variant="outline" disabled={busy} onClick={onImport}>
              {t("claudeLocal.importLine")}
            </Button>
          )}
        </div>
        {selected && !official && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("claudeLocal.modelsConfigured", { count: models.length })}
            {onEditProvider && (
              <Button
                variant="link"
                size="sm"
                disabled={busy || desktopRunning !== false}
                onClick={() => onEditProvider(selected.id)}
              >
                {t("claudeLocal.manageModels")}
              </Button>
            )}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            {t(`claudeLocal.${hint}`)}
          </p>
          <Button
            className="shrink-0 self-start sm:self-auto"
            onClick={action}
            disabled={
              busy ||
              installationPending ||
              !selected ||
              (needsModels
                ? !onEditProvider
                : installed && desktopRunning !== false)
            }
          >
            {working && (
              <Loader2
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            )}
            {t(`claudeLocal.${working ? "working" : label}`)}
            {!working && (
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
        {error}
      </div>
      <details className="border-t">
        <summary className="flex cursor-pointer items-center gap-2 px-6 py-4 text-sm">
          <SlidersHorizontal className="h-4 w-4" />
          {t("claudeLocal.optionalFeatures")}
        </summary>
        <div className="space-y-4 px-6 pb-5">
          {["voice", "computer", "cowork"].map((feature) => (
            <div
              key={feature}
              className="flex items-start justify-between gap-4"
            >
              <div>
                <p className="text-sm">{t(`claudeLocal.${feature}`)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`claudeLocal.${feature}GatewayHint`)}
                </p>
              </div>
              <Switch
                checked={false}
                disabled
                aria-label={t(`claudeLocal.${feature}`)}
              />
            </div>
          ))}
        </div>
      </details>
      <details className="border-t" open={expandProviders || undefined}>
        <summary className="cursor-pointer px-6 py-4 text-sm">
          {t("claudeLocal.manageLines")}
        </summary>
        <div className="px-5 pb-5">{children}</div>
      </details>
      <details className="border-t">
        <summary className="cursor-pointer px-6 py-4 text-sm text-muted-foreground">
          {t("claudeLocal.advanced")}
        </summary>
        <div className="px-6 pb-5">{advanced}</div>
      </details>
    </section>
  );
}
