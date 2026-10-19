import rules from "./tuziEndpointProtocols.json";

type Protocol = keyof typeof rules;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const normalize = (value: string) => value.trim().toLowerCase();

/** Catalog labels are not URLs. Only verified aliases and protocol paths qualify. */
export function supportsTuziProtocol(
  model: { supported_endpoint_types?: unknown; endpoints?: unknown },
  protocol: Protocol,
): boolean {
  const rule = rules[protocol];
  if (!rule || !Array.isArray(model.supported_endpoint_types)) return false;
  const endpoints = object(model.endpoints);
  return model.supported_endpoint_types.some((value: unknown) => {
    if (typeof value !== "string") return false;
    const name = normalize(value);
    const standard = rule.aliases.includes(name);
    if (!standard && !(rule.catalogAliases as string[]).includes(name))
      return false;
    const detailKey =
      endpoints &&
      (Object.prototype.hasOwnProperty.call(endpoints, value)
        ? value
        : Object.keys(endpoints).find((key) => normalize(key) === name));
    const detail =
      endpoints && detailKey !== undefined ? endpoints[detailKey] : undefined;
    if (detail == null) return standard;
    const info = object(detail);
    if (typeof detail !== "string" && !info) return false;
    const method = info?.method;
    if (
      method != null &&
      (typeof method !== "string" ||
        (method.trim() !== "" && normalize(method) !== "post"))
    )
      return false;
    const path = typeof detail === "string" ? detail : info?.path;
    if (path == null || (typeof path === "string" && path.trim() === ""))
      return standard;
    return (
      typeof path === "string" &&
      rule.paths.includes(path.trim().replace(/\/+$/, ""))
    );
  });
}
