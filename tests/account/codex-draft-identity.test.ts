import { it, expect } from "vitest";
import { parse } from "smol-toml";
import { tuziCreationPrefill } from "@/components/providers/TuziProviderDialog";
it("gives new account drafts independent routes and credentials before editing", () => {
  const draft = {
    appId: "codex",
    protocol: "responses",
    key: "SYNTHETIC_KEY",
    tokenId: "17",
    userId: "20",
    generation: 1,
    model: "synthetic",
  } as const;
  const first = parse(
    String(tuziCreationPrefill(draft)?.settingsConfig?.config),
  );
  const second = parse(
    String(
      tuziCreationPrefill({ ...draft, tokenId: "18" })?.settingsConfig?.config,
    ),
  );
  expect(first.model_provider).not.toBe(second.model_provider);
  const table = (doc: typeof first) =>
    (doc.model_providers as Record<string, Record<string, unknown>>)[
      String(doc.model_provider)
    ];
  expect(table(first).env_key).not.toBe(table(second).env_key);
  expect(table(first).name).toBe("兔子线路");
});
