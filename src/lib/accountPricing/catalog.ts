import type { DesktopPricing } from "@/lib/api/desktop";
export type Price = { label: string; amount: number; unit: string };
const number = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
/** Public catalog conversion only; account discounts and group overrides are not applied. */
export function catalogPrices(model: DesktopPricing): Price[] {
  if (
    model.pricing_unavailable ||
    model.billing_mode === "tiered_expr" ||
    model.billing_expr
  )
    return [];
  const rows: Price[] = [];
  const add = (label: string, amount: unknown, unit = "/ 1M tokens") => {
    const value = number(amount);
    if (value !== null) rows.push({ label, amount: value, unit });
  };
  if (model.quota_type === 0) {
    add("按次调用", model.model_price, "/ 次");
    return rows;
  }
  if (model.quota_type === 2) {
    add(
      "按秒计费",
      model.model_second_price ?? model.second_price ?? model.model_price,
      "/ 秒",
    );
    return rows;
  }
  const ratio = number(model.model_ratio);
  const input = ratio === null ? null : ratio * 2;
  add("推理输入", input);
  for (const [label, price, field] of [
    ["推理输出", "completion_price", "completion_ratio"],
    ["缓存命中", "cache_price", "cache_ratio"],
    ["缓存创建", "create_cache_price", "create_cache_ratio"],
    ["缓存创建 · 5 分钟", "create_cache_price_5m", "create_cache_ratio_5m"],
    ["缓存创建 · 1 小时", "create_cache_price_1h", "create_cache_ratio_1h"],
  ]) {
    const multiplier = number(model[field]);
    add(
      label,
      number(model[price]) ??
        (input !== null && multiplier !== null ? input * multiplier : null),
    );
  }
  return rows;
}
