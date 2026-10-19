import { describe, expect, it } from "vitest";
import { resolveCodexFormEnvKey } from "@/utils/codexFormEnvKey";

describe("hidden Codex environment reference allocation", () => {
  it("preserves an existing reference even when another provider shares it", () => {
    expect(
      resolveCodexFormEnvKey({
        existingEnvKey: "LEGACY_KEY",
        candidate: "NEW_KEY",
        official: false,
        providers: {
          other: { settingsConfig: { env: { envKey: "LEGACY_KEY" } } },
        },
        shellEnvKeys: { LEGACY_KEY: "SYNTHETIC" },
      }),
    ).toBe("LEGACY_KEY");
  });
  it.each(["", "invalid-key", "9INVALID"])(
    "allocates missing/invalid new names: %s",
    (candidate) => {
      expect(
        resolveCodexFormEnvKey({
          candidate,
          official: false,
          providers: {
            p: { settingsConfig: { env: { envKey: "CUSTOM_CODEX_API_KEY" } } },
          },
          shellEnvKeys: { CUSTOM_CODEX_API_KEY_1: "SYNTHETIC" },
        }),
      ).toBe("CUSTOM_CODEX_API_KEY_2");
    },
  );
  it("skips occupied numbered references from both providers and local environment", () => {
    expect(
      resolveCodexFormEnvKey({
        candidate: "TUZI01_CODEX_API_KEY",
        official: false,
        providers: {
          p: { settingsConfig: { env: { envKey: "TUZI01_CODEX_API_KEY" } } },
        },
        shellEnvKeys: { TUZI02_CODEX_API_KEY: "SYNTHETIC" },
      }),
    ).toBe("TUZI03_CODEX_API_KEY");
  });
  it("does not require an environment variable for official OAuth", () => {
    expect(resolveCodexFormEnvKey({ candidate: "", official: true })).toBe("");
  });
});
