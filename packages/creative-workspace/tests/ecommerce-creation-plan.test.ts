import { describe, expect, it } from "vitest";
import {
  ecommerceImageParameters,
  resolveEcommerceImageParameters,
  ecommercePlatformGuidance,
  referenceRolePrompt,
} from "../src/ecommerce-creation-plan";
import { planEcommerceImages } from "../src/ecommerce-jobs";

describe("ecommerce B creation plan", () => {
  const base = {
    tool: "viral-replicate",
    structure: "smart",
    labels: ["复刻爆款构图", "复刻光影风格", "强化商品卖点"],
    apparelTypes: [],
    counts: {},
    prompt: "synthetic product",
  };
  it("combines requirements without multiplying count and expands separate outputs exactly", () => {
    expect(
      planEcommerceImages({ ...base, outputMode: "combined", outputCount: 2 }),
    ).toHaveLength(2);
    const separate = planEcommerceImages({
      ...base,
      outputMode: "separate",
      perOutputCounts: { 复刻光影风格: 2 },
    });
    expect(separate.map((i) => i.label)).toEqual([
      "复刻爆款构图",
      "复刻光影风格 · 方案 1",
      "复刻光影风格 · 方案 2",
      "强化商品卖点",
    ]);
  });
  it("never multiplies expanded custom counts by global variants", () => {
    expect(
      planEcommerceImages({
        ...base,
        tool: "product-set",
        structure: "custom",
        counts: { scene: 3 },
        outputCount: 4,
      }),
    ).toHaveLength(3);
  });
  it("plans apparel types and clamps corrupt variant counts", () => {
    expect(
      planEcommerceImages({
        ...base,
        tool: "apparel-set",
        apparelTypes: ["人台图", "细节特写图"],
        perOutputCounts: { 人台图: 2 },
      }),
    ).toHaveLength(3);
    expect(
      planEcommerceImages({ ...base, outputCount: Number.NaN }),
    ).toHaveLength(1);
    expect(planEcommerceImages({ ...base, outputCount: 999 })).toHaveLength(4);
  });
  it("keeps platform and old variation toggles out of separate paid outputs", () => {
    expect(
      planEcommerceImages({
        ...base,
        outputMode: "separate",
        labels: [...base.labels, "平台规范适配", "生成多种变体"],
      }),
    ).toHaveLength(3);
  });
  it("uses each canvas model's actual options and drops incompatible values", () => {
    const gpt = ecommerceImageParameters("gpt-image-2.5");
    expect(
      gpt
        .find((p) => p.id === "quality")
        ?.options?.some((o) => o.value === "xhigh"),
    ).toBe(true);
    const gemini = resolveEcommerceImageParameters(
      "gemini-3.1-flash-image-preview",
      { quality: "xhigh", background: "transparent", resolution: "4k" },
      "google.generateContent",
    );
    expect(gemini.quality).toBe("1k");
    expect(gemini).not.toHaveProperty("background");
    expect(gemini).not.toHaveProperty("resolution");
    expect(
      resolveEcommerceImageParameters(
        "gemini-3.1-flash-image-preview",
        { quality: "4k" },
        "google.generateContent",
      ).quality,
    ).toBe("4k");
  });
  it("does not advertise unsupported controls for async and unknown bindings", () => {
    expect(
      ecommerceImageParameters("gpt-image-2.5", "openai.async.media").map(
        (p) => p.id,
      ),
    ).toEqual(["size"]);
    expect(ecommerceImageParameters("synthetic-unknown")).toEqual([]);
  });
  it("differentiates main image, marketing and wholesale briefs", () => {
    expect(ecommercePlatformGuidance("亚马逊", "main").opaque).toBe(true);
    expect(ecommercePlatformGuidance("亚马逊", "marketing").opaque).toBe(false);
    expect(ecommercePlatformGuidance("TikTok Shop", "marketing").ratio).toBe(
      "9:16",
    );
    expect(ecommercePlatformGuidance("1688", "gallery").prompt).toContain(
      "不虚构起订量",
    );
  });
  it("assigns positional roles without copying a reference product or watermark", () => {
    const roles = referenceRolePrompt(2, 1);
    expect(roles).toContain("第1至2张为商品原图");
    expect(roles).toContain("第3至3张为风格参考图");
    expect(roles).toContain("不得将参考图中的商品");
    expect(referenceRolePrompt(1, 1, true)).toContain("人物身份");
  });
});
