import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ECOMMERCE_PREFERENCES_KEY,
  readEcommercePreferences,
  saveEcommercePreferences,
} from "../src/ecommerce-preferences";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("ecommerce editor preferences", () => {
  it("round-trips the selected provider and empty quick selections without copying credentials", () => {
    const value = {
      selectedModels: {
        image: '["synthetic-profile","image"]',
        video: "MiniMax-H3",
      },
      prompt: "Synthetic brief",
      quickSelections: { "product-set": [] },
      videoDuration: "5",
      videoSize: "768P",
      videoRatio: "9:16",
    };
    saveEcommercePreferences({
      ...value,
      apiKey: "synthetic-do-not-store",
      files: ["synthetic-file"],
    } as any);
    expect(readEcommercePreferences()).toEqual(value);
    expect(localStorage.getItem(ECOMMERCE_PREFERENCES_KEY)).not.toContain(
      "synthetic-do-not-store",
    );
    expect(localStorage.getItem(ECOMMERCE_PREFERENCES_KEY)).not.toContain(
      "synthetic-file",
    );
  });
  it.each(["{", "null", "[]", '{"version":2}', "x".repeat(65_000)])(
    "ignores corrupt or future preferences",
    (raw) => {
      localStorage.setItem(ECOMMERCE_PREFERENCES_KEY, raw);
      expect(readEcommercePreferences()).toEqual({});
    },
  );
  it("ignores malformed fields and retains independent valid fields", () => {
    localStorage.setItem(
      ECOMMERCE_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        selectedModels: { image: null, video: 12 },
        prompt: "Keep this",
        videoRatio: "adaptive",
        videoDuration: {},
        quickSelections: { "product-set": [null], "detail-page": ["hero"] },
      }),
    );
    expect(readEcommercePreferences()).toEqual({
      prompt: "Keep this",
      quickSelections: { "detail-page": ["hero"] },
    });
  });
  it("continues when storage reads/writes are unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readEcommercePreferences()).toEqual({});
    expect(() =>
      saveEcommercePreferences({
        selectedModels: { image: "", video: "" },
        prompt: "",
        quickSelections: {},
        videoDuration: "",
        videoSize: "",
        videoRatio: "16:9",
      }),
    ).not.toThrow();
  });
});
