import { FilterBar } from "./BusinessShared";
import { Button } from "@/components/ui/button";
import { type AccountState } from "@/lib/api/account";
import type {
  DesktopError,
  DesktopKey,
  DesktopPricing,
  Models,
  Page,
  Performance,
} from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { date, Field, Pager, QueryState } from "./BusinessShared";
import { PricingDetails } from "./PricingDetails";
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
  const description = (model: DesktopPricing) => {
    try {
      const translations: unknown = JSON.parse(model.description_i18n);
      if (translations && typeof translations === "object") {
        const entry = (translations as Record<string, unknown>)[i18n.language];
        if (typeof entry === "string") return entry;
      }
    } catch {
      /* Legacy descriptions may omit translations. */
    }
    return model.description;
  };
  const [page, setPage] = useState(1),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [snapshot, setSnapshot] = useState<string | undefined>(),
    [selected, setSelected] = useState<DesktopPricing | null>(null),
    [hours, setHours] = useState(24),
    [keyId, setKeyId] = useState("");
  const models = useDesktop<Models>(
    state,
    "/account/models",
    { ...filters, page, snapshot_id: page > 1 ? snapshot : undefined },
    300000,
  );
  const keys = useDesktop<Page<DesktopKey>>(
    selected && onConfigure ? state : { ...state, identity: null },
    "/account/keys",
    { page: 1, page_size: 100, status: 1 },
  );
  useEffect(() => {
    if (performance && !selected && models.data?.data.items[0])
      setSelected(models.data.data.items[0]);
  }, [performance, selected, models.data]);
  const quality = useDesktop<Performance>(
    selected ? state : { ...state, identity: null },
    "/account/model-performance",
    {
      model: selected?.model_name,
      hours,
      resolution: "30m",
      group: filters.group,
    },
    60000,
    performance,
  );
  useEffect(() => {
    const data = models.data?.data;
    if (data) {
      if (data.snapshot_refreshed && page > 1) {
        setPage(1);
        setSelected(null);
      }
      setSnapshot(data.snapshot_id);
    }
  }, [models.data, page]);
  useEffect(() => {
    if (
      (models.error as unknown as DesktopError)?.code === "snapshot_changed"
    ) {
      setSnapshot(undefined);
      setPage(1);
      setSelected(null);
    }
  }, [models.error]);
  const filter = (k: string, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setSnapshot(undefined);
    setPage(1);
    setSelected(null);
  };
  return (
    <div
      className={`account-models-page ${performance ? "is-performance" : ""}`}
    >
      <p className="account-notice">{t("account.business.accountPrices")}</p>
      <FilterBar visible={performance ? 1 : 3}>
        {[
          "search",
          "group",
          "quota_type",
          "endpoint_type",
          "vendor",
          "tag",
          "models",
        ].map((k) => (
          <Field
            key={k}
            label={t(`account.business.modelFilter.${k}`)}
            value={filters[k] ?? ""}
            onChange={(v) => filter(k, v)}
          />
        ))}
      </FilterBar>
      <QueryState query={models} />
      <div
        className={
          performance
            ? "account-model-grid account-performance-models"
            : "account-model-grid"
        }
      >
        {models.data?.data.items.map((m) => (
          <article
            key={m.model_name}
            className={`account-card account-model-card ${selected?.model_name === m.model_name ? "is-selected" : ""}`}
          >
            <div className="account-model-heading">
              <h3>{m.model_name}</h3>
              <span className="account-badge">{m.vendor_id || "—"}</span>
            </div>
            <details className="account-model-copy" open={!performance}>
              <summary>{t("account.visual.modelInfo")}</summary>
              <p>
                {description(m)} {m.tags && `· ${m.tags}`}
              </p>
              <p className="account-model-endpoints">
                {m.enable_groups.join(", ")} ·{" "}
                {m.supported_endpoint_types.join(", ")}
              </p>
              <p>
                {t("account.business.billingMode")}:{" "}
                {m.billing_mode ?? m.quota_type} ·{" "}
                {t("account.business.priceVersion")}: {m.pricing_version ?? "—"}
              </p>
              <p>
                {m.pricing_unavailable
                  ? t("account.business.priceUnavailable")
                  : m.billing_expr ||
                      m.conditional_task_pricing ||
                      m.task_per_second_pricing
                    ? t("account.business.complexPrice")
                    : t("account.business.priceFields", {
                        price: m.model_price ?? "—",
                        ratio: m.model_ratio ?? "—",
                        completion: m.completion_ratio ?? "—",
                      })}
              </p>
              {m.billing_expr && <code>{m.billing_expr}</code>}
            </details>
            <Button
              variant="outline"
              aria-pressed={selected?.model_name === m.model_name}
              onClick={() => {
                setSelected(m);
                setKeyId("");
              }}
            >
              {t("account.business.details")}
            </Button>
          </article>
        ))}
      </div>
      {models.data?.data.items.length === 0 && (
        <p className="account-empty">{t("account.business.empty")}</p>
      )}
      {models.data && (
        <Pager
          page={page}
          more={models.data.data.pagination.has_more}
          onChange={(p) => {
            setPage(p);
            setSelected(null);
          }}
        />
      )}
      {selected && (
        <section className="account-card account-model-detail">
          <header className="account-model-detail-heading">
            <h3>{selected.model_name}</h3>
            <label>
              {t("account.business.window")}
              <select
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                {[1, 6, 24].map((h) => (
                  <option key={h} value={h}>
                    {h} h
                  </option>
                ))}
              </select>
            </label>
          </header>
          <details className="account-data-details" open={!performance}>
            <summary>{t("account.business.effectivePrice")}</summary>
            <PricingDetails
              model={selected}
              meta={models.data?.data.pricing_meta ?? {}}
              group={filters.group}
            />
          </details>
          <QueryState query={quality} />
          {quality.data && (
            <>
              <Metrics metric={quality.data.data.aggregate} />
              {quality.data.data.groups.map((g) => (
                <div className="account-performance-group" key={g.group}>
                  <h4>{g.group}</h4>
                  <Metrics metric={g} />
                </div>
              ))}
            </>
          )}
          {onConfigure && (
            <>
              <QueryState query={keys} />
              <label>
                {t("account.business.selectKey")}
                <select
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                >
                  <option value="">—</option>
                  {keys.data?.data.items.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} {k.masked_key}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!keyId}
                onClick={() => {
                  const k = keys.data?.data.items.find((k) => k.id === keyId);
                  if (k) onConfigure(k, selected);
                }}
              >
                {t("account.business.configure")}
              </Button>
            </>
          )}
          <Button onClick={() => setSelected(null)}>
            {t("account.business.close")}
          </Button>
        </section>
      )}
    </div>
  );
}
function Metrics({ metric: m }: { metric: Performance["aggregate"] }) {
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
      <p className="account-quality-values">
        {t("account.business.latency")} {m.avg_latency_ms ?? "—"} ms · TTFT{" "}
        {m.avg_ttft_ms ?? "—"} ms · {m.avg_tps ?? "—"} token/s ·{" "}
        {t("account.business.successRate")} {m.success_rate ?? "—"}%
      </p>
      <figure className="account-timeline">
        <figcaption>{t("account.visual.series")}</figcaption>
        <div>
          {m.half_hour_series.map((point) => (
            <span
              key={point.ts}
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
              title={`${date(point.ts)} · ${point.has_samples ? `${point.success_rate ?? "—"}%` : t("account.business.noSamples")}`}
            />
          ))}
        </div>
        <p>{t("account.visual.seriesHint")}</p>
      </figure>
      <details className="account-data-details">
        <summary>{t("account.visual.details")}</summary>
        <h4>{t("account.business.historical")}</h4>
        <dl>
          {Object.entries(m.historical_values ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {typeof value === "number" && key.includes("timestamp")
                  ? date(value)
                  : typeof value === "object" && value
                    ? `${value.value} (${date(value.ts)})`
                    : String(value ?? "—")}
              </dd>
            </div>
          ))}
        </dl>
        <h4>{t("account.visual.series")}</h4>
        <div className="account-table-scroll">
          <table>
            <thead>
              <tr>
                {["time", "latency", "ttft", "throughput", "successRate"].map(
                  (key) => (
                    <th key={key}>{t(`account.visual.${key}`)}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {m.half_hour_series.map((p) => (
                <tr key={p.ts}>
                  <td>{date(p.ts)}</td>
                  <td>{p.avg_latency_ms ?? "—"} ms</td>
                  <td>{p.avg_ttft_ms ?? "—"} ms</td>
                  <td>{p.avg_tps ?? "—"} token/s</td>
                  <td>{p.success_rate ?? "—"}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
