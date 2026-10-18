import type { Money } from "./api/desktop";
function decimal(value: string): [bigint, bigint] {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error("invalid decimal");
  const [a, b = ""] = value.split(".");
  return [BigInt(a + b), 10n ** BigInt(b.length)];
}
/** Decimal integer arithmetic, half-up; never converts quota through JS number. */
export function formatMoney(quota: string, money: Money, places = 2): string {
  if (money.display_type === "TOKENS") return quota + " quota";
  const [q, qd] = decimal(quota),
    [unit, ud] = decimal(money.quota_per_unit),
    [rate, rd] = decimal(
      money.display_type === "CNY"
        ? money.usd_exchange_rate
        : money.display_type === "CUSTOM"
          ? money.custom_currency_exchange_rate
          : "1",
    );
  if (unit <= 0n || rate <= 0n) throw new Error("invalid money metadata");
  const n = q * ud * rate,
    d = qd * unit * rd,
    scale = 10n ** BigInt(places),
    negative = n < 0n,
    abs = negative ? -n : n;
  const rounded = (abs * scale * 2n + d) / (2n * d);
  const symbol =
    money.display_type === "USD"
      ? "USD "
      : money.display_type === "CNY"
        ? "CNY "
        : money.custom_currency_symbol + " ";
  if (abs > 0n && rounded === 0n)
    return (
      symbol + (negative ? "-" : "") + "<" + (1 / 10 ** places).toFixed(places)
    );
  return (
    symbol +
    (negative ? "-" : "") +
    (rounded / scale).toString() +
    "." +
    (rounded % scale).toString().padStart(places, "0")
  );
}

/** Convert a user-entered monetary limit to integer quota, rounded half-up. */
export function amountToQuota(
  amount: string,
  money: Money,
  currency: "CNY" | "USD",
): string {
  if (!/^\d+(\.\d{1,8})?$/.test(amount)) throw new Error("invalid amount");
  const [a, ad] = decimal(amount);
  const [unit, ud] = decimal(money.quota_per_unit);
  const [rate, rd] = decimal(
    currency === "CNY" ? money.usd_exchange_rate : "1",
  );
  if (unit <= 0n || rate <= 0n) throw new Error("invalid money metadata");
  const n = a * unit * rd,
    d = ad * ud * rate;
  return ((2n * n + d) / (2n * d)).toString();
}
