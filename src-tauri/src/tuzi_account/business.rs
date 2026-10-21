//! Bounded desktop facade. No caller-controlled origin or authorization headers.
use super::*;
use serde_json::Value;
mod endpoint_compatibility;
use endpoint_compatibility::{endpoint_aliases, supports_protocol};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BusinessRequest {
    method: String,
    path: String,
    #[serde(default)]
    query: Vec<(String, String)>,
    body: Option<Value>,
    generation: u64,
    #[serde(default, rename = "requestId")]
    request_id: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessError {
    pub(super) code: String,
    message: String,
    status: Option<u16>,
    retry_after: Option<u64>,
    field: Option<String>,
    required_scope: Option<String>,
    outcome_unknown: bool,
}
impl BusinessError {
    fn new(code: &str, unknown: bool) -> Self {
        Self {
            code: code.into(),
            message: code.into(),
            status: None,
            retry_after: None,
            field: None,
            required_scope: None,
            outcome_unknown: unknown,
        }
    }
}
impl From<AccountError> for BusinessError {
    fn from(e: AccountError) -> Self {
        let mut result = Self::new(&e.code, false);
        result.retry_after = e.retry_after;
        result
    }
}
fn allowed(method: &str, path: &str) -> bool {
    match (method, path) {
        (
            "GET",
            "/account/account"
            | "/account/capabilities"
            | "/account/keys"
            | "/account/key-groups"
            | "/account/logs"
            | "/account/logs/summary"
            | "/account/logs/statistics"
            | "/account/usage"
            | "/account/usage/summary"
            | "/account/models"
            | "/account/model-performance"
            | "/account/profile",
        ) => true,
        ("POST", "/account/keys" | "/account/model-performance/batch") => true,
        ("PATCH", "/account/profile") => true,
        _ => {
            if let Some(rest) = path.strip_prefix("/account/keys/") {
                let mut parts = rest.split('/');
                let id = parts.next().unwrap_or("");
                if id.is_empty() || id.len() > 19 || !id.bytes().all(|b| b.is_ascii_digit()) {
                    return false;
                }
                let suffix = parts.next();
                if parts.next().is_some() {
                    return false;
                }
                return matches!(
                    (method, suffix),
                    ("GET" | "PATCH" | "DELETE", None)
                        | ("PATCH", Some("status"))
                        | ("POST", Some("reveal"))
                        | ("GET", Some("models"))
                );
            }
            if method == "GET" {
                if let Some(id) = path.strip_prefix("/account/logs/requests/") {
                    return !id.is_empty()
                        && id.len() <= 768
                        && id != "."
                        && id != ".."
                        && !id.chars().any(|c| {
                            c == '/' || c == '\\' || c == '?' || c == '#' || c.is_control()
                        })
                        && !id.to_ascii_lowercase().contains("%2f")
                        && !id.to_ascii_lowercase().contains("%5c")
                        && !id.to_ascii_lowercase().contains("%2e");
                }
            }
            false
        }
    }
}
// Logical IPC operations are translated here; none are website routes.
struct Route {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    body: Option<Value>,
}
fn invalid() -> BusinessError {
    BusinessError::new("invalid_request", false)
}
fn envelope(data: Value) -> Value {
    serde_json::json!({"success":true,"message":"","data":data,"meta":{"contract_version":"system-token-v1","request_id":uuid::Uuid::new_v4().to_string(),"generated_at":now()}})
}
fn capabilities() -> Value {
    serde_json::json!({"scope_version":"system-token-v1","required_scopes":[],"release":{"profile":"phase1","overview":true,"keys":true},"native":{"account":true,"keys":true,"logs":true,"usage":true,"models":true,"performance":true,"profile_read":true,"profile_write":true},"web":{"topup":true,"redemption":true,"personal":true}})
}
impl Route {
    fn new(r: &BusinessRequest) -> Result<Self, BusinessError> {
        let p = r.path.as_str();
        let fields=match p {
            "/account/keys" if r.method=="GET"=>"page page_size keyword token group status",
            "/account/logs"|"/account/logs/summary"|"/account/logs/statistics"=>"page page_size start_timestamp end_timestamp type token_name model_name group request_id upstream_request_id request_path error_keyword interval_seconds",
            "/account/usage"|"/account/usage/summary"=>"start_time end_time timezone interval_seconds model_name",
            "/account/models"=>"page page_size snapshot_id search group quota_type endpoint_type vendor tag models",
            "/account/model-performance"=>"model hours resolution group groups",
            _=>"",
        };
        let mut seen = std::collections::HashSet::new();
        for (k, _) in &r.query {
            if !fields.split_whitespace().any(|f| f == k)
                || (!seen.insert(k)
                    && ![
                        "models",
                        "groups",
                        "quota_type",
                        "endpoint_type",
                        "vendor",
                        "tag",
                    ]
                    .contains(&k.as_str()))
            {
                return Err(invalid());
            }
        }
        let mut query = r.query.clone();
        if p == "/account/keys" && r.method == "GET" {
            for (name, value) in &mut query {
                if name == "token" && !value.is_empty() {
                    // Renderer supplies only the last four characters, never a Key.
                    if value.len() != 4 || !value.bytes().all(|c| c.is_ascii_alphanumeric()) {
                        return Err(BusinessError::new("invalid_key_suffix", false));
                    }
                    *value = format!("%{value}");
                }
            }
        }
        let mut body = r.body.clone();
        if let Some(b) = body.as_mut() {
            let allowed = if p == "/account/profile" {
                "display_name language accept_unset_model_ratio_model high_concurrency_enabled record_ip_log"
            } else if p == "/account/model-performance/batch" {
                "models groups hours resolution"
            } else if p == "/account/keys" || p.starts_with("/account/keys/") {
                "name status expired_time remain_quota unlimited_quota model_limits_enabled model_limits allow_ips exclude_ips group"
            } else {
                return Err(invalid());
            };
            let obj = b.as_object_mut().ok_or_else(invalid)?;
            if obj.is_empty()
                || obj
                    .iter()
                    .any(|(k, v)| v.is_null() || !allowed.split_whitespace().any(|f| f == k))
            {
                return Err(invalid());
            }
            if let Some(v) = obj.get_mut("remain_quota") {
                if let Some(s) = v.as_str() {
                    *v = serde_json::json!(s.parse::<i64>().map_err(|_| invalid())?);
                }
            }
            if r.method == "POST" && p == "/account/model-performance/batch" {
                if let Some(v) = obj.get_mut("resolution") {
                    if v == "30m" {
                        *v = Value::String("half_hourly".into());
                    }
                }
            }
        }
        if matches!(r.method.as_str(), "PATCH") && body.is_none() {
            return Err(invalid());
        }
        if (r.method == "DELETE" || p.ends_with("/reveal")) && body.is_some() {
            return Err(invalid());
        }
        let path = match p {
            "/account/account" | "/account/profile" => "/api/user/self".into(),
            "/account/capabilities" => String::new(),
            "/account/keys" => "/api/token/".into(),
            "/account/key-groups" => "/api/token/group".into(),
            "/account/logs" => "/api/log/self".into(),
            "/account/logs/summary" | "/account/logs/statistics" | "/account/usage/summary" => {
                "/api/log/self/stat".into()
            }
            "/account/usage" => "/api/data/consumption_stats".into(),
            "/account/models" => "/api/pricing/models".into(),
            "/account/model-performance" => "/api/perf-metrics".into(),
            "/account/model-performance/batch" => "/api/perf-metrics/batch".into(),
            _ if p.starts_with("/account/keys/") => format!(
                "/api/token/{}",
                p.trim_start_matches("/account/keys/")
                    .trim_end_matches("/status")
                    .replace("/reveal", "/key")
            ),
            _ if p.starts_with("/account/logs/requests/") => format!(
                "/api/log/self/request/{}",
                p.trim_start_matches("/account/logs/requests/")
            ),
            _ => return Err(invalid()),
        };
        if p == "/account/keys" || p == "/account/logs" {
            for (k, _) in &mut query {
                if k == "page" {
                    *k = "p".into();
                }
            }
        }
        if p.starts_with("/account/usage")
            || [
                "/account/logs",
                "/account/logs/summary",
                "/account/logs/statistics",
            ]
            .contains(&p)
        {
            let usage = p.starts_with("/account/usage");
            let a = if usage {
                "start_time"
            } else {
                "start_timestamp"
            };
            let z = if usage { "end_time" } else { "end_timestamp" };
            let start = query
                .iter()
                .find(|(k, _)| k == a)
                .map(|(_, v)| v.parse::<i64>())
                .transpose()
                .map_err(|_| invalid())?;
            let end = query
                .iter()
                .find(|(k, _)| k == z)
                .map(|(_, v)| v.parse::<i64>())
                .transpose()
                .map_err(|_| invalid())?;
            if start.is_some() != end.is_some() {
                return Err(invalid());
            }
            let (start, end) = (start.unwrap_or(now() - 7 * 86400), end.unwrap_or(now()));
            if start < 0 || end <= start || end - start > 90 * 86400 {
                return Err(invalid());
            }
            query.retain(|(k, _)| k != a && k != z);
            query.push((a.into(), start.to_string()));
            query.push((
                z.into(),
                if p == "/account/logs" { end - 1 } else { end }.to_string(),
            ));
            if usage && !query.iter().any(|(k, v)| k == "timezone" && !v.is_empty()) {
                return Err(invalid());
            }
        }
        if p == "/account/usage" {
            query.retain(|(k, _)| k != "timezone");
            query.extend([
                ("self".into(), "true".into()),
                ("source".into(), "usage".into()),
            ]);
        }
        if p == "/account/usage/summary" {
            query.retain(|(k, _)| k != "timezone" && k != "interval_seconds");
            for (k, _) in &mut query {
                if k == "start_time" {
                    *k = "start_timestamp".into();
                }
                if k == "end_time" {
                    *k = "end_timestamp".into();
                }
            }
        }
        if path == "/api/log/self/stat" {
            query.retain(|(k, _)| k != "page" && k != "page_size");
            query.push(("summary".into(), "true".into()));
            if p.ends_with("/statistics") {
                query.push(("statistics".into(), "true".into()));
            }
        }
        if p == "/account/model-performance" {
            for (k, v) in &mut query {
                if k == "group" || k == "groups" {
                    *k = "groups_v2".into();
                }
                if k == "resolution" && v == "30m" {
                    *v = "half_hourly".into();
                }
            }
        }
        Ok(Self {
            method: r.method.clone(),
            path,
            query,
            body,
        })
    }
}
fn pick(v: &Value, fields: &str) -> Value {
    let mut out = serde_json::Map::new();
    for k in fields.split_whitespace() {
        out.insert(k.into(), v[k].clone());
    }
    Value::Object(out)
}
fn decimal(v: &Value) -> Result<Value, BusinessError> {
    if let Some(s) = v.as_str() {
        if s.parse::<i128>().is_ok() {
            return Ok(Value::String(s.into()));
        }
    }
    if v.as_i64().is_some() || v.as_u64().is_some() {
        return Ok(Value::String(v.to_string()));
    }
    Err(BusinessError::new("invalid_response", false))
}
fn strings(v: &mut Value, fields: &str) -> Result<(), BusinessError> {
    for k in fields.split_whitespace() {
        v[k] = decimal(&v[k])?;
    }
    Ok(())
}
fn key(v: &Value) -> Result<Value, BusinessError> {
    let mut d=pick(v,"id name status group created_time accessed_time expired_time remain_quota unlimited_quota used_quota model_limits_enabled model_limits allow_ips exclude_ips is_expired");
    strings(&mut d, "id remain_quota used_quota")?;
    d["masked_key"] = v["key"].clone();
    Ok(d)
}
fn page(
    v: &Value,
    mapper: fn(&Value) -> Result<Value, BusinessError>,
) -> Result<Value, BusinessError> {
    let mut d = pick(v, "page page_size total");
    let items = v["items"]
        .as_array()
        .ok_or_else(|| BusinessError::new("invalid_response", false))?;
    d["items"] = Value::Array(items.iter().map(mapper).collect::<Result<_, _>>()?);
    d["has_more"] = serde_json::json!(
        v["page"].as_u64().unwrap_or(1) * v["page_size"].as_u64().unwrap_or(10)
            < v["total"].as_u64().unwrap_or(0)
    );
    strings(&mut d, "total")?;
    Ok(d)
}
fn log(v: &Value) -> Result<Value, BusinessError> {
    let other: Value =
        serde_json::from_str(v["other"].as_str().unwrap_or("{}")).unwrap_or(Value::Null);
    let mut d=pick(v,"id type created_at model_name token_name request_id quota prompt_tokens completion_tokens is_stream");
    strings(&mut d, "id quota prompt_tokens completion_tokens")?;
    d["group"] = v["token_group"].clone();
    d["duration_ms"] = serde_json::json!(v["use_time"].as_i64().unwrap_or(0).saturating_mul(1000));
    let result = match other["call_status"].as_str() {
        Some("success") => "success",
        Some("error" | "error_charged") => "error",
        _ if v["type"] == 6 => "error",
        _ => "unknown",
    };
    d["result"] = result.into();
    d["billing_status"] = if v["type"] == 7 || other["refunded"] == true {
        "refunded"
    } else {
        match other["billing_status"].as_str() {
            Some("charged") => "charged",
            Some("not_charged") => "not_charged",
            _ => "unknown",
        }
    }
    .into();
    d["error_message"] = Value::Null;
    d["error_code"] = if result == "error" {
        let c = other["error_code"].as_str().unwrap_or("");
        Value::String(
            if [
                "upstream_error",
                "rate_limited",
                "timeout",
                "validation_error",
                "policy_denied",
            ]
            .contains(&c)
            {
                c
            } else {
                "unknown_error"
            }
            .into(),
        )
    } else {
        Value::Null
    };
    Ok(d)
}
fn summary(v: &Value) -> Result<Value, BusinessError> {
    if v["logs_available"] == false {
        return Err(BusinessError::new("logs_unavailable", false));
    }
    let mut d=pick(v,"record_count error_count quota prompt_tokens completion_tokens refund_quota start_timestamp end_timestamp coverage");
    strings(
        &mut d,
        "record_count error_count quota prompt_tokens completion_tokens refund_quota",
    )?;
    Ok(d)
}
fn usage_meta(r: &BusinessRequest, route: &Route) -> Value {
    let find = |key: &str| {
        r.query
            .iter()
            .chain(route.query.iter())
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    serde_json::json!({"source":"usage","timezone":find("timezone"),"start_time":find("start_time").parse::<i64>().unwrap_or(0),"end_time":find("end_time").parse::<i64>().unwrap_or(0),"data_as_of":null,"estimated_delay_seconds":null,"coverage":"recorded_logs_only"})
}
fn metric(v: &Value) -> Value {
    let mut d = pick(
        v,
        "group has_samples sample_level ttft_sample_level latest_sample_ts historical_values",
    );
    let has = v["has_samples"] == true;
    for k in ["avg_latency_ms", "avg_ttft_ms", "avg_tps", "success_rate"] {
        d[k] = if has && (k != "avg_ttft_ms" || v["ttft_sample_level"] != "none") {
            v[k].clone()
        } else {
            Value::Null
        };
    }
    if !has {
        d["latest_sample_ts"] = Value::Null;
    }
    d["historical_values"] = pick(
        &v["historical_values"],
        "success_rate avg_latency_ms avg_ttft_ms",
    );
    d["half_hour_series"] = Value::Array(
        v["half_hour_series"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| {
                let mut d = pick(p, "ts has_samples");
                for k in ["avg_latency_ms", "avg_ttft_ms", "avg_tps", "success_rate"] {
                    d[k] = if p["has_samples"] == true
                        && (k != "avg_ttft_ms" || p["has_ttft"] == true)
                    {
                        p[k].clone()
                    } else {
                        Value::Null
                    };
                }
                d
            })
            .collect(),
    );
    d
}
fn performance(v: &Value) -> Value {
    serde_json::json!({"model_name":v["model_name"],"series_schema":v["series_schema"],"aggregate":metric(&v["aggregate"]),"groups":v["groups"].as_array().into_iter().flatten().map(metric).collect::<Vec<_>>()})
}
fn project(
    r: &BusinessRequest,
    route: &Route,
    raw: Value,
    status: Option<Value>,
) -> Result<Value, BusinessError> {
    let v = &raw["data"];
    let p = r.path.as_str();
    match p {
        "/account/account" => {
            let mut d = pick(
                v,
                "username display_name group quota used_quota request_count",
            );
            d["user_id"] = decimal(&v["id"])?;
            d["status"] = "enabled".into();
            strings(&mut d, "quota used_quota request_count")?;
            let s = status.ok_or_else(|| BusinessError::new("invalid_response", false))?;
            let s = &s["data"];
            let number = |k: &str| -> Result<String, BusinessError> {
                if s[k].is_number() {
                    Ok(s[k].to_string())
                } else {
                    Err(BusinessError::new("invalid_response", false))
                }
            };
            d["money"] = serde_json::json!({"base_currency":"USD","quota_per_unit":number("quota_per_unit")?,"display_type":s["quota_display_type"],"usd_exchange_rate":number("usd_exchange_rate")?,"custom_currency_symbol":s["custom_currency_symbol"],"custom_currency_exchange_rate":number("custom_currency_exchange_rate")?});
            Ok(d)
        }
        "/account/profile" => {
            let settings: Value = serde_json::from_str(v["setting"].as_str().unwrap_or("{}"))
                .map_err(|_| BusinessError::new("invalid_response", false))?;
            let mut d = pick(v, "username display_name email");
            d["user_id"] = decimal(&v["id"])?;
            d["language"] = settings["language"].as_str().unwrap_or("en").into();
            for k in ["accept_unset_model_ratio_model", "high_concurrency_enabled"] {
                d[k] = serde_json::json!(settings[k].as_bool().unwrap_or(false));
            }
            // Website legacy settings treat missing/null IP logging as enabled.
            d["record_ip_log"] =
                serde_json::json!(settings["record_ip_log"].as_bool().unwrap_or(true));
            Ok(d)
        }
        "/account/keys" if r.method == "GET" => page(v, key),
        "/account/keys" => {
            let mut d = pick(v, "id key");
            strings(&mut d, "id")?;
            prefix_key(&mut d)?;
            Ok(d)
        }
        "/account/key-groups" => Ok(Value::Array(
            v.as_array()
                .ok_or_else(|| BusinessError::new("invalid_response", false))?
                .iter()
                .map(|g| serde_json::json!({"id":g["value"],"label":g["key"]}))
                .collect(),
        )),
        "/account/logs" => page(v, log),
        "/account/logs/summary" => summary(v),
        "/account/logs/statistics" => {
            let mut d = serde_json::json!({"summary":summary(&v["summary"])?});
            for k in ["trend", "by_model", "by_error"] {
                let mut rows = v[k]
                    .as_array()
                    .ok_or_else(|| BusinessError::new("invalid_response", false))?
                    .clone();
                for row in &mut rows {
                    for field in [
                        "record_count",
                        "error_count",
                        "quota",
                        "prompt_tokens",
                        "completion_tokens",
                        "refund_quota",
                    ] {
                        if row.get(field).is_some() {
                            row[field] = decimal(&row[field])?;
                        }
                    }
                }
                d[k] = Value::Array(rows);
            }
            Ok(d)
        }
        "/account/usage/summary" => {
            if v["logs_available"] != true {
                return Err(BusinessError::new("logs_unavailable", false));
            }
            let mut d = usage_meta(r, route);
            for k in [
                "quota",
                "prompt_tokens",
                "completion_tokens",
                "refund_quota",
            ] {
                d[k] = decimal(&v[k])?;
            }
            d["call_count"] = decimal(&v["request_count"])?;
            Ok(d)
        }
        "/account/usage" => {
            let mut d = usage_meta(r, route);
            d["chart"] = usage_rows(&v["chart"], true)?;
            d["table"] = usage_rows(&v["table"], false)?;
            Ok(d)
        }
        "/account/models" => {
            let mut pagination = raw["pagination"].clone();
            strings(&mut pagination, "total")?;
            Ok(
                serde_json::json!({"items":v,"pagination":pagination,"snapshot_id":raw["snapshot_id"],"snapshot_refreshed":raw["snapshot_refreshed"].as_bool().unwrap_or(false),"api_version":raw["api_version"],"schema_version":raw["schema_version"],"algorithm_version":raw["algorithm_version"],"pricing_meta":raw["meta"]}),
            )
        }
        "/account/model-performance" => Ok(performance(v)),
        "/account/model-performance/batch" => Ok(Value::Array(
            v.as_array()
                .ok_or_else(|| BusinessError::new("invalid_response", false))?
                .iter()
                .map(performance)
                .collect(),
        )),
        _ if p.starts_with("/account/keys/") => {
            if r.method == "DELETE" {
                return Ok(serde_json::json!({}));
            }
            if p.ends_with("/reveal") {
                let mut d = pick(v, "key");
                prefix_key(&mut d)?;
                Ok(d)
            } else {
                key(v)
            }
        }
        _ if p.starts_with("/account/logs/requests/") => {
            let rows = v
                .as_array()
                .ok_or_else(|| BusinessError::new("invalid_response", false))?;
            Ok(
                serde_json::json!({"request_id":p.trim_start_matches("/account/logs/requests/"),"items":rows.iter().take(100).map(log).collect::<Result<Vec<_>,_>>()?,"has_more":rows.len()>100}),
            )
        }
        _ => Err(invalid()),
    }
}
// 临时本地模型夹具：仅供测试模型选择与工具配置流程。
// 默认关闭：AccountService 的 project() 调用后，夹具入口的两行代码已注释。
// 需要时同时恢复该处 cfg 属性和函数调用，再重新构建并重启本地预览。
// 仅 local-preview + http://127.0.0.1:5180 生效；普通构建不包含此函数，
// release 构建禁止 local-preview（见 mod.rs），不要移除这些隔离条件。
// 开启后为 default 分组补入/替换 gpt-5.6-sol 的 Responses 元数据；
// 列表和保存前校验共用，仍遵守 Key 权限，不配置 API 渠道，也不证明模型可调用。
#[cfg(feature = "local-preview")]
fn local_configuration_fixture(origin: &str, request: &BusinessRequest, mut data: Value) -> Value {
    const NAME: &str = "gpt-5.6-sol";
    if origin != "http://127.0.0.1:5180" || request.path != "/account/models" {
        return data;
    }
    let matches = request.query.iter().all(|(k, v)| match k.as_str() {
        "page" => v == "1",
        "search" => NAME.contains(&v.to_lowercase()),
        "group" => v == "default",
        "endpoint_type" => v == "openai-response",
        "vendor" | "tag" => v.is_empty(),
        _ => true,
    });
    let names: Vec<_> = request
        .query
        .iter()
        .filter(|(k, _)| k == "models")
        .collect();
    if !matches
        || (!names.is_empty() && !names.iter().any(|(_, v)| v.split(',').any(|n| n == NAME)))
    {
        return data;
    }
    let Some(items) = data["items"].as_array_mut() else {
        return data;
    };
    let existing = items.iter().position(|item| item["model_name"] == NAME);
    let fixture = serde_json::json!({
        "model_name": NAME, "aliases": [], "description": "Local configuration fixture",
        "description_i18n": "", "tags": "", "vendor_id": "local-preview",
        "quota_type": 0, "model_ratio": null, "model_price": null,
        "pricing_unavailable": true, "completion_ratio": null,
        "enable_groups": ["default"], "supported_endpoint_types": ["openai-response"],
        "endpoints": {"openai-response": {"path": "/v1/responses", "method": "POST"}},
        "billing_mode": null, "billing_expr": null, "pricing_version": null, "related_pricing": []
    });
    if let Some(index) = existing {
        items[index] = fixture;
    } else {
        items.push(fixture);
    }
    if existing.is_none() {
        if let Some(total) = data["pagination"]["total"]
            .as_str()
            .and_then(|v| v.parse::<u64>().ok())
        {
            data["pagination"]["total"] = (total + 1).to_string().into();
        }
    }
    data
}

fn prefix_key(d: &mut Value) -> Result<(), BusinessError> {
    let key = d["key"]
        .as_str()
        .filter(|s| !s.is_empty() && !s.contains(['\r', '\n']))
        .ok_or_else(|| BusinessError::new("invalid_response", false))?;
    d["key"] = if key.starts_with("sk-") {
        key.into()
    } else {
        format!("sk-{key}").into()
    };
    Ok(())
}

fn validate_tool_key(key: &Value, timestamp: i64) -> Result<(), String> {
    let denied = || "provider_selection_not_qualified".to_string();
    if key["status"].as_i64() != Some(1) {
        return Err(denied());
    }
    let expiry = key["expired_time"].as_i64().ok_or_else(denied)?;
    if expiry != -1 && expiry <= timestamp {
        return Err(denied());
    }
    if key["unlimited_quota"].as_bool() != Some(true) {
        let quota = key["remain_quota"]
            .as_str()
            .and_then(|v| v.parse::<i128>().ok())
            .ok_or_else(denied)?;
        if quota <= 0 {
            return Err(denied());
        }
    }
    Ok(())
}

fn qualified_models(
    key: &Value,
    data: &Value,
    names: &[String],
    protocol: &str,
    timestamp: i64,
    require_protocol_metadata: bool,
) -> Result<(), String> {
    validate_tool_key(key, timestamp)?;
    let denied = || "provider_selection_not_qualified".to_string();
    let limits: Vec<&str> = key["model_limits"]
        .as_str()
        .ok_or_else(denied)?
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    let items = data["items"].as_array().ok_or_else(denied)?;
    for name in names {
        if key["model_limits_enabled"].as_bool() == Some(true)
            && !limits.is_empty()
            && !limits.contains(&name.as_str())
        {
            return Err(denied());
        }
        let model = items
            .iter()
            .find(|m| m["model_name"].as_str() == Some(name.as_str()))
            .ok_or_else(denied)?;
        if require_protocol_metadata && !supports_protocol(model, protocol) {
            return Err(denied());
        }
    }
    Ok(())
}
impl AccountService {
    /// Re-read current account Key and visible models before local side effects.
    /// This never holds the account mutex across await; save subsequently takes
    /// the reveal/source guard to reject a generation change during these reads.
    pub async fn provider_qualification(
        &self,
        generation: u64,
        token_id: &str,
        selected_models: &[String],
        protocol: &str,
        app: &str,
    ) -> Result<(), String> {
        if token_id.parse::<u64>().ok().filter(|n| *n > 0).is_none()
            || selected_models.is_empty()
            || selected_models.len() > 50
            || selected_models
                .iter()
                .any(|m| m.is_empty() || m.len() > 256)
            || endpoint_aliases(protocol).is_empty()
        {
            return Err("invalid_provider_selection".into());
        }
        let data = self
            .key_model_catalog(generation, token_id)
            .await
            .map_err(|e| e.code)?;
        // Codex mirrors manual /v1/models selection. Metadata is descriptive,
        // not a complete statement of relay Responses support.
        qualified_models(
            &data["key"],
            &data,
            selected_models,
            protocol,
            now(),
            app != "codex",
        )
    }

    // Fixed origin, owned Key only. Listing does not reveal the secret to the
    // renderer or create/consume the one-use proof used by provider_save.
    async fn key_model_catalog(
        &self,
        generation: u64,
        token_id: &str,
    ) -> Result<Value, BusinessError> {
        let token = self.business_tokens(generation)?;
        let request = |method, suffix: &str| {
            self.http
                .request(
                    method,
                    format!("{}/api/token/{}{}", self.origin, token_id, suffix),
                )
                .bearer_auth(&token.access_token)
                .header("New-Api-User", &token.user_id)
                .timeout(Duration::from_secs(15))
        };
        let detail = self
            .business_response(request(reqwest::Method::GET, ""), false)
            .await?;
        let current_key = key(&detail["data"])?;
        validate_tool_key(&current_key, now())
            .map_err(|_| BusinessError::new("provider_selection_not_qualified", false))?;
        self.business_tokens(generation)?;
        let revealed = self
            .business_response(request(reqwest::Method::POST, "/key"), false)
            .await?;
        let mut secret = pick(&revealed["data"], "key");
        prefix_key(&mut secret)?;
        let secret =
            zeroize::Zeroizing::new(secret["key"].as_str().ok_or_else(invalid)?.to_owned());
        self.business_tokens(generation)?;
        let response = self
            .http
            .get(format!("{}/v1/models", self.origin))
            .bearer_auth(secret.as_str())
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|_| BusinessError::new("network_uncertain", false))?;
        let models = crate::services::model_fetch::read_models_response(response)
            .await
            .map_err(|_| BusinessError::new("model_list_unavailable", false))?;
        self.business_tokens(generation)?;
        let limits: Vec<_> = current_key["model_limits"]
            .as_str()
            .unwrap_or("")
            .split(',')
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .collect();
        let items: Vec<_> = models.into_iter()
            .filter(|m| current_key["model_limits_enabled"] != true || limits.is_empty() || limits.contains(&m.id.as_str()))
            .map(|m| serde_json::json!({"model_name":m.id,"supported_endpoint_types":m.supported_endpoint_types,"endpoints":m.endpoints})).collect();
        Ok(serde_json::json!({"items":items,"key":current_key}))
    }

    fn business_tokens(&self, generation: u64) -> Result<Tokens, BusinessError> {
        self.load();
        let i = self.inner.lock().unwrap();
        if i.record.generation != generation {
            return Err(BusinessError::new("stale_account", false));
        }
        if i.state.identity.is_none()
            || !matches!(
                i.state.status.as_str(),
                "connected" | "offline" | "refreshing"
            )
        {
            return Err(BusinessError::new("invalid_token", false));
        }
        i.record
            .tokens
            .clone()
            .ok_or_else(|| BusinessError::new("invalid_token", false))
    }
    pub async fn business_request(&self, request: BusinessRequest) -> Result<Value, BusinessError> {
        let id = request
            .request_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if id.len() > 128 || id.is_empty() {
            return Err(BusinessError::new("invalid_request", false));
        }
        let (sender, receiver) = tokio::sync::watch::channel(false);
        {
            let mut pending = self.business_pending.lock().unwrap();
            if pending.len() >= 128 || pending.contains_key(&id) {
                return Err(BusinessError::new("conflict", false));
            }
            pending.insert(id.clone(), sender);
        }
        let result = self.business_request_inner(request, receiver).await;
        self.business_pending.lock().unwrap().remove(&id);
        result
    }
    async fn business_request_inner(
        &self,
        request: BusinessRequest,
        mut cancellation: tokio::sync::watch::Receiver<bool>,
    ) -> Result<Value, BusinessError> {
        if !allowed(&request.method, &request.path)
            || request.query.len() > 300
            || request
                .query
                .iter()
                .any(|(k, v)| k.len() > 128 || v.len() > 2048)
            || request.method == "GET" && request.body.is_some()
        {
            return Err(BusinessError::new("invalid_request", false));
        }
        let body = request
            .body
            .as_ref()
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| BusinessError::new("invalid_request", false))?;
        let max = if request.path == "/account/model-performance/batch" {
            16384
        } else {
            65536
        };
        if body.as_ref().is_some_and(|v| v.len() > max) {
            return Err(BusinessError::new("invalid_request", false));
        }
        let readonly = request.method == "GET";
        let token = self.business_tokens(request.generation)?;
        if let Some(token_id) = request
            .path
            .strip_prefix("/account/keys/")
            .and_then(|p| p.strip_suffix("/models"))
        {
            if !request.query.is_empty() {
                return Err(invalid());
            }
            if *cancellation.borrow() {
                return Err(BusinessError::new("request_cancelled", false));
            }
            let result = tokio::select! {
                result = self.key_model_catalog(request.generation, token_id) => result,
                _ = cancellation.changed() => Err(BusinessError::new("request_cancelled", false)),
            };
            self.business_tokens(request.generation)?;
            if let Err(e) = &result {
                if matches!(
                    e.code.as_str(),
                    "invalid_token" | "account_disabled" | "identity_mismatch"
                ) {
                    self.fail(request.generation, AccountError::new(&e.code), true);
                }
            }
            return result.map(|data| envelope(serde_json::json!({"items":data["items"]})));
        }
        let route = Route::new(&request)?;
        if request.path == "/account/capabilities" {
            return Ok(envelope(capabilities()));
        }
        let mut retries = 0;
        loop {
            if *cancellation.borrow() {
                return Err(BusinessError::new("request_cancelled", false));
            }
            self.business_tokens(request.generation)?;
            let mut builder = self
                .http
                .request(
                    reqwest::Method::from_bytes(route.method.as_bytes()).unwrap(),
                    format!("{}{}", self.origin, route.path),
                )
                .timeout(Duration::from_secs(30))
                .bearer_auth(&token.access_token)
                .header("New-Api-User", &token.user_id)
                .header("Accept", "application/json")
                .query(&route.query);
            if let Some(body) = &route.body {
                builder = builder.json(body);
            }
            let result = tokio::select! {
                result=self.business_response(builder,!readonly)=>result,
                _=cancellation.changed()=>Err(BusinessError::new("request_cancelled",!readonly)),
            };
            self.business_tokens(request.generation)?;
            match result {
                Err(e)
                    if matches!(
                        e.code.as_str(),
                        "invalid_token" | "account_disabled" | "identity_mismatch"
                    ) =>
                {
                    self.fail(request.generation, AccountError::new(&e.code), true);
                    return Err(e);
                }
                Err(e)
                    if readonly
                        && retries < 2
                        && (e.code == "network_uncertain"
                            || e.status.is_some_and(|s| s >= 500)) =>
                {
                    retries += 1;
                    let delay = e.retry_after.unwrap_or(retries);
                    if delay > 2 {
                        return Err(e);
                    }
                    tokio::time::sleep(Duration::from_millis(
                        delay * 1000 + rand::random::<u8>() as u64,
                    ))
                    .await;
                }
                Ok(raw) => {
                    let status = if request.path == "/account/account" {
                        Some(
                            self.business_response(
                                self.http.get(format!("{}/api/status", self.origin)),
                                false,
                            )
                            .await?,
                        )
                    } else {
                        None
                    };
                    if request.path == "/account/usage" {
                        let range = route
                            .query
                            .iter()
                            .filter(|(k, _)| k == "start_time" || k == "end_time")
                            .map(|(k, v)| {
                                (
                                    if k == "start_time" {
                                        "start_timestamp"
                                    } else {
                                        "end_timestamp"
                                    }
                                    .to_string(),
                                    v.clone(),
                                )
                            })
                            .chain(std::iter::once(("summary".into(), "true".into())))
                            .collect::<Vec<_>>();
                        let coverage = self
                            .business_response(
                                self.http
                                    .get(format!("{}/api/log/self/stat", self.origin))
                                    .bearer_auth(&token.access_token)
                                    .header("New-Api-User", &token.user_id)
                                    .query(&range),
                                false,
                            )
                            .await?;
                        if coverage["data"]["logs_available"] != true {
                            return Err(BusinessError::new("logs_unavailable", false));
                        }
                    }
                    self.business_tokens(request.generation)?;
                    let data = project(&request, &route, raw, status)?;
                    // 临时夹具入口（默认关闭）：需要本地测试时同时取消下面两行的注释。
                    // 在仓库根目录运行 bash scripts/build-local-preview.sh 后重启新预览；
                    // 测试结束重新注释这两行并重建。关闭时直接使用 API 返回的模型数据。
                    // #[cfg(feature = "local-preview")]
                    // let data = local_configuration_fixture(&self.origin, &request, data);
                    if request.method == "POST" {
                        if let Some(token_id) = request
                            .path
                            .strip_prefix("/account/keys/")
                            .and_then(|s| s.strip_suffix("/reveal"))
                        {
                            self.remember_model_key_reveal(
                                request.generation,
                                token_id,
                                data["key"]
                                    .as_str()
                                    .ok_or_else(|| BusinessError::new("invalid_response", false))?,
                            )?;
                        }
                    }
                    return Ok(envelope(data));
                }
                Err(e) => return Err(e),
            }
        }
    }
    pub(super) async fn business_response(
        &self,
        builder: reqwest::RequestBuilder,
        write: bool,
    ) -> Result<Value, BusinessError> {
        let mut response = builder
            .send()
            .await
            .map_err(|_| BusinessError::new("network_uncertain", write))?;
        let status = response.status().as_u16();
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|x| x.to_str().ok())
            .and_then(|x| x.parse().ok());
        let mut bytes = zeroize::Zeroizing::new(Vec::new());
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| BusinessError::new("network_uncertain", write))?
        {
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err(BusinessError::new("invalid_response", write));
            }
            bytes.extend_from_slice(&chunk);
        }
        let data: Value = match serde_json::from_slice(&bytes) {
            Ok(data) => data,
            Err(_) if !(200..300).contains(&status) => Value::Null,
            Err(_) => return Err(BusinessError::new("invalid_response", write)),
        };
        if (200..300).contains(&status) && data["success"] == true {
            return Ok(data);
        }
        let code = match status {
            200..=299 => "business_error",
            400 => "invalid_request",
            401 => "invalid_token",
            403 => "insufficient_scope",
            404 => "not_found",
            409 => "conflict",
            429 => "rate_limited",
            503 => "dependency_unavailable",
            _ => "server_error",
        };
        let mut e = BusinessError::new(code, write && status >= 500);
        e.status = Some(status);
        e.retry_after = retry;
        let symbol = data["error"]["code"]
            .as_str()
            .unwrap_or("")
            .to_ascii_lowercase();
        if [
            "invalid_token",
            "account_disabled",
            "identity_mismatch",
            "session_expired",
            "invalid_request",
            "not_found",
            "conflict",
            "dependency_unavailable",
            "logs_unavailable",
            "snapshot_changed",
        ]
        .contains(&symbol.as_str())
        {
            e.code = if symbol == "session_expired" {
                "invalid_token".into()
            } else {
                symbol
            };
            e.message = e.code.clone();
        }

        Err(e)
    }
}
#[tauri::command]
pub async fn account_request(
    service: tauri::State<'_, Arc<AccountService>>,
    request: BusinessRequest,
) -> Result<Value, BusinessError> {
    service.business_request(request).await
}
#[tauri::command]
pub fn account_cancel_request(service: tauri::State<'_, Arc<AccountService>>, request_id: String) {
    if let Some(sender) = service.business_pending.lock().unwrap().get(&request_id) {
        let _ = sender.send(true);
    }
}
fn web_target(target: &str) -> Option<&'static str> {
    #[cfg(feature = "local-preview")]
    match target {
        "topup" | "redemption" => return Some("http://127.0.0.1:5180/console/topup"),
        "personal" => return Some("http://127.0.0.1:5180/console/personal"),
        _ => {}
    }
    match target {
        "topup" | "redemption" => Some("https://api.tu-zi.com/console/topup"),
        "personal" => Some("https://api.tu-zi.com/console/personal"),
        "coding" => Some("https://coding.tu-zi.com/reseller/"),
        "gaccode" => Some("https://gaccode.com/subscriptions"),
        _ => None,
    }
}
#[tauri::command]
pub async fn account_open_web(app: tauri::AppHandle, target: String) -> Result<(), BusinessError> {
    let url = web_target(&target).ok_or_else(|| BusinessError::new("invalid_request", false))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| BusinessError::new("browser_unavailable", false))
}

