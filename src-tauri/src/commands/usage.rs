//! 使用统计相关命令

use crate::error::AppError;
use crate::services::usage_stats::*;
use crate::store::AppState;
use serde_json::Value;
use tauri::State;

/// 获取使用量汇总
#[tauri::command]
pub fn get_usage_summary(
    state: State<'_, AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
    business_line: Option<String>,
) -> Result<UsageSummary, AppError> {
    state
        .db
        .get_usage_summary(start_date, end_date, business_line.as_deref())
}

/// 获取每日趋势
#[tauri::command]
pub fn get_usage_trends(
    state: State<'_, AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
    business_line: Option<String>,
) -> Result<Vec<DailyStats>, AppError> {
    state
        .db
        .get_daily_trends(start_date, end_date, business_line.as_deref())
}

/// 获取 Provider 统计
#[tauri::command]
pub fn get_provider_stats(
    state: State<'_, AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
    business_line: Option<String>,
) -> Result<Vec<ProviderStats>, AppError> {
    state
        .db
        .get_provider_stats(start_date, end_date, business_line.as_deref())
}

/// 获取模型统计
#[tauri::command]
pub fn get_model_stats(
    state: State<'_, AppState>,
    start_date: Option<i64>,
    end_date: Option<i64>,
    business_line: Option<String>,
) -> Result<Vec<ModelStats>, AppError> {
    state
        .db
        .get_model_stats(start_date, end_date, business_line.as_deref())
}

/// 获取请求日志列表
#[tauri::command]
pub fn get_request_logs(
    state: State<'_, AppState>,
    filters: LogFilters,
    page: u32,
    page_size: u32,
) -> Result<PaginatedLogs, AppError> {
    state.db.get_request_logs(&filters, page, page_size)
}

/// 获取单个请求详情
#[tauri::command]
pub fn get_request_detail(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<Option<RequestLogDetail>, AppError> {
    state.db.get_request_detail(&request_id)
}

/// 获取模型定价列表
#[tauri::command]
pub fn get_model_pricing(state: State<'_, AppState>) -> Result<Vec<ModelPricingInfo>, AppError> {
    log::info!("获取模型定价列表");
    state.db.ensure_model_pricing_seeded()?;

    let db = state.db.clone();
    let conn = crate::database::lock_conn!(db.conn);

    // 检查表是否存在
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='model_pricing'",
            [],
            |row| row.get::<_, i64>(0).map(|count| count > 0),
        )
        .unwrap_or(false);

    if !table_exists {
        log::error!("model_pricing 表不存在,可能需要重启应用以触发数据库迁移");
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare(
        "SELECT model_id, display_name, input_cost_per_million, output_cost_per_million,
                cache_read_cost_per_million, cache_creation_cost_per_million
         FROM model_pricing
         ORDER BY display_name",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ModelPricingInfo {
            model_id: row.get(0)?,
            display_name: row.get(1)?,
            input_cost_per_million: row.get(2)?,
            output_cost_per_million: row.get(3)?,
            cache_read_cost_per_million: row.get(4)?,
            cache_creation_cost_per_million: row.get(5)?,
        })
    })?;

    let mut pricing = Vec::new();
    for row in rows {
        pricing.push(row?);
    }

    log::info!("成功获取 {} 条模型定价数据", pricing.len());
    Ok(pricing)
}

/// 更新模型定价
#[tauri::command]
pub fn update_model_pricing(
    state: State<'_, AppState>,
    model_id: String,
    display_name: String,
    input_cost: String,
    output_cost: String,
    cache_read_cost: String,
    cache_creation_cost: String,
) -> Result<(), AppError> {
    let db = state.db.clone();
    let conn = crate::database::lock_conn!(db.conn);

    conn.execute(
        "INSERT OR REPLACE INTO model_pricing (
            model_id, display_name, input_cost_per_million, output_cost_per_million,
            cache_read_cost_per_million, cache_creation_cost_per_million
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            model_id,
            display_name,
            input_cost,
            output_cost,
            cache_read_cost,
            cache_creation_cost
        ],
    )
    .map_err(|e| AppError::Database(format!("更新模型定价失败: {e}")))?;

    Ok(())
}

