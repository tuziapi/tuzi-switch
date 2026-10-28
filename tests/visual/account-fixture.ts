import {
  nativePreviewSources,
  nativePreviewSourceResult,
} from "./native-tool-fixture";
// Shared synthetic account responses; no real transport, credentials or filesystem.
import type { DesktopRequest } from "@/lib/api/account";
import type { DesktopKey, DesktopPricing } from "@/lib/api/desktop";
let mode = "normal";
export function setAccountPreviewMode(value: string) {
  mode = value;
}
const now = Math.floor(Date.now() / 1000);
const money = {
  quota_per_unit: "500000",
  base_currency: "USD",
  display_type: "USD",
  usd_exchange_rate: "7",
  custom_currency_symbol: "¥",
  custom_currency_exchange_rate: "7",
};
const key: DesktopKey = {
  id: "synthetic-key-1",
  name: "合成开发密钥",
  masked_key: "sk-•••• DEMO",
  status: 1,
  group: "default",
  created_time: now - 86400,
  accessed_time: now - 60,
  expired_time: -1,
  remain_quota: "25000000",
  used_quota: "6400000",
  unlimited_quota: false,
  model_limits_enabled: false,
  model_limits: "",
  allow_ips: null,
  exclude_ips: null,
  is_expired: false,
};
const keys = [
  key,
  {
    ...key,
    id: "synthetic-key-2",
    name: "合成工作项目",
    group: "claude",
    masked_key: "sk-•••• TEST",
    status: 2,
    expired_time: now + 86400 * 30,
  },
];
const models: DesktopPricing[] = [
  ["gpt-5.6-sol", "OpenAI", "responses,openai"],
  ["claude-sonnet-5-5", "Anthropic", "anthropic_messages"],
  ["gemini-3.1-pro-preview", "Google", "gemini_native,openai"],
  ["gpt-image-2", "OpenAI", "Images"],
].map(([name, vendor, protocol]) => ({
  model_name: name,
  aliases: [],
  description: "合成模型 · 仅供本地视觉验证",
  description_i18n: "{}",
  tags: "文本 / 推理",
  vendor_id: vendor,
  quota_type: 0,
  model_ratio: 1,
  model_price: null,
  pricing_unavailable: false,
  completion_ratio: 3,
  enable_groups: ["default"],
  supported_endpoint_types: protocol.split(","),
  endpoints: {},
  billing_mode: "按量计费",
  billing_expr: null,
  pricing_version: "synthetic-v1",
  related_pricing: [],
}));
const values = {
  call_count: "128",
  quota: "630000",
  prompt_tokens: "204800",
  completion_tokens: "43800",
};
const points = Array.from({ length: 12 }, (_, i) => ({
  ...values,
  call_count: String(i * 2),
  quota: String(
    [
      20000, 34000, 25000, 56000, 80000, 64000, 72000, 44000, 96000, 68000,
      80000, 90000,
    ][i],
  ),
  bucket_start: now - (12 - i) * 3600,
  bucket_end: now - (11 - i) * 3600,
}));
const metric = {
  avg_latency_ms: 12300,
  avg_ttft_ms: 2100,
  avg_tps: 48.5,
  success_rate: 99.8,
  has_samples: true,
  sample_level: "model",
  ttft_sample_level: "model",
  latest_sample_ts: now - 60,
  historical_values: {},
  half_hour_series: Array.from({ length: 48 }, (_, i) => ({
    ts: now - (48 - i) * 1800,
    avg_latency_ms: 12300,
    avg_ttft_ms: 2100,
    avg_tps: 48.5,
    success_rate: i === 18 ? 82 : 99.8,
    has_samples: i !== 30,
  })),
};
const logs = Array.from({ length: 20 }, (_, i) => ({
  id: `synthetic-log-${i}`,
  type: i === 2 ? 6 : 2,
  created_at: now - i * 600,
  model_name: models[i % 3].model_name,
  token_name: key.name,
  group: "default",
  request_id: `req_synthetic_${i}`,
  result: i === 2 ? "error" : "success",
  billing_status: i === 2 ? "not_charged" : "charged",
  quota: i === 2 ? "0" : "21000",
  prompt_tokens: "8240",
  completion_tokens: "1190",
  duration_ms: 12300,
  is_stream: true,
  error_code: null,
  error_message: null,
}));
const summary = {
  record_count: "128",
  error_count: "2",
  quota: "630000",
  prompt_tokens: "204800",
  completion_tokens: "43800",
  start_timestamp: now - 86400,
  end_timestamp: now,
};
export async function accountPreviewIPC(command: string, args?: unknown) {
  if (
    command === "account_cancel_request" ||
    command === "account_cancel_token_prefill"
  )
    return;
  if (command === "tuzi_provider_sources")
    return nativePreviewSources((args as { app?: string })?.app);
  if (command === "tuzi_native_tool_sources")
    return nativePreviewSourceResult();
  if (command === "tuzi_provider_backups") return [];
  if (command === "account_open_web")
    throw { code: "synthetic_preview_no_external_action" };
  if (command !== "account_request")
    throw new Error(`Synthetic account preview rejects IPC: ${command}`);
  const request = (args as { request: DesktopRequest }).request;
  if (mode === "loading")
    await new Promise((resolve) => setTimeout(resolve, 60000));
  if (mode === "error" && !request.path.endsWith("capabilities"))
    throw { code: "network_error", retryAfter: 5 };
  const empty = mode === "empty";
  const envelope = (data: unknown) => ({
    success: true,
    message: "Synthetic visual fixture",
    data,
    meta: {
      contract_version: "system-token-v1.0",
      request_id: "synthetic-only",
      generated_at: now,
    },
  });
  const q = Object.fromEntries(request.query ?? []);
  if (
    request.method === "POST" &&
    keys.some((k) => request.path === `/account/keys/${k.id}/reveal`)
  )
    return envelope({ key: "sk-SYNTHETIC_PREVIEW_ONLY" });
  if (request.method !== "GET") throw { code: "synthetic_preview_read_only" };
  switch (request.path) {
    case "/account/capabilities":
      return envelope({
        release: { profile: "phase1", overview: true, keys: true },
        native: Object.fromEntries(
          [
            "account",
            "keys",
            "logs",
            "usage",
            "models",
            "performance",
            "profile_read",
            "profile_write",
          ].map((x) => [x, true]),
        ),
        web: { topup: true, redemption: true, personal: true },
      });
    case "/account/account":
      return envelope({
        user_id: "synthetic-user",
        username: "preview_synthetic",
        display_name: "本地合成账户",
        status: "enabled",
        group: "default",
        quota: "28150000",
        used_quota: "85000000",
        request_count: "2048",
        money,
      });
    case "/account/usage/summary":
      return envelope(
        empty
          ? {
              call_count: "0",
              quota: "0",
              prompt_tokens: "0",
              completion_tokens: "0",
            }
          : values,
      );
    case "/account/usage":
      return envelope({
        source: "usage",
        timezone: q.timezone,
        start_time: Number(q.start_time),
        end_time: Number(q.end_time),
        data_as_of: now,
        estimated_delay_seconds: 0,
        chart: empty ? [] : points,
        table: [],
      });
    case "/account/keys":
      return envelope({
        page: 1,
        page_size: 20,
        total: empty ? "0" : "2",
        has_more: false,
        items: empty
          ? []
          : keys.filter((k) => !q.keyword || k.name.includes(q.keyword)),
      });
    case "/account/key-groups":
      return envelope([
        { id: "default", label: "默认分组" },
        { id: "claude", label: "Claude" },
      ]);
    case "/account/models":
      return envelope({
        items: empty
          ? []
          : models.filter((m) => !q.search || m.model_name.includes(q.search)),
        pagination: { page: 1, page_size: 20, total: "4", has_more: false },
        snapshot_id: "synthetic-snapshot",
        snapshot_refreshed: false,
        api_version: 1,
        schema_version: "v1",
        algorithm_version: "v1",
        pricing_meta: { default_effective_group: "default" },
      });
    case "/account/model-performance":
      return envelope({
        model_name: q.model,
        aggregate: metric,
        groups: [{ ...metric, group: "default" }],
        series_schema: "v1",
      });
    case "/account/logs":
      return envelope({
        page: 1,
        page_size: 20,
        total: empty ? "0" : "128",
        has_more: !empty,
        items: empty ? [] : logs,
      });
    case "/account/logs/summary":
      return envelope(summary);
    case "/account/logs/statistics":
      return envelope({ summary, trend: [], by_model: [], by_error: [] });
    case "/account/profile":
      return envelope({
        user_id: "synthetic-user",
        username: "preview_synthetic",
        email: "synthetic@example.invalid",
        display_name: "本地合成账户",
        language: "zh-CN",
        accept_unset_model_ratio_model: false,
        high_concurrency_enabled: true,
        record_ip_log: false,
      });
    default:
      if (
        request.path.startsWith("/account/keys/") &&
        request.path.endsWith("/models")
      )
        return envelope({ items: empty ? [] : models });
      if (request.path.includes("/keys/"))
        return envelope(keys.find((k) => request.path.endsWith(k.id)) ?? key);
      if (request.path.includes("/logs/requests/"))
        return envelope({
          request_id: request.path.split("/").pop(),
          items: logs.slice(0, 1),
          has_more: false,
        });
      throw { code: "synthetic_unknown_request" };
  }
}
