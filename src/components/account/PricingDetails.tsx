import { useTranslation } from "react-i18next";
import type { DesktopPricing } from "@/lib/api/desktop";
const fields = [
  "model_price",
  "completion_price",
  "second_price",
  "multiplier",
  "cache_price",
  "create_cache_price",
  "create_cache_price_5m",
  "create_cache_price_1h",
  "image_price",
  "image_cache_price",
  "image_output_price",
  "audio_price",
  "audio_cache_price",
  "audio_completion_price",
  "web_search_price",
  "model_ratio",
  "completion_ratio",
  "cache_ratio",
  "create_cache_ratio",
  "create_cache_ratio_5m",
  "create_cache_ratio_1h",
  "image_ratio",
  "image_cache_ratio",
  "image_output_ratio",
  "audio_ratio",
  "audio_cache_ratio",
  "audio_completion_ratio",
];
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
/** Display catalog prices verbatim; do not merge account/group overrides here. */
export function PricingDetails({ model }: { model: DesktopPricing }) {
  const { t } = useTranslation();
  return (
    <section className="account-pricing">
      <h4>{t("account.business.catalogPrices")}</h4>
      <p>{t("account.business.priceUnits")}</p>
      <dl>
        {fields
          .filter((f) => model[f] != null)
          .map((f) => (
            <div key={f}>
              <dt title={f}>
                {t(`account.priceLabels.${f}`, { defaultValue: f })}
              </dt>
              <dd>{String(model[f])}</dd>
            </div>
          ))}
      </dl>
      {[
        "conditional_task_pricing",
        "conditional_task_pricing_details",
        "task_per_second_pricing",
        "per_call_variants",
      ].map((f) =>
        model[f] ? (
          <div key={f}>
            <h5>{f}</h5>
            <pre className="whitespace-pre-wrap break-all">
              {JSON.stringify(model[f], null, 2)}
            </pre>
          </div>
        ) : null,
      )}
      <dl>
        {Object.entries(model.endpoints ?? {}).map(([name, v]) => {
          const endpoint = object(v);
          return (
            <div key={name}>
              <dt>{name}</dt>
              <dd>
                {String(endpoint.method ?? "")} {String(endpoint.path ?? "")} ·{" "}
                {String(endpoint.label ?? "")} ·{" "}
                {String(endpoint.description ?? "")}
              </dd>
            </div>
          );
        })}
      </dl>
      {model.related_pricing.map((m) => (
        <p key={m.model_name}>
          {t("account.business.relatedPrice")} {m.model_name} ·{" "}
          {m.billing_mode ?? "—"} · {m.model_price ?? "—"} ·{" "}
          {m.billing_expr ?? ""}
        </p>
      ))}
    </section>
  );
}
