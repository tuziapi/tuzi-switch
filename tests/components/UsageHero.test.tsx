import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageHero } from "@/components/usage/UsageHero";

const useUsageSummaryMock = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      key === "usage.cacheWriteNotReported"
        ? "当前协议不上报缓存写入"
        : (fallback ?? key),
  }),
}));

vi.mock("@/lib/query/usage", () => ({
  useUsageSummary: (...args: unknown[]) => useUsageSummaryMock(...args),
}));

describe("UsageHero", () => {
  beforeEach(() => {
    useUsageSummaryMock.mockReset();
    useUsageSummaryMock.mockReturnValue({
      isLoading: false,
      data: {
        totalRequests: 8,
        totalCost: "1.25",
        totalInputTokens: 500,
        totalOutputTokens: 100,
        totalCacheCreationTokens: 200,
        totalCacheReadTokens: 300,
        realTotalTokens: 1100,
        cacheHitRate: 0.3,
      },
    });
  });

  it("renders normalized totals and the cache protocol note", () => {
    render(
      <UsageHero
        range={{ preset: "today" }}
        appType="codex"
        refreshIntervalMs={0}
      />,
    );

    expect(screen.getByText("1,100")).toBeInTheDocument();
    expect(screen.getByText("30.0%")).toBeInTheDocument();
    expect(screen.getByText("当前协议不上报缓存写入")).toBeInTheDocument();
    expect(useUsageSummaryMock).toHaveBeenCalledWith(
      { preset: "today" },
      "codex",
      { providerName: undefined, model: undefined },
      { refetchInterval: false },
    );
  });
});
