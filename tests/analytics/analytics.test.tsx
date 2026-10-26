import { StrictMode, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginOperation,
  trackInteraction,
  trackOperation,
} from "@/lib/analytics";
import { useAnalyticsView } from "@/hooks/useAnalyticsView";

const track = vi.fn();
beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "synthetic-version");
  vi.stubGlobal("umami", { track });
  track.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("analytics boundary", () => {
  it("whitelists categories and never forwards business fields or raw errors", async () => {
    const synthetic = {
      tool: "codex",
      page: "providers",
      token: "synthetic-secret",
      name: "synthetic-name",
      endpoint: "https://synthetic.invalid/private",
      path: "/synthetic/private",
    };
    const error = {
      code: "forbidden",
      message: "synthetic-secret",
      outcomeUnknown: true,
    };
    await expect(
      trackOperation("providers", "edit", synthetic, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(track.mock.calls).toEqual([
      [
        "编辑供应商",
        {
          version: "synthetic-version",
          environment: "development",
          module: "providers",
          action: "edit",
          stage: "submit",
          tool: "codex",
          page: "providers",
        },
      ],
      [
        "编辑供应商",
        {
          version: "synthetic-version",
          environment: "development",
          module: "providers",
          action: "edit",
          stage: "result",
          tool: "codex",
          page: "providers",
          outcome: "unknown",
          error_category: "permission",
        },
      ],
    ]);
    trackInteraction("navigation", "view", {
      tool: "synthetic-secret",
      page: "/synthetic/private",
    });
    expect(track.mock.lastCall?.[1]).not.toHaveProperty("tool");
    expect(track.mock.lastCall?.[1]).not.toHaveProperty("page");
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /synthetic-secret|synthetic-name|synthetic\.invalid|\/synthetic/,
    );
  });

  it("does not wait for telemetry, leak errors, or change a business return value", async () => {
    const business = { key: "synthetic-secret" };
    track.mockReturnValue(new Promise(() => {}));
    expect(
      await trackOperation("keys", "create", {}, async () => business),
    ).toBe(business);
    track.mockImplementation(() => {
      throw new Error("synthetic telemetry error");
    });
    expect(
      await trackOperation("keys", "create", {}, async () => business),
    ).toBe(business);
    track.mockRejectedValue(new Error("synthetic rejected telemetry"));
    expect(
      await trackOperation("keys", "create", {}, async () => business),
    ).toBe(business);
    await Promise.resolve();
    vi.stubGlobal("umami", undefined);
    expect(
      await trackOperation("keys", "create", {}, async () => business),
    ).toBe(business);
  });

  it("records false, unknown and partial outcomes without treating them as success", async () => {
    expect(await trackOperation("mcp", "delete", {}, async () => false)).toBe(
      false,
    );
    expect(track.mock.lastCall?.[1].outcome).toBe("failure");
    const finish = beginOperation("config", "import");
    finish("partial", { code: "write_failed", message: "synthetic-path" });
    finish("success");
    expect(track.mock.lastCall?.[1]).toMatchObject({
      outcome: "partial",
      error_category: "local_write",
    });
    expect(track).toHaveBeenCalledTimes(4);
  });

  it("ignores unsupported event names at runtime", () => {
    trackInteraction("providers", "get_token");
    trackInteraction("synthetic-secret" as never, "view");
    expect(track).not.toHaveBeenCalled();
  });

  it("counts actual navigation transitions, not StrictMode replay or rerenders", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const { rerender } = renderHook(
      ({ page, tool }) => useAnalyticsView(page, tool),
      {
        initialProps: { page: "providers", tool: "claude" },
        wrapper,
      },
    );
    rerender({ page: "providers", tool: "claude" });
    expect(track).toHaveBeenCalledTimes(1);
    rerender({ page: "providers", tool: "codex" });
    rerender({ page: "skills", tool: "codex" });
    rerender({ page: "providers", tool: "codex" });
    expect(track).toHaveBeenCalledTimes(4);
  });
});
