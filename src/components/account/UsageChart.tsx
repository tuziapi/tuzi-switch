import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { Money, Usage } from "@/lib/api/desktop";
import { formatMoney } from "@/lib/accountMoney";
import { date } from "./BusinessShared";

/** Presentation only: graph geometry uses numbers; labels retain exact quota strings. */
export function UsageChart({
  points,
  money,
}: {
  points: Usage["chart"];
  money?: Money;
}) {
  const { t } = useTranslation();
  const gradient = useId();
  if (!points.length)
    return <p className="account-empty">{t("account.business.empty")}</p>;
  const amounts = points.map((point) => Number(point.quota));
  if (amounts.some((value) => !Number.isFinite(value)))
    return <p className="account-empty">{t("account.visual.details")}</p>;
  const low = Math.min(0, ...amounts),
    high = Math.max(1, ...amounts),
    span = high - low;
  const x = (index: number) =>
    points.length === 1 ? 280 : 24 + (index / (points.length - 1)) * 512;
  const y = (value: number) => 160 - ((value - low) / span) * 132;
  const path = amounts
    .map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`)
    .join(" ");
  const label = (quota: string) =>
    money ? formatMoney(quota, money) : `${quota} quota`;
  return (
    <figure className="account-usage-chart">
      <svg
        viewBox="0 0 560 190"
        role="img"
        aria-label={t("account.visual.dailyTrend")}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".18" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[28, 72, 116, 160].map((line) => (
          <path
            key={line}
            d={`M24 ${line}H536`}
            className="account-chart-grid"
          />
        ))}
        <path
          d={`${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={`url(#${gradient})`}
        />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {points.map((point, index) => (
          <circle
            key={point.bucket_start}
            cx={x(index)}
            cy={y(amounts[index])}
            r="3"
            fill="currentColor"
          >
            <title>
              {date(point.bucket_start)} · {label(point.quota)}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption>
        <span>{date(points[0].bucket_start)}</span>
        <span>{date(points[points.length - 1].bucket_start)}</span>
      </figcaption>
    </figure>
  );
}
