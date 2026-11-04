import {
  nativePreviewSources,
  nativePreviewSourceResult,
} from "./native-tool-fixture";
// Shared synthetic account responses; no real transport, credentials or filesystem.
import type { DesktopRequest } from "@/lib/api/account";
import type { DesktopKey, DesktopPricing } from "@/lib/api/desktop";
let mode = "normal";
let creativeModelAttempts = 0;
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
  ["deepseek-v3", "DeepSeek", "openai"],
  ["qwen3", "Alibaba", "openai"],
  ["kimi-k2", "Moonshot", "openai"],
  ["gemini-flash", "Google", "gemini_native"],
].map(([name, vendor, protocol], index) => ({
  hot_rank: index + 1,
  model_name: name,
  aliases: [],
  description: "合成模型 · 仅供本地视觉验证",
  description_i18n: "{}",
  tags: "文本 / 推理",
  vendor_id: vendor,
  quota_type: 1,
  model_ratio: 1,
  model_price: null,
  pricing_unavailable: false,
  completion_ratio: 3,
  enable_groups: index === 0 ? ["default", "Codex"] : ["default"],
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
  error_message: i === 2 ? "合成错误：请稍后重试" : null,
  public_error_code: i === 2 ? "rate_limit_exceeded" : null,
  status_code: i === 2 ? 429 : null,
  request_path: "/v1/responses",
  upstream_request_id: `synthetic-upstream-${i}`,
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
  const creativeBindings = keys.map(key=>({schemaVersion:1,id:'tuzi-account-'+key.id,accountOrigin:'https://api.tu-zi.com',userId:'synthetic-user',tokenId:key.id,name:key.name,keyMask:key.masked_key,group:key.group,updatedAt:now}));
  if(command === "creative_account_bindings") return creativeBindings;
  if(command === "creative_account_bind") {
    const request=(args as {request:{generation:number;tokenId:string}}).request;
    const binding=creativeBindings.find(item=>item.tokenId===request.tokenId);
    if(request.generation!==1 || !binding) throw new Error("synthetic binding rejected");
    return binding;
  }
  if(command === "creative_account_request") {
    const {request,onChunk}=args as {request:{action:string;bindingId:string};onChunk:{onmessage:(value:unknown)=>void}};
    if(request.action!=="models" || !creativeBindings.some(item=>item.id===request.bindingId)) throw "creative_action_unsupported";
    if (new URLSearchParams(location.search).has('model-fetch-qa')) {
      creativeModelAttempts += 1;
      window.dispatchEvent(new CustomEvent('synthetic-model-request', { detail: creativeModelAttempts }));
      if (new URLSearchParams(location.search).get('model-fetch-qa') === 'stall' && creativeModelAttempts === 1) {
        await new Promise(() => {}); // Intentionally ignore cancellation to test the UI deadline.
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (creativeModelAttempts === 1) throw 'creative_account_unavailable';
    }
    onChunk.onmessage({type:"start",status:200,content_type:"application/json"});
    onChunk.onmessage({type:"data",data:btoa(JSON.stringify({data:[
      {id:"gpt-image-2",supported_endpoint_types:["image-generation"],endpoints:{"image-generation":{path:"/v1/images/generations",method:"POST"}}},
      {id:"synthetic-chat",supported_endpoint_types:["openai"],endpoints:{"openai":{path:"/v1/chat/completions",method:"POST"}}},
    ]}))});
    onChunk.onmessage({type:"end"});
    return;
  }
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
  if (
    request.method !== "GET" &&
    !(
      request.method === "POST" &&
      request.path === "/account/model-performance/batch"
    )
  )
    throw { code: "synthetic_preview_read_only" };
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
    case "/account/models": {
      const filtered = empty
        ? []
        : models.filter(
            (m) =>
              (!q.search || m.model_name.includes(q.search)) &&
              (!q.vendor || m.vendor_id === q.vendor) &&
              (!q.quota_type || String(m.quota_type) === q.quota_type) &&
              (!q.group || m.enable_groups.includes(q.group)) &&
              (!q.endpoint_type ||
                m.supported_endpoint_types.includes(q.endpoint_type)),
          );
      const size = Number(q.page_size || 12),
        page = Number(q.page || 1);
      return envelope({
        items: filtered
          .slice((page - 1) * size, page * size)
          .map(
            ({ related_pricing, aliases, description_i18n, ...wire }) => wire,
          ),
        pagination: {
          page,
          page_size: size,
          total: String(filtered.length),
          has_more: page * size < filtered.length,
        },
        snapshot_id: "synthetic-snapshot",
        snapshot_refreshed: false,
        api_version: 1,
        schema_version: "v1",
        algorithm_version: "v1",
        pricing_meta: {
          usable_group: { default: "默认分组", Codex: "Codex" },
          base_group_ratio: { default: 1, Codex: 0.8 },
          default_effective_group: "default",
          filter_facets: {
            vendors: {
              OpenAI: 2,
              Anthropic: 1,
              Google: 2,
              DeepSeek: 1,
              Alibaba: 1,
              Moonshot: 1,
            },
            groups: { default: 8 },
            endpoint_types: {
              openai: 6,
              responses: 1,
              anthropic_messages: 1,
              gemini_native: 2,
              Images: 1,
            },
            tags: { 文本: 7, 推理: 5 },
            quota_types: { "1": 8 },
          },
        },
      });
    }
    case "/account/model-performance/batch": {
      const requestedGroups = (request.body as { groups?: string[] }).groups;
      // The API distinguishes omitted (all visible) from [] (no groups).
      const hasGroups =
        requestedGroups === undefined || requestedGroups.includes("default");
      const sample = hasGroups
        ? metric
        : {
            ...metric,
            has_samples: false,
            success_rate: null,
            avg_latency_ms: null,
            avg_ttft_ms: null,
            avg_tps: null,
            half_hour_series: [],
          };
      return envelope(
        ((request.body as { models: string[] }).models ?? []).map((name) => ({
          model_name: name,
          aggregate: sample,
          groups: hasGroups ? [{ ...sample, group: "default" }] : [],
          series_schema: "v1",
        })),
      );
    }
    case "/account/model-performance":
      return envelope({
        model_name: q.model,
        aggregate: metric,
        groups: [{ ...metric, group: "default" }],
        series_schema: "v1",
      });
    case "/account/logs":
      return envelope({
        page: Number(q.page || 1),
        page_size: Number(q.page_size || 10),
        total: empty ? "0" : "20",
        has_more: !empty && Number(q.page || 1) === 1,
        items: empty
          ? []
          : logs.slice(
              (Number(q.page || 1) - 1) * 10,
              Number(q.page || 1) * 10,
            ),
      });
    case "/account/logs/summary":
      return envelope(summary);
    case "/account/logs/statistics":
      return envelope({
        summary,
        trend: empty
          ? []
          : points.map((p) => ({
              ...summary,
              quota: p.quota,
              start_timestamp: p.bucket_start,
              end_timestamp: p.bucket_end,
            })),
        by_model: empty
          ? []
          : models.map((m, i) => ({
              model_name: m.model_name,
              quota: String(21000 * (8 - i)),
              record_count: String(12 - i),
              error_count: i === 2 ? "2" : "0",
            })),
        by_error: empty
          ? []
          : [{ error_code: "rate_limit_exceeded", record_count: "2" }],
      });
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
