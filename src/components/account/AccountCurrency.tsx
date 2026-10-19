import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { Money } from "@/lib/api/desktop";
import { formatMoney } from "@/lib/accountMoney";

export type AccountCurrency = "CNY" | "USD";
const storageKey = "tuzi-account-display-currency";
let memory: AccountCurrency = "CNY";
let storageFailed = false;
const listeners = new Set<() => void>();
const read = (): AccountCurrency => {
  try {
    if (storageFailed) return memory;
    const saved = localStorage.getItem(storageKey);
    memory = saved === "USD" ? "USD" : "CNY";
  } catch {
    /* memory preference survives storage denial */
  }
  return memory;
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export function useAccountCurrency() {
  return useSyncExternalStore(subscribe, read, () => "CNY" as const);
}
export function CurrencySwitcher() {
  const currency = useAccountCurrency();
  return (
    <div className="account-currency" role="group" aria-label="显示币种">
      {(["CNY", "USD"] as const).map((value) => (
        <Button
          key={value}
          size="sm"
          variant={currency === value ? "secondary" : "ghost"}
          aria-pressed={currency === value}
          onClick={() => {
            memory = value;
            try {
              localStorage.setItem(storageKey, value);
              storageFailed = false;
            } catch {
              storageFailed = true;
            }
            listeners.forEach((fn) => fn());
          }}
        >
          {value}
        </Button>
      ))}
    </div>
  );
}
export function displayAmount(
  quota: string,
  money: Money | undefined,
  currency: AccountCurrency,
) {
  if (!money) return "—";
  try {
    return formatMoney(quota, { ...money, display_type: currency })
      .replace(/^CNY /, "¥")
      .replace(/^USD /, "$");
  } catch {
    return "—";
  }
}
