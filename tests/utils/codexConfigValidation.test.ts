import { expect, it } from "vitest";
import { validateCodexConfigDocument as validate } from "@/utils/codexConfigValidation";
const valid = `model_provider = "custom"
model = "synthetic-model"
[model_providers]
[model_providers.custom]
name = "Synthetic"
base_url = "https://example.invalid/v1"
`;
it("accepts an explicit parent and complete provider", () =>
  expect(validate(valid, true)).toBeNull());
it("rejects partial provider fragments", () =>
  expect(
    validate(
      valid +
        '[model_providers.custo]\nbase_url = "https://example.invalid/v1"',
      true,
    ),
  ).toContain("name"));
it("rejects malformed TOML and mismatched provider names", () => {
  expect(validate(valid + "[", true)).toContain("TOML");
  expect(
    validate(
      valid.replace('model_provider = "custom"', 'model_provider = "custo"'),
      true,
    ),
  ).toContain("对应");
});
it("rejects Markdown base URLs", () =>
  expect(
    validate(
      valid.replace(
        "https://example.invalid/v1",
        "[https://example.invalid/v1](https://example.invalid/v1)",
      ),
      true,
    ),
  ).toContain("HTTP"));
