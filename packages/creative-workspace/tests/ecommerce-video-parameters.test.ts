import { describe, expect, it } from "vitest";
import {
  ecommerceVideoParameters,
  ecommerceViduInput,
} from "../src/ecommerce-video-parameters";

describe("ecommerce Vidu capabilities", () => {
  it("derives Turbo duration bounds from the actual mode and image count", () => {
    expect(
      ecommerceViduInput("viduq3-turbo", {}, 3).durations?.map((o) => o.value),
    ).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 3)));
    expect(
      ecommerceViduInput("viduq3-turbo", { vidu_action: "textGenerate" }, 0)
        .durations,
    ).toHaveLength(16);
  });
  it("requires Q4 references and accepts fifteen; Pro does not accept three", () => {
    expect(ecommerceViduInput("viduq4-preview", {}, 0).error).not.toBe("");
    expect(ecommerceViduInput("viduq4-preview", {}, 15).error).toBe("");
    expect(ecommerceViduInput("viduq3-pro", {}, 3).error).not.toBe("");
  });
  it("only exposes reference audio on Mix and validates count and public URLs", () => {
    expect(
      ecommerceVideoParameters("viduq3").some(
        (p) => p.id === "vidu_sound_urls",
      ),
    ).toBe(false);
    expect(
      ecommerceVideoParameters("viduq3-mix").some(
        (p) => p.id === "vidu_sound_urls",
      ),
    ).toBe(true);
    expect(
      ecommerceViduInput(
        "viduq3-mix",
        { vidu_sound_urls: "http://127.0.0.1/audio.mp3" },
        1,
      ).error,
    ).toContain("公开访问");
    expect(
      ecommerceViduInput(
        "viduq3-mix",
        {
          vidu_sound_urls: Array(4)
            .fill("https://example.com/a.mp3")
            .join("\n"),
        },
        1,
      ).error,
    ).toContain("最多");
  });
});
