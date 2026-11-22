import { describe, expect, it } from "vitest";
import {
  DETAIL_PAGE_MODULES,
  ECOMMERCE_LANGUAGES,
  ECOMMERCE_PLATFORMS,
  ECOMMERCE_RATIOS,
  normalizeEcommerceModuleCounts,
} from "../src/EcommerceWorkbench";

describe("ecommerce workbench PixPix-aligned configuration", () => {
  it("exposes the complete platform, language and ratio catalog", () => {
    expect(ECOMMERCE_PLATFORMS).toContain("TikTok Shop");
    expect(ECOMMERCE_PLATFORMS).toContain("eBay");
    expect(ECOMMERCE_LANGUAGES).toEqual(
      expect.arrayContaining(["英文", "中文", "日文", "韩文", "西班牙文"]),
    );
    expect(ECOMMERCE_RATIOS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a-plus-web", size: "1472x608" }),
        expect.objectContaining({ id: "1:1", size: "1024x1024" }),
        expect.objectContaining({ id: "9:16", size: "864x1536" }),
      ]),
    );
  });

  it("keeps the mandatory A+ hero module and the newly added content modules", () => {
    expect(DETAIL_PAGE_MODULES.find((module) => module.id === "hero")?.required).toBe(true);
    expect(DETAIL_PAGE_MODULES.map((module) => module.id)).toEqual(
      expect.arrayContaining(["ingredient", "usage", "after-sale"]),
    );
  });

  it("clamps custom product-set counts to the supported range", () => {
    expect(
      normalizeEcommerceModuleCounts({
        whiteBackground: -2,
        scene: 4,
        sellingPoint: 99,
        other: Number.NaN,
      }),
    ).toEqual({
      whiteBackground: 0,
      scene: 4,
      sellingPoint: 12,
      other: 0,
    });
  });
});
