import { expect, it } from "vitest";
import { getCompatibleParams } from "../upstream/packages/drawnix/src/constants/model-config";
import { buildMJPrompt } from "../upstream/packages/drawnix/src/utils/mj-params";

it("exposes MJ 8.2 and replaces an existing version flag exactly once", () => {
  expect(
    getCompatibleParams("mj-imagine").find((p) => p.id === "mj_v")?.options,
  ).toContainEqual({ value: "8.2", label: "V8.2" });
  expect(buildMJPrompt("synthetic product --v 7", { mj_v: "8.2" })).toBe(
    "synthetic product --v 8.2",
  );
});
