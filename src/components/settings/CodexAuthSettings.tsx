import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CircleAlert,
  CircleCheck,
  FileCode2,
  History,
  ImageIcon,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import type { SettingsFormState } from "@/hooks/useSettings";
import { ToggleRow } from "@/components/ui/toggle-row";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi } from "@/lib/api";
import { useCodexImageCompatStatusQuery } from "@/lib/query";

interface CodexAuthSettingsProps {
  settings: SettingsFormState;
  /** 返回 false（或 resolve 为 false）表示保存失败；其余返回值视为成功 */
  onChange: (
    updates: Partial<SettingsFormState>,
  ) => void | boolean | Promise<void | boolean>;
}

export function CodexAuthSettings({
  settings,
  onChange,
}: CodexAuthSettingsProps) {
  const { t } = useTranslation();
  const [showEnableConfirm, setShowEnableConfirm] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [hasUnifyBackup, setHasUnifyBackup] = useState(false);
  const imageCompatStatus = useCodexImageCompatStatusQuery();
  const imageCompatRequested = settings.codexImageRenderCompat ?? true;
  const imageCompatNotReadyReason =
    imageCompatRequested &&
    imageCompatStatus.data?.requested === true &&
    !imageCompatStatus.data.ready
      ? imageCompatStatus.data.reason
      : null;

  const handleImageCompatChange = async (value: boolean) => {
    const saved = await onChange({ codexImageRenderCompat: value });
    if (saved !== false) void imageCompatStatus.refetch();
  };

  const handleUnifyHistoryChange = (checked: boolean) => {
    if (checked) {
      setShowEnableConfirm(true);
      return;
    }
    // 先探测有无迁移备份，决定关闭弹窗是否提供"恢复备份"勾选
    void settingsApi
      .hasCodexUnifyHistoryBackup()
      .catch(() => false)
      .then((hasBackup) => {
        setHasUnifyBackup(hasBackup);
        setShowDisableConfirm(true);
      });
  };

  const handleEnableConfirm = (migrateExisting: boolean) => {
    setShowEnableConfirm(false);
    void onChange({
      unifyCodexSessionHistory: true,
      unifyCodexMigrateExisting: migrateExisting,
    });
  };

  // 备份探测可能落后于正在后台进行的迁移（刚勾选迁入就立刻关闭时，
  // 备份尚未产出）。只要本轮勾选过"迁入既有会话"，就必须提供恢复入口；
  // 真正有没有账本交给后端 restore 的 skippedReason 判定。
  const showRestoreOption =
    hasUnifyBackup || (settings.unifyCodexMigrateExisting ?? false);

  const handleDisableConfirm = async (restoreBackup: boolean) => {
    setShowDisableConfirm(false);
    const saved = await onChange({
      unifyCodexSessionHistory: false,
      unifyCodexMigrateExisting: false,
    });
    // 关闭保存失败时绝不还原：否则开关仍开着（live 仍统一路由），
    // 已迁移会话却被翻回 openai 桶，历史被拆成两半。
    if (saved === false) return;
    // 不再以探测结果短路：还原命令会在迁移锁上排队，等到迁移落盘后
    // 拿到完整账本；确实无账本时由 skippedReason 提示。
    if (!restoreBackup) return;
    try {
      const result = await settingsApi.restoreCodexUnifiedHistory();
      if (result.skippedReason) {
        // unify_toggle_on：还原排队期间开关被重新开启，后端拒绝还原
        toast.info(
          result.skippedReason === "unify_toggle_on"
            ? t("settings.unifyCodexHistoryRestoreSkippedToggleOn")
            : t("settings.unifyCodexHistoryRestoreNothing"),
        );
        return;
      }
      toast.success(
        t("settings.unifyCodexHistoryRestoreCompleted", {
          files: result.restoredJsonlFiles,
          rows: result.restoredStateRows,
        }),
      );
    } catch (error) {
      console.error("Failed to restore codex unified history:", error);
      toast.error(t("settings.unifyCodexHistoryRestoreFailed"));
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">{t("settings.codexAuth")}</h3>
      </div>

      <ToggleRow
        icon={<KeyRound className="h-4 w-4 text-emerald-500" />}
        title={t("settings.preserveCodexOfficialAuthOnSwitch")}
        description={t("settings.preserveCodexOfficialAuthOnSwitchDescription")}
        checked={settings.preserveCodexOfficialAuthOnSwitch ?? true}
        onCheckedChange={(value) =>
          onChange({ preserveCodexOfficialAuthOnSwitch: value })
        }
      />

      <ToggleRow
        icon={<ImageIcon className="h-4 w-4 text-rose-500" />}
        title={t("settings.codexImageRenderCompat")}
        badge={t("settings.codexImageRenderCompatBadge")}
        description={t("settings.codexImageRenderCompatDescription")}
        checked={imageCompatRequested}
        onCheckedChange={(value) => void handleImageCompatChange(value)}
      />
      {imageCompatNotReadyReason ? (
        <p
          className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300"
          role="status"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("settings.codexImageRenderCompatNotReady", {
            reason: t(
              `settings.codexImageRenderCompatReason.${imageCompatNotReadyReason}`,
            ),
          })}
        </p>
      ) : null}
      {imageCompatRequested ? (
        <div
          className="ml-11 space-y-3 border-l-2 border-rose-500/60 pl-4"
          data-testid="codex-image-compat-details"
        >
          <div className="flex flex-wrap items-center gap-2">
            {imageCompatStatus.data?.ready ? (
              <CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <FileCode2 className="h-4 w-4 text-muted-foreground" />
            )}
            <p className="text-xs font-medium">
              {t("settings.codexImageRenderCompatDetails.title")}
            </p>
            <span
              className={
                imageCompatStatus.data?.ready
                  ? "rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                  : "rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
              }
            >
              {t(
                imageCompatStatus.data?.ready
                  ? "settings.codexImageRenderCompatDetails.ready"
                  : "settings.codexImageRenderCompatDetails.pending",
              )}
            </span>
          </div>

          <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
            <CompatDetail
              label={t(
                "settings.codexImageRenderCompatDetails.providerBaseUrl",
              )}
              value={imageCompatStatus.data?.providerBaseUrl}
              fallback={t("settings.codexImageRenderCompatDetails.notDetected")}
              badge={t("settings.codexImageRenderCompatDetails.unchanged")}
              badgeClassName="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            />
            <CompatDetail
              label={t("settings.codexImageRenderCompatDetails.providerEnvKey")}
              value={imageCompatStatus.data?.providerEnvKey}
              fallback={t("settings.codexImageRenderCompatDetails.notDetected")}
              badge={t("settings.codexImageRenderCompatDetails.unchanged")}
              badgeClassName="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            />
            <CompatDetail
              label={t("settings.codexImageRenderCompatDetails.liveBaseUrl")}
              value={imageCompatStatus.data?.liveBaseUrl}
              fallback={t(
                "settings.codexImageRenderCompatDetails.waitingForRoute",
              )}
              badge={t("settings.codexImageRenderCompatDetails.temporary")}
              badgeClassName="bg-amber-500/15 text-amber-700 dark:text-amber-300"
            />
            <CompatDetail
              label={t("settings.codexImageRenderCompatDetails.imageKeyEnv")}
              value={imageCompatStatus.data?.imageKeyEnv}
              fallback="TUZI_CODEX_IMAGE_API_KEY"
              badge={t("settings.codexImageRenderCompatDetails.privateDerived")}
              badgeClassName="bg-sky-500/15 text-sky-700 dark:text-sky-300"
            />
            <CompatDetail
              label={t("settings.codexImageRenderCompatDetails.imageUpstream")}
              value={imageCompatStatus.data?.imageUpstream}
              fallback="https://api.tu-zi.com/coding"
              badge={t("settings.codexImageRenderCompatDetails.fixed")}
              badgeClassName="bg-rose-500/15 text-rose-700 dark:text-rose-300"
            />
            <CompatDetail
              label={t("settings.codexImageRenderCompatDetails.imageModel")}
              value={imageCompatStatus.data?.imageModel}
              fallback="gpt-image-2"
              badge={t("settings.codexImageRenderCompatDetails.fixed")}
              badgeClassName="bg-rose-500/15 text-rose-700 dark:text-rose-300"
            />
          </dl>

          <div className="space-y-1 text-xs">
            <p className="text-muted-foreground">
              {t("settings.codexImageRenderCompatDetails.personalization")}
            </p>
            <code className="block whitespace-pre-wrap break-words border-l-2 border-sky-500/60 pl-3 font-mono leading-5 text-foreground">
              {imageCompatStatus.data?.personalizationInstruction ??
                t(
                  "settings.codexImageRenderCompatDetails.personalizationInstruction",
                )}
            </code>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {t("settings.codexImageRenderCompatDetails.securityNote")}
          </p>
        </div>
      ) : null}

      <ToggleRow
        icon={<History className="h-4 w-4 text-sky-500" />}
        title={t("settings.unifyCodexSessionHistory")}
        description={t("settings.unifyCodexSessionHistoryDescription")}
        checked={settings.unifyCodexSessionHistory ?? true}
        onCheckedChange={handleUnifyHistoryChange}
      />

      <ConfirmDialog
        isOpen={showEnableConfirm}
        title={t("confirm.unifyCodexHistory.title")}
        message={t("confirm.unifyCodexHistory.message")}
        checkboxLabel={t("confirm.unifyCodexHistory.migrateExisting")}
        confirmText={t("confirm.unifyCodexHistory.confirm")}
        onConfirm={handleEnableConfirm}
        onCancel={() => setShowEnableConfirm(false)}
      />

      <ConfirmDialog
        isOpen={showDisableConfirm}
        title={t("confirm.unifyCodexHistoryOff.title")}
        message={t("confirm.unifyCodexHistoryOff.message")}
        checkboxLabel={
          showRestoreOption
            ? t("confirm.unifyCodexHistoryOff.restoreBackup")
            : undefined
        }
        checkboxDefaultChecked
        confirmText={t("confirm.unifyCodexHistoryOff.confirm")}
        onConfirm={(restoreBackup) => void handleDisableConfirm(restoreBackup)}
        onCancel={() => setShowDisableConfirm(false)}
      />
    </section>
  );
}

function CompatDetail({
  label,
  value,
  fallback,
  badge,
  badgeClassName,
}: {
  label: string;
  value?: string | null;
  fallback: string;
  badge: string;
  badgeClassName: string;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-foreground">
        {value || fallback}
      </dd>
      <dd className="justify-self-start sm:justify-self-end">
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${badgeClassName}`}
        >
          {badge}
        </span>
      </dd>
    </>
  );
}
