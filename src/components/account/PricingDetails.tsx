import { settingsApi } from "@/lib/api";
import { toast } from "sonner";
import { useState } from "react";
import { priceTiers } from "@/lib/accountPricing/tiers";
import type { DesktopPricing } from "@/lib/api/desktop";
import { catalogPrices } from "@/lib/accountPricing/catalog";

/** Catalog prices, without personalized account discounts. */
export function PricingDetails({ model }: { model: DesktopPricing }) {
  const tiers = model.billing_expr ? priceTiers(model.billing_expr) : [];
  const [tier, setTier] = useState(0);
  const prices = tiers[tier]?.prices ?? catalogPrices(model);
  return (
    <section className="account-catalog-pricing">
      <div className="account-price-tab">价格与说明</div>
      <div className="account-price-panel">
        <h4>模型定价</h4>
        <p className="account-subtle">美元计价 · 目录标准价格</p>
        {tiers.length > 0 && (
          <label className="account-price-tier">
            价格档位{" "}
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
            {model.billing_expr
              ? "此模型采用动态计费，具体价格以网站展示的价格档位为准。"
              : "暂无可用价格"}
          </p>
        )}
        {model.enable_groups.length > 0 && (
          <div className="account-price-groups">
            <span>可用分组</span>
            <div className="account-model-tags">
              {model.enable_groups.map((group) => (
                <span className="account-badge" key={group}>
                  {group}
                </span>
              ))}
            </div>
          </div>
        )}
        <button
          className="account-price-site"
          onClick={() =>
            void settingsApi
              .openExternal("https://api.tu-zi.com/pricing")
              .catch(() => toast.error("无法打开浏览器，请稍后重试"))
          }
        >
          在网站查看分组价格与完整说明 ↗
        </button>
      </div>
    </section>
  );
}
