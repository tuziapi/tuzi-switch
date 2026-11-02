import type { DesktopPricing, Models } from "./desktop";
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid model response");
  return v as Record<string, unknown>;
};
const strings = (v: unknown): string[] =>
  v == null
    ? []
    : Array.isArray(v) && v.every((x) => typeof x === "string")
      ? v
      : (() => {
          throw new Error("Invalid model array");
        })();
function model(value: unknown, depth = 0): DesktopPricing {
  const v = object(value);
  if (typeof v.model_name !== "string" || depth > 8)
    throw new Error("Invalid model");
  if (v.related_pricing != null && !Array.isArray(v.related_pricing))
    throw new Error("Invalid related pricing");
  return {
    ...v,
    aliases: strings(v.aliases),
    enable_groups: strings(v.enable_groups),
    supported_endpoint_types: strings(v.supported_endpoint_types),
    description: typeof v.description === "string" ? v.description : "",
    description_i18n:
      typeof v.description_i18n === "string" ? v.description_i18n : "",
    tags: typeof v.tags === "string" ? v.tags : "",
    related_pricing: ((v.related_pricing ?? []) as unknown[]).map((x) =>
      model(x, depth + 1),
    ),
  } as DesktopPricing;
}
export function normalizeModels(value: unknown): Models {
  const v = object(value),
    pagination = object(v.pagination);
  if (!Array.isArray(v.items) || !Number.isFinite(Number(pagination.total)))
    throw new Error("Invalid model catalog");
  return {
    ...v,
    items: v.items.map((x) => model(x)),
    pricing_meta: v.pricing_meta == null ? {} : object(v.pricing_meta),
  } as unknown as Models;
}
