import { groupPrices } from "@/lib/accountPricing/groups";
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
  it.each([
    { conditional_task_pricing: { no_video_price: 1, video_price: 2 } },
    { conditional_task_pricing_details: { rule_identifier: "synthetic" } },
    {
      task_per_second_pricing: {
        variants: [{ unit_price: 1 }, { unit_price: 2 }],
      },
    },
    {
      per_call_variants: [
        { label: "base", price: 1 },
        { label: "large", price: 2 },
      ],
    },
  ])(
    "does not flatten task variants into one catalog price: %j",
    (metadata) => {
      expect(
        catalogPrices({
          quota_type: 0,
          model_price: 1,
          ...metadata,
        } as unknown as DesktopPricing),
      ).toEqual([]);
    },
  );
});

describe("group catalog pricing", () => {
  const model = {
    model_name: "synthetic",
    quota_type: 1,
    model_ratio: 1,
    completion_ratio: 3,
    enable_groups: ["all"],
    pricing_unavailable: false,
  } as DesktopPricing;
  it("shows visible supported groups and applies distinct base ratios, ignoring personal discounts", () => {
    const rows = groupPrices(model, {
      usable_group: { default: "默认", Codex: "Codex", auto: "自动" },
      base_group_ratio: { default: 1, Codex: 0.8 },
      group_ratio: { default: 0.5, Codex: 0.4 },
      user_group_multiplier: { Codex: 0.1 },
    });
    expect(rows.map((r) => [r.group, r.tiers[0].prices[0].amount])).toEqual([
      ["default", 2],
      ["Codex", 1.6],
    ]);
    expect(
      groupPrices(
        { ...model, enable_groups: ["Codex"] },
        { usable_group: { default: "默认", Codex: "Codex" } },
      ).map((r) => r.group),
    ).toEqual(["Codex"]);
  });
  it("applies final group plans once and replaces rather than multiplies group ratios", () => {
    const rows = groupPrices(model, {
      usable_group: { final: "最终价格", multiple: "倍率" },
      base_group_ratio: { final: 7, multiple: 7 },
      group_model_pricing: {
        final: {
          quota_type: { synthetic: 1 },
          model_ratio: { synthetic: 0.25 },
          model_completion_ratio: { synthetic: 2 },
          pricing_semantics: { synthetic: "final_v1" },
        },
        multiple: { model_multiplier: { synthetic: 0.8 } },
      },
    });
    expect(rows[0].tiers[0].prices.map((p) => p.amount)).toEqual([0.5, 1]);
    expect(rows[1].tiers[0].prices[0].amount).toBe(1.6);
  });
  it("resolves virtual default and supports group expressions and free per-call prices", () => {
    const rows = groupPrices(model, {
      usable_group: { default: "默认", free: "免费" },
      default_resolution: { synthetic: { effective_group: "actual" } },
      group_model_pricing: {
        actual: {
          billing_expr: { synthetic: 'v2:tier("基础", (p + c * 5) / 1000000)' },
        },
        free: {
          quota_type: { synthetic: 0 },
          model_price: { synthetic: 0 },
          pricing_semantics: { synthetic: "final_v1" },
        },
      },
    });
    expect(rows[0].tiers[0].prices.map((p) => p.amount)).toEqual([1, 5]);
    expect(rows[1].tiers[0].prices[0].amount).toBe(0);
  });
  it("does not merge incomplete overrides or fabricate invalid multiplier prices", () => {
    const rows = groupPrices(model, {
      usable_group: { partial: "Partial", bad: "Bad" },
      base_group_ratio: { partial: 1 },
      group_model_pricing: {
        partial: { model_completion_ratio: { synthetic: 99 } },
        bad: { model_multiplier: { synthetic: null } },
      },
    });
    expect(rows[0].tiers[0].prices.map((p) => p.amount)).toEqual([2, 6]);
    expect(rows[1].tiers).toEqual([]);
  });
  it("only replaces public task variants when a complete group override owns the price", () => {
    const rows = groupPrices(
      {
        ...model,
        quota_type: 0,
        model_price: 1,
        per_call_variants: [
          { label: "base", price: 1 },
          { label: "large", price: 2 },
        ],
      },
      {
        usable_group: {
          final: "Final",
          fallback: "Fallback",
          multiple: "Multiple",
        },
        base_group_ratio: { final: 7, fallback: 1, multiple: 1 },
        group_model_pricing: {
          final: {
            quota_type: { synthetic: 0 },
            model_price: { synthetic: 3 },
            pricing_semantics: { synthetic: "final_v1" },
          },
          fallback: {
            quota_type: { synthetic: 0 },
            model_price: { synthetic: 1 },
            pricing_source: { synthetic: "global_fallback" },
          },
          multiple: { model_multiplier: { synthetic: 0.8 } },
        },
      },
    );
    expect(rows[0].tiers[0].prices[0].amount).toBe(3);
    expect(rows[1].tiers.flatMap((tier) => tier.prices)).toEqual([]);
    expect(rows[2].tiers.flatMap((tier) => tier.prices)).toEqual([]);
  });
});
