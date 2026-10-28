import { supportsTuziProtocol } from "./tuziEndpointCompatibility";
import type { AppId } from "@/lib/api";
import type { NativeTool } from "@/lib/api/nativeTools";
export type TuziTool = AppId | NativeTool;
export type TuziProtocol = "anthropic" | "responses" | "chat" | "gemini";
export interface TuziProviderDraft<T extends TuziTool = AppId> {
  appId: T;
  key: string;
  tokenId: string;
  userId: string;
  generation: number;
  protocol: TuziProtocol;
  model?: string;
  name?: string;
}
export const TUZI_TOOL_TARGETS: {
  appId: TuziTool;
  protocol: TuziProtocol;
  endpoint: string;
}[] = [
  {
    appId: "claude",
    protocol: "anthropic",
    endpoint: "https://apius.tu-zi.com",
  },
  {
    appId: "claude-desktop",
    protocol: "anthropic",
    endpoint: "https://apius.tu-zi.com",
  },
  {
    appId: "codex",
    protocol: "responses",
    endpoint: "https://api.tu-zi.com/v1",
  },
  { appId: "gemini", protocol: "gemini", endpoint: "https://api.tu-zi.com" },
  {
    appId: "opencode",
    protocol: "responses",
    endpoint: "https://api.tu-zi.com/v1",
  },
  {
    appId: "opencode",
    protocol: "anthropic",
    endpoint: "https://api.tu-zi.com/v1",
  },
  { appId: "opencode", protocol: "chat", endpoint: "https://api.tu-zi.com/v1" },
  { appId: "opencode", protocol: "gemini", endpoint: "https://api.tu-zi.com" },
  { appId: "openclaw", protocol: "chat", endpoint: "https://api.tu-zi.com/v1" },
  {
    appId: "openclaw",
    protocol: "anthropic",
    endpoint: "https://api.tu-zi.com/v1",
  },
  {
    appId: "hermes",
    protocol: "responses",
    endpoint: "https://api.tu-zi.com/v1",
  },
  {
    appId: "hermes",
    protocol: "anthropic",
    endpoint: "https://api.tu-zi.com/v1",
  },
  ...(["grokbuild", "pi", "mcode"] as const).flatMap((appId) =>
    (["responses", "chat", "anthropic"] as const).map((protocol) => ({
      appId,
      protocol,
      endpoint:
        appId !== "grokbuild" && protocol === "anthropic"
          ? "https://api.tu-zi.com"
          : "https://api.tu-zi.com/v1",
    })),
  ),
];
export function tuziToolCompatibility(
  key: {
    status: number;
    group: string;
    model_limits: string;
    model_limits_enabled?: boolean;
    expired_time?: number;
    remain_quota?: string;
    unlimited_quota?: boolean;
  },
  model: {
    model_name: string;
    enable_groups: string[];
    supported_endpoint_types: string[];
    endpoints?: unknown;
  },
  appId: TuziTool,
  protocol: TuziProtocol,
  platform = navigator.platform,
  pricingMeta?: Record<string, unknown>,
): string | null {
  if (appId === "claude-desktop" && /linux/i.test(platform))
    return "Claude Desktop 在 Linux 不支持";
  if (
    !TUZI_TOOL_TARGETS.some((t) => t.appId === appId && t.protocol === protocol)
  )
    return "工具不支持此协议";
  if (key.status !== 1) return "Key 未启用";
  if (
    key.expired_time &&
    key.expired_time !== -1 &&
    key.expired_time <= Date.now() / 1000
  )
    return "Key 已过期";
  if (
    !key.unlimited_quota &&
    key.remain_quota !== undefined &&
    BigInt(key.remain_quota) <= 0n
  )
    return "Key 额度不足";
  const groups = key.group
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const resolution = object(
    object(pricingMeta?.default_resolution)[model.model_name],
  );
  const resolvedDefault =
    typeof resolution.effective_group === "string"
      ? resolution.effective_group
      : typeof pricingMeta?.default_effective_group === "string"
        ? pricingMeta.default_effective_group
        : "";
  const visible = object(pricingMeta?.usable_group);
  const effectiveGroups = groups
    .map((group) =>
      group === "default" && resolvedDefault ? resolvedDefault : group,
    )
    .filter((group) => group !== "auto");
  if (
    !Array.isArray(model.enable_groups) ||
    !model.enable_groups.some(
      (g) =>
        effectiveGroups.includes(g) &&
        (Object.keys(visible).length === 0 || g in visible),
    )
  )
    return "Key 分组与模型不兼容";
  const limits = key.model_limits
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    key.model_limits_enabled &&
    limits.length &&
    !limits.includes(model.model_name)
  )
    return "Key 模型限制不允许此模型";
  if (!supportsTuziProtocol(model, protocol)) return "模型端点与工具协议不兼容";
  return null;
}
