import { describe, expect, it } from "vitest";
import {
  buildUsageTrendChartData,
  formatUsageTrendTickLabel,
} from "@/components/usage/UsageTrendChart";

const day = (date: string) => ({
  date: `${date}T12:00:00.000Z`,
  totalInputTokens: 100,
  totalOutputTokens: 50,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  totalCost: "0.01",
});

describe("buildUsageTrendChartData", () => {
  it("keeps categories unique across years", () => {
    const startDate = Date.parse("2025-01-01T00:00:00Z") / 1000;
    const endDate = Date.parse("2026-12-31T00:00:00Z") / 1000;
    const points = buildUsageTrendChartData(
      [day("2025-04-27"), day("2026-04-27")],
      { isHourly: false, dateLocale: "en-US", startDate, endDate },
    );

    expect(points[0].xKey).not.toBe(points[1].xKey);
    expect(points[0].tooltipLabel).toMatch(/2025/);
    expect(points[1].tooltipLabel).toMatch(/2026/);
    expect(points[0].label).not.toBe(points[1].label);
  });

  it("resolves thinned tick labels by the category key", () => {
    const startDate = Date.parse("2025-01-01T00:00:00Z") / 1000;
    const endDate = Date.parse("2026-12-31T00:00:00Z") / 1000;
    const points = buildUsageTrendChartData(
      [day("2025-04-27"), day("2026-04-27")],
      { isHourly: false, dateLocale: "en-US", startDate, endDate },
    );

    expect(formatUsageTrendTickLabel(points[1].xKey, points)).toBe(
      points[1].label,
    );
  });
});
