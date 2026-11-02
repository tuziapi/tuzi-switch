import type { Price } from "./catalog";
type Linear = { constant: number; terms: Record<string, number> };
/** Display projection, never evaluates billing code or request conditions. Unsupported terms fail closed. */
export function priceTiers(
  expression: string,
): { label: string; prices: Price[] }[] {
  if (expression.length > 16000) return [];
  const units: Record<string, string> = {
    p: "推理输入",
    c: "推理输出",
    cr: "缓存命中",
    cc: "缓存创建",
    cc5m: "缓存创建 · 5 分钟",
    cc1h: "缓存创建 · 1 小时",
  };
  const result: { label: string; prices: Price[] }[] = [];
  const starts = [...expression.matchAll(/\btier\(\s*"([^"\\]*)"\s*,/g)];
  const ranges: [number, number][] = [];
  try {
    for (const match of starts) {
      let end = match.index! + match[0].length,
        depth = 1;
      const begin = end;
      for (; end < expression.length; end++) {
        if (expression[end] === "(") depth++;
        if (expression[end] === ")" && --depth === 0) break;
      }
      if (depth !== 0) return [];
      ranges.push([match.index!, end + 1]);
      const source = expression.slice(begin, end);
      const tokens =
        source.match(
          /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-zA-Z_]\w*|[()+*/-]/gi,
        ) ?? [];
      if (tokens.join("") !== source.replace(/\s/g, "") || tokens.length > 300)
        return [];
      let pos = 0;
      const scalar = (n: number): Linear => ({ constant: n, terms: {} });
      const scale = (a: Linear, n: number): Linear => ({
        constant: a.constant * n,
        terms: Object.fromEntries(
          Object.entries(a.terms).map(([k, v]) => [k, v * n]),
        ),
      });
      function atom(): Linear {
        const token = tokens[pos++];
        if (token === "(") {
          const a = sum();
          if (tokens[pos++] !== ")") throw Error();
          return a;
        }
        if (token === "-") return scale(atom(), -1);
        if (token in units) return { constant: 0, terms: { [token]: 1 } };
        const n = Number(token);
        if (!Number.isFinite(n)) throw Error();
        return scalar(n);
      }
      function product(): Linear {
        let a = atom();
        while (["*", "/"].includes(tokens[pos])) {
          const op = tokens[pos++],
            b = atom();
          if (Object.keys(b.terms).length === 0)
            a = scale(a, op === "*" ? b.constant : 1 / b.constant);
          else if (op === "*" && Object.keys(a.terms).length === 0)
            a = scale(b, a.constant);
          else throw Error();
        }
        return a;
      }
      function sum(): Linear {
        let a = product();
        while (["+", "-"].includes(tokens[pos])) {
          const sign = tokens[pos++] === "+" ? 1 : -1,
            b = scale(product(), sign);
          a = { constant: a.constant + b.constant, terms: { ...a.terms } };
          for (const [k, v] of Object.entries(b.terms))
            a.terms[k] = (a.terms[k] ?? 0) + v;
        }
        return a;
      }
      const value = sum();
      if (pos !== tokens.length) return [];
      const v2 = expression.trim().startsWith("v2:");
      const prices = Object.entries(value.terms).map(([k, v]) => ({
        label: units[k],
        amount: v * (v2 ? 1e6 : 1),
        unit: "/ 1M tokens",
      }));
      if (value.constant !== 0 || !prices.length)
        prices.push({
          label: "固定费用",
          amount: value.constant / (v2 ? 1 : 1e6),
          unit: "/ 次",
        });
      if (prices.some((p) => !Number.isFinite(p.amount) || p.amount < 0))
        return [];
      result.push({ label: match[1], prices });
    }
    // Wrappers can alter all prices; do not silently ignore them.
    if (/\b(?:priceScale|min|max|ceil|floor)\s*\(/.test(expression)) return [];
    let skeleton = expression;
    for (const [start, end] of ranges.reverse())
      skeleton = skeleton.slice(0, start) + "@" + skeleton.slice(end);
    skeleton = skeleton
      .trim()
      .replace(/^v[12]:/, "")
      .trim();
    if (
      !/^(?:[a-zA-Z_]\w*\s*(?:<=|>=|==|<|>)\s*\d+(?:\.\d+)?\s*\?\s*@\s*:\s*)*@$/.test(
        skeleton,
      )
    )
      return [];
    return result;
  } catch {
    return [];
  }
}