#[cfg(test)]
mod tests {
    #[test]
    fn key_suffix_is_mapped_to_a_suffix_pattern_without_accepting_full_secrets() {
        let mut request = BusinessRequest {
            method: "GET".into(),
            path: "/account/keys".into(),
            query: vec![("token".into(), "aB19".into())],
            body: None,
            generation: 1,
            request_id: None,
        };
        let route = Route::new(&request).unwrap();
        assert_eq!(route.path, "/api/token/");
        assert_eq!(route.query, vec![("token".into(), "%aB19".into())]);
        for value in ["s", "abc", "%abc", "abcde", "sk-SYNTHETIC_SECRET"] {
            request.query[0].1 = value.into();
            assert_eq!(
                Route::new(&request).err().unwrap().code,
                "invalid_key_suffix"
            );
        }
    }

    use super::*;
    #[cfg(feature = "local-preview")]
    #[test]
    fn local_fixture_is_scoped_and_qualifies_without_bypassing_key_rules() {
        let mut request = BusinessRequest {
            method: "GET".into(),
            path: "/account/models".into(),
            query: vec![],
            body: None,
            generation: 1,
            request_id: None,
        };
        let base = serde_json::json!({"items":[],"pagination":{"total":"0"},"pricing_meta":{"usable_group":{"default":"Default"},"default_effective_group":"default"}});
        assert_eq!(
            local_configuration_fixture("https://api.tu-zi.com", &request, base.clone()),
            base
        );
        let listed = local_configuration_fixture("http://127.0.0.1:5180", &request, base.clone());
        assert_eq!(listed["items"][0]["model_name"], "gpt-5.6-sol");
        assert_eq!(listed["pagination"]["total"], "1");
        assert_eq!(
            local_configuration_fixture("http://127.0.0.1:5180", &request, listed.clone()),
            listed
        );
        request.query = vec![("models".into(), "gpt-5.6-sol".into())];
        let rechecked =
            local_configuration_fixture("http://127.0.0.1:5180", &request, base.clone());
        assert_eq!(listed, rechecked);
        let mut key = serde_json::json!({"status":1,"expired_time":-1,"unlimited_quota":true,"group":"default","model_limits":"","model_limits_enabled":false});
        let names = vec!["gpt-5.6-sol".into()];
        assert!(qualified_models(&key, &rechecked, &names, "responses", 100, true).is_ok());
        key["status"] = serde_json::json!(2);
        assert!(qualified_models(&key, &rechecked, &names, "responses", 100, true).is_err());
        key["status"] = serde_json::json!(1);
        key["model_limits_enabled"] = serde_json::json!(true);
        key["model_limits"] = serde_json::json!("another-model");
        assert!(qualified_models(&key, &rechecked, &names, "responses", 100, true).is_err());
        for (k, v) in [
            ("page", "2"),
            ("search", "non-matching"),
            ("models", "another-model"),
        ] {
            request.query = vec![(k.into(), v.into())];
            assert_eq!(
                local_configuration_fixture("http://127.0.0.1:5180", &request, base.clone()),
                base
            );
        }
    }

