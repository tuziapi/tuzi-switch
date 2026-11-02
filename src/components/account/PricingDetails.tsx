import { settingsApi } from "@/lib/api";
import { toast } from "sonner";
import { useState } from "react";
import { groupPrices, type GroupPrices } from "@/lib/accountPricing/groups";
import type { DesktopPricing } from "@/lib/api/desktop";

/** The same visible groups as the website, using group catalog plans. */
export function PricingDetails({
  model,
  meta = {},
}: {
  model: DesktopPricing;
  meta?: Record<string, unknown>;
}) {
  const groups = groupPrices(model, meta);
  return (
    <section className="account-catalog-pricing">
      <div className="account-price-tab">价格与说明</div>
      <div className="account-price-panel">
        <h4>分组价格</h4>
        <p className="account-subtle">
          美元计价 · 分组目录价格，不含个人专属折扣
        </p>
        {groups.map((group) => (
          <GroupPrice key={group.group} group={group} />
        ))}
        {!groups.length && (
          <p className="account-subtle">暂无可展示的分组价格</p>
        )}
        <button
          className="account-price-site"
          onClick={() =>
            void settingsApi
              .openExternal("https://api.tu-zi.com/pricing")
              .catch(() => toast.error("无法打开浏览器，请稍后重试"))
          }
        >
          在网站查看完整定价说明 ↗
        </button>
      </div>
    </section>
  );
}
function GroupPrice({ group }: { group: GroupPrices }) {
  const [tier, setTier] = useState(0);
  const tiers = group.tiers;
  const prices = tiers[tier]?.prices ?? tiers[0]?.prices ?? [];
  return (
    <section
      className="account-group-price"
      aria-label={`${group.label} 分组价格`}
    >
      <div className="account-group-price-heading">
        <strong>{group.label}</strong>
        {group.label !== group.group && <small>{group.group}</small>}
      </div>
      <div>
        {tiers.length > 1 && (
          <label className="account-price-tier">
            {group.label} · 价格档位{" "}
            <select
              value={tier}
              onChange={(e) => setTier(Number(e.target.value))}
            >
              {tiers.map((item, index) => (
                <option key={index} value={index}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {prices.length > 0 ? (
          <table className="account-price-table">
            <thead>
              <tr>
                <th>计费项目</th>
                <th>价格</th>
              </tr>
            </thead>
            <tbody>
              {prices.map(({ label, amount, unit }) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>
                    <strong>
                      $
                      {amount.toLocaleString("en-US", {
                        maximumFractionDigits: 12,
                      })}
                    </strong>{" "}
                    <small>{unit}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="account-subtle">
            暂无可直接展示的价格，请在网站查看完整定价说明。
          </p>
        )}
      </div>
    </section>
  );
}
