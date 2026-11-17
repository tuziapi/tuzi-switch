import type { Provider, ClaudeDesktopModelRoute } from "@/types";

export type CatalogModel = { id: string; createdAt?: number };
export const isClaudeModel = (id: string) =>
  /^(anthropic\/)?claude-/i.test(id.trim());

export function sortCatalog(
  models: CatalogModel[],
  preferred = "",
): CatalogModel[] {
  const unique = new Map<string, CatalogModel>();
  for (const model of models) {
    const id = model.id.trim();
    if (id)
      unique.set(id, {
        id,
        ...(model.createdAt && model.createdAt > 0
          ? { createdAt: model.createdAt }
          : {}),
      });
  }
  return [...unique.values()].sort(
    (a, b) =>
      Number(b.id === preferred) - Number(a.id === preferred) ||
      Number(isClaudeModel(b.id)) - Number(isClaudeModel(a.id)) ||
      (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
      a.id.localeCompare(b.id, "en", { numeric: true }),
  );
}

export function mergeCatalogRoutes(
  existing: Record<string, ClaudeDesktopModelRoute>,
  models: CatalogModel[],
) {
  const routes = { ...existing };
  const mapped = new Set(
    Object.values(routes).map((route) => route.model.trim()),
  );
  for (const { id } of models) {
    if (isClaudeModel(id) && !mapped.has(id) && !routes[id]) {
      routes[id] = { model: id };
      mapped.add(id);
    }
  }
  return routes;
}

export function configuredModels(
  provider?: Partial<Pick<Provider, "meta" | "settingsConfig">>,
): string[] {
  const routes = provider?.meta?.claudeDesktopModelRoutes;
  if (routes && Object.keys(routes).length) {
    // Match native snapshot behavior: explicit mappings take precedence over env.
    if (Object.keys(routes).some((id) => id.trim() && !isClaudeModel(id)))
      return [];
    return [
      ...new Set(
        Object.entries(routes)
          .filter(([id, route]) => id.trim() && route.model.trim())
          .map(([, route]) => route.model.trim()),
      ),
    ];
  }
  const env = provider?.settingsConfig?.env ?? {};
  return [
    ...new Set(
      [
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      ]
        .map((key) => env[key])
        .filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value.trim()),
        )
        .map((value) => value.trim()),
    ),
  ];
}
