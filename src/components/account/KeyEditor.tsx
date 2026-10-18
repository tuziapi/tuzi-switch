import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { KeyWrite, Money } from "@/lib/api/desktop";
import { amountToQuota, formatMoney } from "@/lib/accountMoney";
import { useAccountCurrency } from "./AccountCurrency";
import { Check, Field } from "./BusinessShared";

export function KeyEditor({
  form,
  onChange,
  groups,
  money,
}: {
  form: KeyWrite;
  onChange: (form: KeyWrite) => void;
  groups: { id: string; label: string }[];
  money?: Money;
}) {
  const currency = useAccountCurrency();
  const [amount, setAmount] = useState<string | null>(null);
  const [amountError, setAmountError] = useState("");
  const change = (key: keyof KeyWrite, value: string | number | boolean) =>
    onChange({ ...form, [key]: value });
  const selected = form.group.split(",").filter(Boolean);
  const choices = [
    ...groups,
    ...selected
      .filter((id) => !groups.some((g) => g.id === id))
      .map((id) => ({ id, label: id })),
  ];
  let shownAmount = "";
  try {
    if (money)
      shownAmount = formatMoney(
        form.remain_quota,
        { ...money, display_type: currency },
        8,
      ).replace(/^[A-Z]+ /, "");
  } catch {
    /* no fabricated rate */
  }
  const localDate = (n: number) => {
    const d = new Date(n * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  return (
    <div className="account-key-form">
      <Field
        label="名称"
        value={form.name}
        onChange={(v) => change("name", v)}
      />
      <label className="account-field">
        分组
        <select
          aria-label="分组"
          value=""
          onChange={(e) => {
            if (e.target.value && !selected.includes(e.target.value))
              change("group", [...selected, e.target.value].join(","));
          }}
        >
          <option value="">
            {selected.length ? "添加备用分组（可选）" : "请选择分组"}
          </option>
          {choices
            .filter((g) => !selected.includes(g.id))
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
        </select>
      </label>
      {!!selected.length && (
        <div className="account-group-chips">
          {selected.map((id, index) => (
            <span key={id}>
              {choices.find((g) => g.id === id)?.label ?? id}
              {index === 0 ? " · 主分组" : " · 备用"}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`移除分组 ${id}`}
                onClick={() =>
                  change("group", selected.filter((g) => g !== id).join(","))
                }
              >
                ×
              </Button>
            </span>
          ))}
        </div>
      )}
      <p className="account-form-hint">
        默认不限额度、永不到期。需要限制使用范围时可展开高级设置。
      </p>
      <details className="account-advanced">
        <summary>高级设置</summary>
        <div className="account-key-form">
          <Check
            label="不限额度"
            value={form.unlimited_quota}
            onChange={(v) => change("unlimited_quota", v)}
          />
          {!form.unlimited_quota && (
            <label className="account-field">
              额度（{currency === "CNY" ? "人民币" : "USD"}）
              <input
                aria-label="额度"
                inputMode="decimal"
                required
                disabled={!money}
                value={amount ?? shownAmount}
                onChange={(e) => {
                  const value = e.target.value;
                  setAmount(value);
                  try {
                    if (!money) throw new Error();
                    const q = amountToQuota(value, money, currency);
                    if (BigInt(q) <= 0n) throw new Error();
                    change("remain_quota", q);
                    setAmountError("");
                    e.target.setCustomValidity("");
                  } catch {
                    change("remain_quota", "");
                    setAmountError("请输入大于零的有效金额（最多 8 位小数）");
                    e.target.setCustomValidity("请输入有效金额");
                  }
                }}
              />
              {amountError && <small role="alert">{amountError}</small>}
              {!money && <small>金额换算信息暂不可用，请稍后重试。</small>}
            </label>
          )}
          <p className="account-form-hint">
            密钥额度仅限制该密钥的用量，实际使用仍受账户余额限制。
          </p>
          <label className="account-field">
            到期时间
            <select
              aria-label="到期时间"
              value={form.expired_time === -1 ? "never" : "date"}
              onChange={(e) =>
                change(
                  "expired_time",
                  e.target.value === "never"
                    ? -1
                    : Math.floor(Date.now() / 1000) + 86400 * 30,
                )
              }
            >
              <option value="never">永不到期</option>
              <option value="date">指定日期</option>
            </select>
          </label>
          {form.expired_time !== -1 && (
            <label className="account-field">
              到期日期
              <input
                aria-label="到期日期"
                type="datetime-local"
                required
                value={localDate(form.expired_time)}
                onChange={(e) => {
                  const n = Date.parse(e.target.value);
                  change(
                    "expired_time",
                    Number.isFinite(n) ? Math.floor(n / 1000) : 0,
                  );
                }}
              />
            </label>
          )}
          <Check
            label="限制可用模型"
            value={form.model_limits_enabled}
            onChange={(v) => change("model_limits_enabled", v)}
          />
          {form.model_limits_enabled && (
            <Field
              label="允许的模型（多个模型用逗号分隔）"
              value={form.model_limits}
              onChange={(v) => change("model_limits", v)}
            />
          )}
          <Field
            label="允许的 IP（留空不限制）"
            value={form.allow_ips ?? ""}
            onChange={(v) => change("allow_ips", v)}
          />
          <Field
            label="排除的 IP（可选）"
            value={form.exclude_ips ?? ""}
            onChange={(v) => change("exclude_ips", v)}
          />
        </div>
      </details>
    </div>
  );
}
