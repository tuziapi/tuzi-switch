export interface Envelope<T> {
  success: true;
  message: string;
  data: T;
  meta: { contract_version: string; request_id: string; generated_at: number };
}
export interface DesktopError {
  code: string;
  message?: string;
  status?: number;
  retryAfter?: number;
  outcomeUnknown?: boolean;
}
export interface Money {
  quota_per_unit: string;
  base_currency: "USD";
  display_type: "USD" | "CNY" | "CUSTOM" | "TOKENS";
  usd_exchange_rate: string;
  custom_currency_symbol: string;
  custom_currency_exchange_rate: string;
}
export interface DesktopAccount {
  user_id: string;
  username: string;
  display_name: string;
  status: "enabled";
  group: string;
  quota: string;
  used_quota: string;
  request_count: string;
  money: Money;
}
export interface Capabilities {
  scope_version: string;
  required_scopes: string[];
  release?: { profile: string; overview: boolean; keys: boolean };
  native: Record<
    | "account"
    | "keys"
    | "logs"
    | "usage"
    | "models"
    | "performance"
    | "profile_read"
    | "profile_write",
    boolean
  >;
  web: Record<"topup" | "redemption" | "personal", boolean>;
}
export interface Page<T> {
  page: number;
  page_size: number;
  total: string;
  has_more: boolean;
  items: T[];
}
export interface DesktopKey {
  id: string;
  name: string;
  masked_key: string;
  status: number;
  group: string;
  created_time: number;
  accessed_time: number;
  expired_time: number;
  remain_quota: string;
  unlimited_quota: boolean;
  used_quota: string;
  model_limits_enabled: boolean;
  model_limits: string;
  allow_ips: string | null;
  exclude_ips: string | null;
  is_expired: boolean;
}
export type KeyWrite = Pick<
  DesktopKey,
  | "name"
  | "group"
  | "expired_time"
  | "remain_quota"
  | "unlimited_quota"
  | "model_limits_enabled"
  | "model_limits"
> & { allow_ips?: string; exclude_ips?: string };
export interface Log {
  id: string;
  type: number;
  created_at: number;
  model_name: string;
  token_name: string;
  group: string;
  request_id: string;
  result: "success" | "error" | "unknown";
  billing_status: "charged" | "not_charged" | "refunded" | "unknown";
  quota: string;
  prompt_tokens: string;
  completion_tokens: string;
  duration_ms: number;
  is_stream: boolean;
  error_code: string | null;
  error_message: string | null;
}
export interface Summary {
  record_count: string;
  error_count: string;
  quota: string;
  prompt_tokens: string;
  completion_tokens: string;
  start_timestamp: number;
  end_timestamp: number;
}
export interface UsageValues {
  call_count: string;
  quota: string;
  prompt_tokens: string;
  completion_tokens: string;
}
export interface Usage {
  source: "usage";
  timezone: string;
  start_time: number;
  end_time: number;
  data_as_of: number | null;
  estimated_delay_seconds: number | null;
  chart: (UsageValues & { bucket_start: number; bucket_end: number })[];
  table: (UsageValues & { model_name: string })[];
}
export interface DesktopPricing {
  model_name: string;
  aliases: string[];
  description: string;
  description_i18n: string;
  tags: string;
  vendor_id: string;
  quota_type: number;
  model_ratio: number | null;
  model_price: number | null;
  pricing_unavailable: boolean;
  completion_ratio: number | null;
  enable_groups: string[];
  supported_endpoint_types: string[];
  endpoints: Record<string, unknown> | null;
  billing_mode: string | null;
  billing_expr: string | null;
  pricing_version: string | null;
  related_pricing: DesktopPricing[];
  [field: string]: unknown;
}
export interface Models {
  items: DesktopPricing[];
  pagination: {
    page: number;
    page_size: number;
    total: string;
    has_more: boolean;
  };
  snapshot_id: string;
  snapshot_refreshed: boolean;
  api_version: number;
  schema_version: string;
  algorithm_version: string;
  pricing_meta: Record<string, unknown>;
}
export interface Point {
  ts: number;
  avg_latency_ms: number | null;
  avg_ttft_ms: number | null;
  avg_tps: number | null;
  success_rate: number | null;
  has_samples: boolean;
}
export interface Metric {
  avg_latency_ms: number | null;
  avg_ttft_ms: number | null;
  avg_tps: number | null;
  success_rate: number | null;
  has_samples: boolean;
  sample_level: string;
  ttft_sample_level: string;
  latest_sample_ts: number | null;
  historical_values: Record<string, { value: number; ts: number } | null>;
  half_hour_series: Point[];
}
export interface Performance {
  model_name: string;
  aggregate: Metric;
  groups: (Metric & { group: string })[];
  series_schema: string;
}
export interface Profile {
  user_id: string;
  username: string;
  email: string;
  display_name: string;
  language: string;
  accept_unset_model_ratio_model: boolean;
  high_concurrency_enabled: boolean;
  record_ip_log: boolean;
}
export type ProfileWrite = Pick<
  Profile,
  | "display_name"
  | "language"
  | "accept_unset_model_ratio_model"
  | "high_concurrency_enabled"
  | "record_ip_log"
>;
