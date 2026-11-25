import { describe, expect, it } from "vitest";
import { matchesEcommerceModelType } from "../src/ecommerce-model-capabilities";

describe("ecommerce model media types", () => {
  it("excludes known image models from video choices even if a catalog declares video endpoints", () => {
    for (const id of [
      "gpt-image-2",
      "gpt-image-2.6",
      "gpt-image-2.6-1k",
      "nano-banana-2-2k",
    ])
      expect(matchesEcommerceModelType(id, "video"), id).toBe(false);
    expect(matchesEcommerceModelType("gpt-image-2", "image")).toBe(true);
  });
  it("retains configured custom IDs and actual video models", () => {
    expect(matchesEcommerceModelType("my-custom-video", "video")).toBe(true);
    expect(matchesEcommerceModelType("MiniMax-H3", "video")).toBe(true);
    expect(
      matchesEcommerceModelType("doubao-seedance-2-5-260628", "video"),
    ).toBe(true);
    expect(matchesEcommerceModelType(null, "video")).toBe(false);
  });
});
