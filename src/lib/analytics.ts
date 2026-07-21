import { invokeCapability } from "@/lib/capabilities/client";

const ALLOWED_EVENTS = new Set([
  "app_started",
  "app_selected",
  "provider_action",
  "proxy_action",
  "auth_action",
  "config_action",
  "webdav_action",
  "update_action",
  "setting_action",
]);

const ALLOWED_PROPERTY_KEYS = new Set([
  "app",
  "action",
  "result",
  "source",
  "enabled",
]);
const MAX_PROPERTY_VALUE_LENGTH = 32;
const MIN_EVENT_INTERVAL_MS = 500;

export type AnalyticsEvent =
  | "app_started"
  | "app_selected"
  | "provider_action"
  | "proxy_action"
  | "auth_action"
  | "config_action"
  | "webdav_action"
  | "update_action"
  | "setting_action";

export interface AnalyticsProperties {
  app?: string;
  action?: string;
  result?: "success" | "failed" | "partial" | "degraded" | "rejected";
  source?: "manual" | "automatic" | "tray" | "failover" | "health_check";
  enabled?: "true" | "false";
}

const lastSentAt = new Map<string, number>();
let analyticsEnabled = true;

export function setAnalyticsEnabled(enabled: boolean): void {
  analyticsEnabled = enabled;
  if (!enabled) lastSentAt.clear();
}

function sanitizeProperties(
  properties?: AnalyticsProperties,
): Record<string, string> {
  if (!properties) return {};

  return Object.fromEntries(
    Object.entries(properties)
      .filter(
        ([key, value]) =>
          ALLOWED_PROPERTY_KEYS.has(key) && typeof value === "string",
      )
      .map(([key, value]) => [
        key,
        value.trim().slice(0, MAX_PROPERTY_VALUE_LENGTH),
      ])
      .filter(([, value]) => value.length > 0),
  );
}

export function track(
  event: AnalyticsEvent,
  properties?: AnalyticsProperties,
): void {
  if (!analyticsEnabled || !import.meta.env.PROD || !ALLOWED_EVENTS.has(event))
    return;

  const data = sanitizeProperties(properties);
  const dedupeKey = `${event}:${Object.entries(data)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(":")}`;
  const now = Date.now();
  if (now - (lastSentAt.get(dedupeKey) ?? 0) < MIN_EVENT_INTERVAL_MS) return;
  lastSentAt.set(dedupeKey, now);

  void invokeCapability<boolean>({
    id: "analytics.trackProductEvent",
    payload: { event, data },
  }).catch(() => {
    // 产品统计失败不得影响任何业务流程，也不记录可能包含环境信息的错误。
  });
}
