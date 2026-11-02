import { describe, expect, it } from "vitest";
import { catalogPrices } from "@/lib/accountPricing/catalog";
import { priceTiers } from "@/lib/accountPricing/tiers";
import type { DesktopPricing } from "@/lib/api/desktop";
describe("public catalog display", () => {
  it("converts token ratios without account multipliers and preserves zero", () => {
    const model = {
      quota_type: 1,
      model_ratio: 0.5,
      completion_ratio: 5,
      cache_ratio: 0,
      multiplier: 999,
    } as unknown as DesktopPricing;
    expect(catalogPrices(model).map((p) => p.amount)).toEqual([1, 5, 0]);
  });
  it("projects versioned linear tiers with token unit conversion", () => {
    const result = priceTiers(
      'v2:p <= 272000 ? tier("0–272k", (p + c * 5 + cr * 0.05) / 1000000) : tier("272k+", (p * 2 + c * 10) / 1000000)',
    );
    expect(result.map((t) => t.label)).toEqual(["0–272k", "272k+"]);
    expect(result[0].prices.map((p) => p.amount)).toEqual([
      1, 5, 0.049999999999999996,
    ]);
    expect(
      priceTiers('tier("base", p * 2 + c * 8)')[0].prices.map((p) => p.amount),
    ).toEqual([2, 8]);
  });
  it("does not misrepresent unsupported or malformed billing expressions", () => {
    for (const expr of [
      'tier("x", p*c)',
      'tier("x", p/0)',
      '2*tier("x",p)',
      'priceScale(tier("x",p),2)',
      'v3:tier("x",p)',
      'tier("x",unknown)',
      'tier("x", p',
    ])
      expect(priceTiers(expr)).toEqual([]);
  });
});
