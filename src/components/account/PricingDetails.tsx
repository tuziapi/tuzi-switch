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
export function PricingDetails({
  model,
  meta,
  group,
}: {
  model: DesktopPricing;
  meta: Record<string, unknown>;
  group?: string;
}) {
  const { t } = useTranslation();
  const effective =
    group ||
    String(meta.default_effective_group ?? meta.pricing_reference_group ?? "");
  const personal = object(object(meta.user_model_pricing)[effective]);
  const override = object(personal[model.model_name]);
  const groups = object(object(meta.group_model_pricing)[effective]);
  return (
    <section className="account-pricing">
      <h4>
        {t("account.business.effectivePrice")} · {effective || "—"}
      </h4>
      <p>{t("account.business.priceUnits")}</p>
      <dl>
        {fields
          .filter((f) => f in model || f in override)
          .map((f) => (
            <div key={f}>
              <dt>{f}</dt>
              <dd>{String((f in override ? override[f] : model[f]) ?? "—")}</dd>
            </div>
          ))}
        {[
          "group_ratio",
          "base_group_ratio",
          "system_group_ratio",
          "user_group_multiplier",
          "group_discount_ratio",
          "group_discount_source",
        ].map((f) => (
          <div key={f}>
            <dt>{f}</dt>
            <dd>{String(object(meta[f])[effective] ?? "—")}</dd>
          </div>
        ))}
        <div>
          <dt>user_model_discount_ratio</dt>
          <dd>
            {String(
              object(object(meta.user_model_discount_ratio)[effective])[
                model.model_name
              ] ?? "—",
            )}
          </dd>
        </div>
        {Object.entries(groups).map(([f, map]) => (
          <div key={f}>
            <dt>{f}</dt>
            <dd>{String(object(map)[model.model_name] ?? "—")}</dd>
          </div>
        ))}
      </dl>
      {typeof override.billing_expr === "string" && (
        <p>
          {t("account.business.complexPrice")}{" "}
          <code>{override.billing_expr}</code>
        </p>
      )}
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
