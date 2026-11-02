import type { DesktopPricing } from "@/lib/api/desktop";
import { catalogPrices, type Price } from "./catalog";
import { priceTiers } from "./tiers";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const numeric = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export interface GroupPrices {
  group: string;
  label: string;
  tiers: { label: string; prices: Price[] }[];
}
/** Group catalog plans only. Personal contracts/discounts are deliberately not merged. */
export function groupPrices(
  model: DesktopPricing,
  meta: Record<string, unknown>,
): GroupPrices[] {
  const usable = object(meta.usable_group),
    info = object(meta.all_level_group_info);
  const visible = Object.keys(usable);
  const enabled = model.enable_groups;
  const groups = (
    visible.length
      ? visible.filter((g) => enabled.includes("all") || enabled.includes(g))
      : enabled
  ).filter((g) => g !== "all" && g !== "auto");
  const plans = object(meta.group_model_pricing);
  const baseRatios = object(meta.base_group_ratio);
  const ratios = Object.keys(baseRatios).length
    ? baseRatios
    : object(meta.group_ratio);
  return [...new Set(groups)].map((group) => {
    const name = model.model_name;
    const resolution = object(object(meta.default_resolution)[name]);
    const alias =
      resolution.effective_group ??
      object(object(plans.default).effective_group)[name];
    const effective =
      group === "default" && typeof alias === "string" ? alias : group;
    const plan = object(plans[effective] ?? plans[group]);
    const get = (field: string) => object(plan[field])[name];
    let record = { ...model };
    let multiplier = numeric(ratios[effective] ?? ratios[group]);
    const type = get("quota_type");
    const expression = get("billing_expr");
    const perCall = get("model_price"),
      perSecond = get("model_second_price"),
      ratio = get("model_ratio");
    const complete =
      (typeof expression === "string" && expression.length > 0) ||
      (type === 0 && numeric(perCall) !== null) ||
      (type === 1 && numeric(ratio) !== null) ||
      (type === 2 && numeric(perSecond) !== null) ||
      (type === undefined &&
        [perCall, perSecond, ratio].some((v) => numeric(v) !== null));
    if (
      get("pricing_source") === "group_multiplier" ||
      get("model_multiplier") !== undefined
    ) {
      multiplier = numeric(get("model_multiplier"));
    } else if (complete) {
      record.pricing_unavailable = false;
      record.billing_expr = null;
      record.billing_mode = null;
      const source = get("pricing_source") ?? "group_override";
      // A complete group plan replaces public task variants; fallback and
      // multiplier plans inherit them and must not become a flat price.
      if (source === "group_override") {
        record.conditional_task_pricing = undefined;
        record.conditional_task_pricing_details = undefined;
        record.task_per_second_pricing = undefined;
        record.per_call_variants = undefined;
      }
      if (typeof expression === "string" && expression.length > 0) {
        record.billing_expr = expression;
        record.billing_mode = "tiered_expr";
      } else {
        record.quota_type =
          typeof type === "number"
            ? type
            : perCall !== undefined
              ? 0
              : perSecond !== undefined
                ? 2
                : 1;
        if (record.quota_type === 0) record.model_price = numeric(perCall);
        if (record.quota_type === 2) {
          record.model_second_price = perSecond;
          record.model_price = numeric(perSecond);
        }
        if (record.quota_type === 1) record.model_ratio = numeric(ratio);
        for (const field of [
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
        ]) {
          if (get(`model_${field}`) !== undefined)
            record[field] = get(`model_${field}`);
        }
      }
      if (
        (get("pricing_semantics") === "final_v1" &&
          source !== "global_fallback") ||
        (record.billing_expr && source === "group_override")
      )
        multiplier = 1;
    }
    // Legacy responses without ratio metadata have the website's unit fallback.
    if (
      multiplier === null &&
      Object.keys(ratios).length === 0 &&
      get("model_multiplier") === undefined &&
      get("pricing_source") !== "group_multiplier"
    )
      multiplier = 1;
    const tiers =
      record.pricing_unavailable || multiplier === null
        ? []
        : record.billing_expr
          ? priceTiers(record.billing_expr)
          : [{ label: "模型定价", prices: catalogPrices(record) }];
    return {
      group,
      label: String(object(info[group]).DisplayName || usable[group] || group),
      tiers: tiers.map((tier) => ({
        ...tier,
        prices: tier.prices
          .map((p) => ({ ...p, amount: p.amount * multiplier! }))
          .filter((p) => Number.isFinite(p.amount)),
      })),
    };
  });
}
