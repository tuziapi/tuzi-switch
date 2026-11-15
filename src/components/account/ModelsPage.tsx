import { Search } from "lucide-react";
import { ModelIcon } from "./ModelIcon";
import { ModelFilters, billingLabels } from "./ModelFilters";
import { AccountErrorBoundary } from "./AccountErrorBoundary";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { desktopRequest, type AccountState } from "@/lib/api/account";
import type {
  DesktopError,
  DesktopKey,
  DesktopPricing,
  Models,
  Page,
  Performance,
} from "@/lib/api/desktop";
import { useAccountRead, useDesktop } from "@/lib/query/desktop";
import { date, Pager, QueryState } from "./BusinessShared";
import { PricingDetails } from "./PricingDetails";
import { AccountDialog } from "./AccountDialog";
import { useAccountViewState } from "./AccountViewState";

export function ModelsPage({
  state,
  performance = false,
  onConfigure,
}: {
  state: AccountState;
  performance?: boolean;
  onConfigure?: (key: DesktopKey, model?: DesktopPricing) => void;
}) {
  const { t, i18n } = useTranslation();
  const prefix = performance ? "performance" : "models";
  const [page, setPage] = useAccountViewState(`${prefix}.page`, 1);
  const [filters, setFilters] = useAccountViewState<Record<string, string>>(
    `${prefix}.filters`,
    {},
  );
  const [draft, setDraft] = useAccountViewState<Record<string, string>>(
    `${prefix}.draft`,
    filters,
  );
  const [snapshot, setSnapshot] = useAccountViewState<string | undefined>(
    `${prefix}.snapshot`,
    undefined,
  );
  const [selected, setSelected] = useState<DesktopPricing | null>(null);
  const [hours, setHours] = useAccountViewState(`${prefix}.hours`, 24);
  const [keyId, setKeyId] = useState("");
  const [keyPage, setKeyPage] = useState(1);
  const models = useDesktop<Models>(
    state,
    "/account/models",
    {
      ...filters,
      page,
      page_size: performance ? 6 : 12,
      snapshot_id: page > 1 ? snapshot : undefined,
    },
    300000,
  );
  const keys = useDesktop<Page<DesktopKey>>(
    selected && onConfigure ? state : { ...state, identity: null },
    "/account/keys",
    { page: keyPage, page_size: 100, status: 1 },
  );
  const modelNames =
    models.data?.data.items.map((model) => model.model_name) ?? [];
  const quality = useAccountRead(
    performance && modelNames.length ? state : { ...state, identity: null },
    "/account/model-performance/batch",
    { models: JSON.stringify(modelNames), hours, group: filters.group },
    (signal) =>
      desktopRequest<Performance[]>(
        {
          method: "POST",
          path: "/account/model-performance/batch",
          generation: state.generation,
          body: {
            models: modelNames,
            ...(filters.group ? { groups: [filters.group] } : {}),
            hours,
            resolution: "30m",
          },
        },
        signal,
      ),
    60000,
    performance,
  );
  useEffect(() => {
    if ((draft.search ?? "") === (filters.search ?? "")) return;
    const timer = setTimeout(() => {
      setFilters((previous) => ({ ...previous, search: draft.search ?? "" }));
      setPage(1);
      setSnapshot(undefined);
      setSelected(null);
    }, 400);
    return () => clearTimeout(timer);
  }, [draft.search, filters.search]);
  useEffect(() => {
    const data = models.data?.data;
    if (data) {
      if (data.snapshot_refreshed && page > 1) {
        setPage(1);
        setSelected(null);
      }
      setSnapshot(data.snapshot_id);
    }
  }, [models.data]);
  useEffect(() => {
    if (
      (models.error as unknown as DesktopError)?.code === "snapshot_changed"
    ) {
      setSnapshot(undefined);
      setPage(1);
      setSelected(null);
    }
  }, [models.error]);
  const description = (model: DesktopPricing) => {
    try {
      const translations = JSON.parse(model.description_i18n);
      if (translations && typeof translations[i18n.language] === "string")
        return translations[i18n.language];
    } catch {
      /* Plain legacy description remains available. */
    }
    return model.description;
  };
  const priceSummary = (model: DesktopPricing) =>
    model.pricing_unavailable
      ? t("account.business.priceUnavailable")
      : model.billing_expr ||
          model.conditional_task_pricing ||
          model.task_per_second_pricing
        ? t("account.business.complexPrice")
        : t("account.business.priceFields", {
            price: model.model_price ?? "—",
            ratio: model.model_ratio ?? "—",
            completion: model.completion_ratio ?? "—",
          });
  const query = () => {
    setFilters({ ...draft });
    setSnapshot(undefined);
    setPage(1);
    setSelected(null);
  };
  return (
    <div
      className={`account-models-page ${performance ? "is-performance" : ""}`}
    >
      <form
        className="account-model-controls"
        onSubmit={(e) => {
          e.preventDefault();
          query();
        }}
      >
        <label className="account-model-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">
            {t("account.business.modelFilter.search")}
          </span>
          <input
            aria-label={t("account.business.modelFilter.search")}
            placeholder={t("account.business.modelFilter.search")}
            value={draft.search ?? ""}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                search: event.target.value,
              }))
            }
          />
        </label>
        <ModelFilters
          meta={models.data?.data.pricing_meta ?? {}}
          values={filters}
          status={performance}
          onChange={(key, value) => {
            setDraft((previous) => ({ ...previous, [key]: value }));
            setFilters((previous) => ({
              ...previous,
              [key]: value,
              search: draft.search ?? "",
            }));
            setPage(1);
            setSnapshot(undefined);
            setSelected(null);
          }}
        >
          {performance && (
            <label className="account-window-select">
              <span>{t("account.business.window")}</span>
              <select
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
              >
                {[1, 6, 24].map((h) => (
                  <option key={h} value={h}>
                    {h} h
                  </option>
                ))}
              </select>
            </label>
          )}
        </ModelFilters>
        <div className="account-inline-actions">
          {Object.values(draft).some(Boolean) && (
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setDraft({});
                setFilters({});
                setPage(1);
                setSnapshot(undefined);
              }}
            >
              清空筛选
            </Button>
          )}
          <Button type="submit" disabled={models.isFetching}>
            {t("account.workspace.query")}
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={models.isFetching || quality.isFetching}
            onClick={() => {
              void models.refetch();
              if (performance && modelNames.length) void quality.refetch();
            }}
          >
            {t("account.business.refresh")}
          </Button>
        </div>
      </form>
      <QueryState query={models} showUpdated={false} />
      {performance ? (
        <>
          <QueryState query={quality} showUpdated={false} />
          <div className="account-status-grid">
            {models.data?.data.items.map((model) => {
              const result = quality.data?.data.find(
                (item) => item.model_name === model.model_name,
              );
              return (
                <article
                  className="account-card account-status-card"
                  key={model.model_name}
                >
                  <div className="account-model-heading">
                    <ModelIcon name={model.model_name} />
                    <h3>{model.model_name}</h3>
                    {typeof model.hot_rank === "number" &&
                      model.hot_rank > 0 && (
                        <span className="account-badge">
                          热门 #{model.hot_rank}
                        </span>
                      )}
                  </div>
                  {result ? (
                    <Metrics metric={result.aggregate} hours={hours} />
                  ) : (
                    <p className="account-subtle">
                      {quality.isLoading
                        ? t("account.business.loading")
                        : "暂无状态数据"}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <div className="account-model-grid">
          {models.data?.data.items.map((model) => (
            <article
              key={model.model_name}
              className="account-card account-model-card"
            >
              <div className="account-model-heading">
                <ModelIcon name={model.model_name} />
                <h3>{model.model_name}</h3>
                <span className="account-badge">
                  {billingLabels[String(model.quota_type)] ?? "—"}
                </span>
              </div>
              <p className="account-model-description">{description(model)}</p>
              <p className="account-model-endpoints">
                {model.supported_endpoint_types.join(" · ") || "—"}
              </p>
              <p>{priceSummary(model)}</p>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(model);
                  setKeyId("");
                  setKeyPage(1);
                }}
              >
                {t("account.business.details")}
              </Button>
            </article>
          ))}
        </div>
      )}
      {models.data?.data.items.length === 0 && (
        <p className="account-empty">{t("account.workspace.noModels")}</p>
      )}
      {models.data && (
        <Pager
          page={page}
          total={models.data.data.pagination.total}
          pageSize={models.data.data.pagination.page_size}
          more={models.data.data.pagination.has_more}
          onChange={(value) => {
            setPage(value);
            setSelected(null);
          }}
        />
      )}
      {!performance && selected && (
        <AccountDialog
          drawer
          title={selected.model_name}
          footer={
            onConfigure && (
              <div className="account-model-configure">
                <QueryState query={keys} showUpdated={false} />
                <label>
                  {t("account.business.selectKey")}
                  <select
                    value={keyId}
                    onChange={(e) => setKeyId(e.target.value)}
                  >
                    <option value="">—</option>
                    {keys.data?.data.items.map((key) => (
                      <option key={key.id} value={key.id}>
                        {key.name} {key.masked_key}
                      </option>
                    ))}
                  </select>
                </label>
                {keys.data && (keyPage > 1 || keys.data.data.has_more) && (
                  <Pager
                    page={keyPage}
                    more={keys.data.data.has_more}
                    onChange={(value) => {
                      setKeyPage(value);
                      setKeyId("");
                    }}
                  />
                )}
                <Button
                  disabled={!keyId}
                  onClick={() => {
                    const key = keys.data?.data.items.find(
                      (item) => item.id === keyId,
                    );
                    if (key) {
                      onConfigure(key, selected);
                      setSelected(null);
                    }
                  }}
                >
                  {t("account.business.configure")}
                </Button>
              </div>
            )
          }
          onClose={() => setSelected(null)}
        >
          <AccountErrorBoundary key={selected.model_name}>
            <div className="account-model-detail">
              <section className="account-model-intro">
                <div className="account-model-identity">
                  <span className="account-model-icon-tile">
                    <ModelIcon name={selected.model_name} />
                  </span>
                  <div>
                    <span className="account-badge">
                      {billingLabels[String(selected.quota_type)] ??
                        selected.billing_mode ??
                        "—"}
                    </span>
                    {description(selected) && <p>{description(selected)}</p>}
                  </div>
                </div>
                {selected.tags && (
                  <div className="account-model-tags">
                    {selected.tags
                      .split(/[,，]/)
                      .filter(Boolean)
                      .map((tag) => (
                        <span className="account-badge" key={tag}>
                          {tag.trim()}
                        </span>
                      ))}
                  </div>
                )}
              </section>
              <div className="account-model-price-section">
                {selected.pricing_unavailable && (
                  <p className="account-subtle">
                    {t("account.business.priceUnavailable")}
                  </p>
                )}
                <PricingDetails
                  model={selected}
                  meta={models.data?.data.pricing_meta ?? {}}
                />
              </div>
            </div>
          </AccountErrorBoundary>
        </AccountDialog>
      )}
    </div>
  );
}
function Metrics({
  metric: m,
  hours,
}: {
  metric: Performance["aggregate"];
  hours: number | string;
}) {
  const value = (n: number | null, unit: string) =>
    n != null && Number.isFinite(n) ? `${n.toFixed(2)}${unit}` : "—";
  const { t } = useTranslation();
  return (
    <div className="account-performance-metrics">
      <p>
        {m.has_samples
          ? t("account.business.samples")
          : t("account.business.noSamples")}{" "}
        · {t("account.business.latest")}:{" "}
        {m.latest_sample_ts ? date(m.latest_sample_ts) : "—"} · {m.sample_level}
        /{m.ttft_sample_level}
      </p>
      <dl className="account-quality-values">
        {[
          [t("account.business.latency"), value(m.avg_latency_ms, " ms")],
          ["TTFT", value(m.avg_ttft_ms, " ms")],
          [t("account.business.successRate"), value(m.success_rate, "%")],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <figure className="account-timeline">
        <figcaption>最近 {hours} 小时成功率 · 每格 30 分钟</figcaption>
        <div>
          {m.half_hour_series.length === 0 && (
            <span
              className="account-no-samples"
              title={t("account.business.noSamples")}
              aria-label={t("account.business.noSamples")}
            />
          )}
          {m.half_hour_series.map((point) => (
            <span
              key={point.ts}
              tabIndex={0}
              role="img"
              aria-label={`${date(point.ts)} · ${point.has_samples ? value(point.success_rate, "%") : t("account.business.noSamples")}`}
              className={
                point.has_samples && point.success_rate != null
                  ? "has-samples"
                  : ""
              }
              style={
                point.has_samples && point.success_rate != null
                  ? {
                      opacity:
                        0.25 +
                        (Math.max(0, Math.min(100, point.success_rate)) / 100) *
                          0.75,
                    }
                  : undefined
              }
              data-tooltip={`${date(point.ts)} · ${point.has_samples ? value(point.success_rate, "%") : t("account.business.noSamples")}`}
              title={`${date(point.ts)} · ${point.has_samples ? value(point.success_rate, "%") : t("account.business.noSamples")}`}
            />
          ))}
        </div>
        <p>{t("account.visual.seriesHint")}</p>
      </figure>
    </div>
  );
}
