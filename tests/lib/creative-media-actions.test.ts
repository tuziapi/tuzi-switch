import { describe, expect, it } from "vitest";
import actions from "@/features/creative/mediaActions.json";
import { selectCreativeMediaAction } from "@/features/creative/mediaActions";

const select = (path: string, method = "GET") =>
  selectCreativeMediaAction(new URL(path, "https://api.tu-zi.com"), method);
describe("finite creative media route contract", () => {
  it.each(actions)(
    "maps $action without forwarding arbitrary URLs",
    (entry) => {
      const path = entry.path.replace("{taskId}", "synthetic-task_1");
      expect(select(path, entry.method)).toEqual({
        action: entry.action,
        ...(entry.path.includes("{taskId}")
          ? { taskId: "synthetic-task_1" }
          : {}),
      });
      expect(
        select(path, entry.method === "GET" ? "POST" : "GET"),
      ).toBeUndefined();
    },
  );
  it.each([
    "/v2/query/video_generation/%2e%2e%2fprivate",
    "/v2/query/video_generation/one/two",
    "/suno/api/v1/generate/record-info?taskId=..",
    "/suno/api/v1/generate/record-info?taskId=one&taskId=two",
    "/suno/api/v1/generate/record-info?taskId=one&url=https://example.invalid",
    "/suno/api/v1/generate/record-info",
  ])("rejects unsafe identifiers and query arguments: %s", (path) => {
    expect(() => select(path)).toThrow();
  });
  it("keeps unsupported routes closed and tracking separate from task identifiers", () => {
    expect(select("/suno/api/admin/delete", "POST")).toBeUndefined();
    expect(select("/suno/v2/create-voice", "POST")).toBeUndefined();
    expect(select("/v2/video_generation?tuzi_client=desktop", "POST")).toEqual({
      action: "minimax.create",
    });
    expect(new Set(actions.map((a) => a.action)).size).toBe(actions.length);
    expect(new Set(actions.map((a) => `${a.method} ${a.path}`)).size).toBe(
      actions.length,
    );
  });
});
