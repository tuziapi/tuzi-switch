import type { Provider, ClaudeDesktopModelRoute } from "@/types";

export type CatalogModel = { id: string; createdAt?: number };
export const isClaudeModel = (id: string) =>
  /^(anthropic\/)?claude-/i.test(id.trim());

// A model directory does not certify capabilities. Only exclude recognizable
// dedicated media/embedding families; unknown vendors remain selectable.
export const isKnownNonChatModel = (id: string) =>
  /(?:^|[/_-])(?:image|embedding|embeddings|rerank|reranker|tts|whisper|dall-e|stable-diffusion|flux|sora|veo)(?:$|[/_.-])/i.test(
    id.trim(),
  );

export function modelRouteId(model: string, occupied: Iterable<string> = []) {
  const id = model.trim();
  const base = isClaudeModel(id)
    ? id
    : `claude-${id.replace(/[^a-zA-Z0-9._-]/g, "-") || "model"}`;
  const used = occupied instanceof Set ? occupied : new Set(occupied);
  let alias = base;
  for (let suffix = 2; used.has(alias); suffix++) alias = `${base}-${suffix}`;
  return alias;
}

export function isAutomaticCatalogRoute(
  id: string,
  route: ClaudeDesktopModelRoute,
) {
  const base = modelRouteId(route.model);
  const suffix = id.startsWith(`${base}-`) ? id.slice(base.length + 1) : "";
  return (
    (id === base || (/^[1-9]\d*$/.test(suffix) && Number(suffix) >= 2)) &&
    (!route.displayName || route.displayName === route.model) &&
    !route.supports1m
  );
}

export function routesNeedProxy(routes: { route: string; model: string }[]) {
  return routes.some(({ route, model }) => {
    const upstream = model.trim() || route.trim();
    return (
      upstream &&
      (!isClaudeModel(upstream) || (route.trim() && route.trim() !== upstream))
    );
  });
}

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
      (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
      a.id.localeCompare(b.id, "en", { numeric: true }),
  );
}

export function mergeCatalogRoutes(
  existing: Record<string, ClaudeDesktopModelRoute>,
  models: CatalogModel[],
) {
  const routes = { ...existing };
  const occupied = new Set(Object.keys(routes));
  const mapped = new Set(
    Object.values(routes).map((route) => route.model.trim()),
  );
  for (const { id } of models) {
    if (!isKnownNonChatModel(id) && !mapped.has(id)) {
      const alias = modelRouteId(id, occupied);
      routes[alias] = {
        model: id,
        ...(alias !== id ? { displayName: id } : {}),
      };
      occupied.add(alias);
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
