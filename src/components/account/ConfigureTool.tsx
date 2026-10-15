import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { desktopRequest, type AccountState } from "@/lib/api/account";
import type {
  DesktopKey,
  DesktopPricing,
  Models,
  DesktopError,
} from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import {
  TUZI_TOOL_TARGETS,
  tuziToolCompatibility,
  type TuziProviderDraft,
} from "@/lib/tuziToolCompatibility";
export function ConfigureTool({
  state,
  keyDto,
  model: initial,
  onClose,
  onReady,
}: {
  state: AccountState;
  keyDto: DesktopKey;
  model?: DesktopPricing;
  onClose: () => void;
  onReady: (draft: TuziProviderDraft) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [snapshot, setSnapshot] = useState("");
  const models = useDesktop<Models>(state, "/api/desktop/models", {
    page,
    page_size: 100,
    search,
    snapshot_id: page > 1 ? snapshot : undefined,
  });
  const [model, setModel] = useState(initial),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<DesktopError | null>(null);
  useEffect(() => {
    if (!models.data) return;
    if (models.data.data.snapshot_refreshed) {
      setPage(1);
      setModel(undefined);
      setTarget("");
    }
    setSnapshot(models.data.data.snapshot_id);
  }, [models.data, page]);
  useEffect(() => {
    if ((models.error as DesktopError | null)?.code === "snapshot_changed") {
      setPage(1);
      setSnapshot("");
      setModel(undefined);
      setTarget("");
    }
  }, [models.error]);
  const alive = useRef(true);
  const abort = useRef(new AbortController());
  useEffect(
    () => () => {
      alive.current = false;
      abort.current.abort();
    },
    [],
  );
  const selected = TUZI_TOOL_TARGETS.find(
    (x) => `${x.appId}:${x.protocol}` === target,
  );
  const reason =
    selected && model
      ? tuziToolCompatibility(
          keyDto,
          model,
          selected.appId,
          selected.protocol,
          undefined,
          models.data?.data.pricing_meta,
        )
      : t("account.business.selectCompatible");
  const reveal = async () => {
    if (!selected || !model || reason || models.error) return;
    setBusy(true);
    setError(null);
    try {
      const r = await desktopRequest<{ key: string }>(
        {
          method: "POST",
          path: `/api/desktop/keys/${keyDto.id}/reveal`,
          generation: state.generation,
        },
        abort.current.signal,
      );
      if (alive.current)
        onReady({
          appId: selected.appId,
          protocol: selected.protocol,
          key: r.data.key,
          tokenId: keyDto.id,
          userId: state.identity!.userId,
          generation: state.generation,
          model: model.model_name,
          name: keyDto.name,
        });
    } catch (e) {
      if (alive.current) setError(e as DesktopError);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section
      role="dialog"
      aria-label={t("account.business.configure")}
      className="account-configure-dialog"
    >
      <h2>{t("account.business.configure")}</h2>
      <p>{t("account.business.configureNotice")}</p>
      <label>
        {t("account.business.modelFilter.search")}
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
            setSnapshot("");
          }}
        />
      </label>
      <div className="account-pager">
        <Button
          variant="outline"
          aria-label={t("account.business.previous")}
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          ←
        </Button>
        <span>{page}</span>
        <Button
          variant="outline"
          aria-label={t("account.business.next")}
          disabled={!models.data?.data.pagination.has_more}
          onClick={() => setPage(page + 1)}
        >
          →
        </Button>
      </div>
      <label>
        {t("account.business.model")}
        <select
          value={model?.model_name ?? ""}
          onChange={(e) =>
            setModel(
              e.target.value === initial?.model_name
                ? initial
                : models.data?.data.items.find(
                    (m) => m.model_name === e.target.value,
                  ),
            )
          }
        >
          <option value="">—</option>
          {initial && (
            <option value={initial.model_name}>{initial.model_name}</option>
          )}
          {models.data?.data.items
            .filter((m) => m.model_name !== initial?.model_name)
            .map((m) => (
              <option key={m.model_name}>{m.model_name}</option>
            ))}
        </select>
      </label>
      <label>
        {t("account.business.tool")}
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">—</option>
          {TUZI_TOOL_TARGETS.map((x) => (
            <option
              key={`${x.appId}:${x.protocol}`}
              value={`${x.appId}:${x.protocol}`}
            >
              {x.appId} · {x.protocol} · {x.endpoint}
            </option>
          ))}
        </select>
      </label>
      {reason && <p>{reason}</p>}
      {models.error && (
        <p role="alert">{t("account.business.errors.generic")}</p>
      )}
      {error && (
        <p role="alert">
          {t(
            error.outcomeUnknown
              ? "account.business.unknownOutcome"
              : "account.business.errors.generic",
          )}
        </p>
      )}
      <div className="account-form-actions">
        <Button
          disabled={busy || !!reason || !!models.error}
          onClick={() => void reveal()}
        >
          {t("account.business.revealAndContinue")}
        </Button>
        <Button variant="outline" disabled={false} onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </section>
  );
}