    #[test]
    fn catalog_endpoints_qualify_consistently_without_relaxing_key_checks() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/tuzi-endpoint-compatibility.json"
        ))
        .unwrap();
        let key = serde_json::json!({"status":1,"expired_time":-1,"unlimited_quota":true,"group":"default","model_limits":"","model_limits_enabled":false});
        let names = vec!["synthetic-model".into()];
        for case in cases {
            let data = serde_json::json!({"items":[case["model"]],"pricing_meta":{"usable_group":{"default":"Default"}}});
            for protocol in ["anthropic", "responses", "chat", "gemini"] {
                let expected = case["protocols"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|v| v == protocol);
                assert_eq!(
                    qualified_models(&key, &data, &names, protocol, 100, true).is_ok(),
                    expected,
                    "case {} / {protocol}",
                    case["name"]
                );
                if expected {
                    for patch in [
                        serde_json::json!({"status":2}),
                        serde_json::json!({"expired_time":99}),
                        serde_json::json!({"unlimited_quota":false,"remain_quota":"0"}),
                        serde_json::json!({"model_limits_enabled":true,"model_limits":"another-model"}),
                    ] {
                        let mut denied_key = key.clone();
                        denied_key
                            .as_object_mut()
                            .unwrap()
                            .extend(patch.as_object().unwrap().clone());
                        assert!(
                            qualified_models(&denied_key, &data, &names, protocol, 100, true)
                                .is_err()
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn provider_qualification_checks_current_key_and_token_catalog() {
        let mut key = serde_json::json!({"status":1,"expired_time":-1,"unlimited_quota":false,"remain_quota":"9007199254740993123","group":"default","model_limits_enabled":true,"model_limits":"synthetic-model"});
        let mut data = serde_json::json!({"items":[{"model_name":"synthetic-model","enable_groups":["vip"],"supported_endpoint_types":["openai-response"]}],"pricing_meta":{"usable_group":{"vip":"VIP"},"default_effective_group":"vip","default_resolution":{}}});
        let names = vec!["synthetic-model".into()];
        assert!(qualified_models(&key, &data, &names, "responses", 100, true).is_ok());
        for alias in endpoint_aliases("responses") {
            data["items"][0]["supported_endpoint_types"] = serde_json::json!([alias]);
            assert!(qualified_models(&key, &data, &names, "responses", 100, true).is_ok());
        }
        data["items"][0]["supported_endpoint_types"] = serde_json::json!(["openai"]);
        assert!(qualified_models(&key, &data, &names, "responses", 100, true).is_err());
        data["items"][0]["supported_endpoint_types"] = serde_json::json!(["openai-response"]);
        for protocol in ["chat", "gemini", "anthropic", "unknown"] {
            assert!(qualified_models(&key, &data, &names, protocol, 100, true).is_err());
        }
        key["status"] = serde_json::json!(2);
        assert!(qualified_models(&key, &data, &names, "responses", 100, true).is_err());
        key["status"] = serde_json::json!(1);
        key["expired_time"] = serde_json::json!(99);
        assert!(qualified_models(&key, &data, &names, "responses", 100, true).is_err());
        key["expired_time"] = serde_json::json!(-1);
        key["remain_quota"] = serde_json::json!("0");
        assert!(qualified_models(&key, &data, &names, "responses", 100, true).is_err());
        key["remain_quota"] = serde_json::json!("1");
        key["model_limits"] = serde_json::json!("other-model");
        assert!(qualified_models(&key, &data, &names, "responses", 100, true).is_err());
        key["model_limits"] = serde_json::json!("synthetic-model");
        // Group/virtual-default permissions are already enforced by /v1/models.
        data["pricing_meta"] = Value::Null;
        assert!(qualified_models(&key, &data, &names, "responses", 100, true).is_ok());
        assert!(
            qualified_models(&key, &data, &["missing".into()], "responses", 100, true).is_err()
        );
    }
}

fn usage_rows(v: &Value, chart: bool) -> Result<Value, BusinessError> {
    let mut rows = std::collections::BTreeMap::<String, Value>::new();
    if v.is_null() {
        return Ok(serde_json::json!([]));
    }
    for value in v
        .as_array()
        .ok_or_else(|| BusinessError::new("invalid_response", false))?
    {
        let id = if chart {
            format!(
                "{:020}",
                value["bucket_start"]
                    .as_i64()
                    .ok_or_else(|| BusinessError::new("invalid_response", false))?
            )
        } else {
            value["model_name"]
                .as_str()
                .ok_or_else(|| BusinessError::new("invalid_response", false))?
                .into()
        };
        let row = rows.entry(id).or_insert_with(|| {
            if chart {
                pick(value, "bucket_start bucket_end")
            } else {
                pick(value, "model_name")
            }
        });
        for k in ["call_count", "quota", "prompt_tokens", "completion_tokens"] {
            let current = row[k]
                .as_str()
                .unwrap_or("0")
                .parse::<i128>()
                .map_err(|_| BusinessError::new("invalid_response", false))?;
            let amount = decimal(&value[k])?
                .as_str()
                .unwrap()
                .parse::<i128>()
                .map_err(|_| BusinessError::new("invalid_response", false))?;
            row[k] = current
                .checked_add(amount)
                .ok_or_else(|| BusinessError::new("invalid_response", false))?
                .to_string()
                .into();
        }
    }
    Ok(Value::Array(rows.into_values().collect()))
}