/// 检查 Provider 使用限额
#[tauri::command]
pub fn check_provider_limits(
    state: State<'_, AppState>,
    provider_id: String,
    app_type: String,
) -> Result<crate::services::usage_stats::ProviderLimitStatus, AppError> {
    state.db.check_provider_limits(&provider_id, &app_type)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuziKeyUsage {
    pub success: bool,
    pub source: String,
    pub key_masked: Option<String>,
    pub balance: Option<f64>,
    pub balance_raw_quota: Option<f64>,
    pub used_amount: Option<f64>,
    pub used_raw_quota: Option<f64>,
    pub request_count: Option<u64>,
    pub currency_symbol: Option<String>,
    pub quota_per_unit: Option<f64>,
    pub quota_display_type: Option<String>,
    pub expires_at: Option<i64>,
    pub note: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuziWorkspaceSummary {
    pub success: bool,
    pub currency_symbol: String,
    pub balance: f64,
    pub used_today: f64,
    pub used_month: f64,
    pub request_count_today: u64,
    pub request_count_month: u64,
    pub active_routes: u64,
    pub expires_at: Option<i64>,
    pub note: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuziWorkspaceTrendPoint {
    pub date: String,
    pub spend: f64,
    pub requests: u64,
    pub tokens: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuziWorkspaceDistributionItem {
    pub key: String,
    pub label: String,
    pub value: f64,
    pub percentage: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuziWorkspaceDistribution {
    pub by_business_line: Vec<TuziWorkspaceDistributionItem>,
    pub by_route: Vec<TuziWorkspaceDistributionItem>,
    pub by_model: Option<Vec<TuziWorkspaceDistributionItem>>,
}

#[tauri::command]
pub async fn get_tuzi_key_usage(api_key: String) -> Result<TuziKeyUsage, AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Ok(TuziKeyUsage {
            success: false,
            source: "token-key".to_string(),
            key_masked: None,
            balance: None,
            balance_raw_quota: None,
            used_amount: None,
            used_raw_quota: None,
            request_count: None,
            currency_symbol: None,
            quota_per_unit: None,
            quota_display_type: None,
            expires_at: None,
            note: Some("当前未检测到可用的兔子 API Key".to_string()),
            error: Some("MISSING_API_KEY".to_string()),
        });
    }

    let client = reqwest::Client::new();
    let encoded_key: String = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
    let endpoint = format!("https://api.tu-zi.com/api/token/key/{encoded_key}");

    let token_response = client
        .get(&endpoint)
        .header("accept", "application/json")
        .header("Rix-Api-User", "1001")
        .send()
        .await
        .map_err(|e| AppError::Message(format!("请求兔子 Key 信息失败: {e}")))?;

    let token_json: Value = token_response
        .json()
        .await
        .map_err(|e| AppError::Message(format!("解析兔子 Key 信息失败: {e}")))?;

    if !token_json
        .get("success")
        .and_then(|value| value.as_bool())
        .unwrap_or(true)
    {
        let message = extract_message(&token_json)
            .unwrap_or_else(|| "兔子 Key 查询失败，请检查 Key 是否有效".to_string());
        return Ok(TuziKeyUsage {
            success: false,
            source: "token-key".to_string(),
            key_masked: Some(mask_key(trimmed)),
            balance: None,
            balance_raw_quota: None,
            used_amount: None,
            used_raw_quota: None,
            request_count: None,
            currency_symbol: None,
            quota_per_unit: None,
            quota_display_type: None,
            expires_at: None,
            note: Some("当前仅支持基于 API Key 的额度查询".to_string()),
            error: Some(message),
        });
    }

    let status_json = match client
        .get("https://api.tu-zi.com/api/status")
        .header("accept", "application/json")
        .send()
        .await
    {
        Ok(response) => response.json::<Value>().await.ok(),
        Err(_) => None,
    };

    let data = token_json.get("data").unwrap_or(&token_json);
    let status_data = status_json
        .as_ref()
        .and_then(|value| value.get("data"))
        .unwrap_or(&Value::Null);

    let quota_per_unit = read_f64(status_data, &["quota_per_unit"]).or(Some(500000.0));
    let quota_display_type = read_string(status_data, &["quota_display_type"]);
    let currency_symbol = resolve_currency_symbol(status_data, quota_display_type.as_deref());

    let balance_raw_quota = read_f64(data, &["quota", "remain_quota", "remaining_quota"]);
    let used_raw_quota = read_f64(data, &["used_quota", "usedQuota"]);
    let request_count = read_u64(data, &["request_count", "requestCount"]);
    let expires_at = read_i64(data, &["expired_time", "expiredAt", "expires_at"]);

    let balance = balance_raw_quota.and_then(|quota| quota_per_unit.map(|unit| quota / unit));
    let used_amount = used_raw_quota.and_then(|quota| quota_per_unit.map(|unit| quota / unit));

    Ok(TuziKeyUsage {
        success: balance.is_some() || used_amount.is_some() || request_count.is_some(),
        source: "token-key".to_string(),
        key_masked: Some(mask_key(trimmed)),
        balance,
        balance_raw_quota,
        used_amount,
        used_raw_quota,
        request_count,
        currency_symbol,
        quota_per_unit,
        quota_display_type,
        expires_at,
        note: Some("当前数据基于 API Key 查询，不包含面板登录态下的日志与趋势统计".to_string()),
        error: None,
    })
}

#[tauri::command]
pub async fn get_tuzi_workspace_summary(api_key: String) -> Result<TuziWorkspaceSummary, AppError> {
    let key_usage = get_tuzi_key_usage(api_key).await?;

    Ok(TuziWorkspaceSummary {
        success: key_usage.success,
        currency_symbol: key_usage.currency_symbol.unwrap_or_else(|| "$".to_string()),
        balance: key_usage.balance.unwrap_or(0.0),
        used_today: 0.0,
        used_month: key_usage.used_amount.unwrap_or(0.0),
        request_count_today: 0,
        request_count_month: key_usage.request_count.unwrap_or(0),
        active_routes: 0,
        expires_at: key_usage.expires_at,
        note: Some(key_usage.note.unwrap_or_else(|| {
            "当前工作台汇总接口仍在接入中，现阶段先复用 API Key 查询结果".to_string()
        })),
        error: key_usage.error,
    })
}

#[tauri::command]
pub async fn get_tuzi_workspace_trends(
    _api_key: String,
    _days: i64,
) -> Result<Vec<TuziWorkspaceTrendPoint>, AppError> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn get_tuzi_workspace_distribution(
    _api_key: String,
    _days: i64,
) -> Result<TuziWorkspaceDistribution, AppError> {
    Ok(TuziWorkspaceDistribution {
        by_business_line: Vec::new(),
        by_route: Vec::new(),
        by_model: Some(Vec::new()),
    })
}

/// 删除模型定价
#[tauri::command]
pub fn delete_model_pricing(state: State<'_, AppState>, model_id: String) -> Result<(), AppError> {
    let db = state.db.clone();
    let conn = crate::database::lock_conn!(db.conn);

    conn.execute(
        "DELETE FROM model_pricing WHERE model_id = ?1",
        rusqlite::params![model_id],
    )
    .map_err(|e| AppError::Database(format!("删除模型定价失败: {e}")))?;

    log::info!("已删除模型定价: {model_id}");
    Ok(())
}

fn extract_message(value: &Value) -> Option<String> {
    value
        .get("message")
        .and_then(|item| item.as_str())
        .map(ToString::to_string)
        .or_else(|| {
            value.get("error").and_then(|error| {
                error
                    .get("message")
                    .and_then(|item| item.as_str())
                    .map(ToString::to_string)
            })
        })
}

fn read_value<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| value.get(*key))
}

fn read_string(value: &Value, keys: &[&str]) -> Option<String> {
    read_value(value, keys).and_then(|item| item.as_str().map(ToString::to_string))
}

fn read_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    read_value(value, keys).and_then(|item| match item {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    })
}

fn read_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    read_value(value, keys).and_then(|item| match item {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.parse::<u64>().ok(),
        _ => None,
    })
}

fn read_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    read_value(value, keys).and_then(|item| match item {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.parse::<i64>().ok(),
        _ => None,
    })
}

fn resolve_currency_symbol(
    status_data: &Value,
    quota_display_type: Option<&str>,
) -> Option<String> {
    match quota_display_type.unwrap_or("USD") {
        "CNY" => Some("¥".to_string()),
        "CUSTOM" => read_string(status_data, &["custom_currency_symbol"]).or(Some("¤".to_string())),
        "USD" => Some("$".to_string()),
        _ => Some("$".to_string()),
    }
}

fn mask_key(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() <= 8 {
        return "*".repeat(chars.len());
    }

    let prefix: String = chars.iter().take(4).collect();
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("{prefix}****{suffix}")
}

/// 模型定价信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricingInfo {
    pub model_id: String,
    pub display_name: String,
    pub input_cost_per_million: String,
    pub output_cost_per_million: String,
    pub cache_read_cost_per_million: String,
    pub cache_creation_cost_per_million: String,
}
