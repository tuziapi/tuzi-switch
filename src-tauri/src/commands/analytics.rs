use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;

const UMAMI_ENDPOINT: &str = "https://umami.tu-zi.com/api/send";
const UMAMI_WEBSITE_ID: &str = "853b4529-0976-4f8a-b00b-6e716f9a2f20";
const ANALYTICS_USER_AGENT: &str =
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) TuziSwitch/1.0 Safari/537.36";

const ALLOWED_EVENTS: &[&str] = &[
    "app_started",
    "app_selected",
    "provider_action",
    "proxy_action",
    "auth_action",
    "config_action",
    "webdav_action",
    "update_action",
    "setting_action",
];

const ALLOWED_APPS: &[&str] = &[
    "claude",
    "claude-desktop",
    "codex",
    "gemini",
    "opencode",
    "openclaw",
    "hermes",
    "app",
    "github_copilot",
    "codex_oauth",
];
static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
static IN_FLIGHT_LIMIT: OnceLock<Arc<Semaphore>> = OnceLock::new();
static RATE_LIMIT: OnceLock<Mutex<RateLimitState>> = OnceLock::new();

struct RateLimitState {
    tokens: f64,
    last_refill: Instant,
}

impl RateLimitState {
    fn try_take(&mut self, now: Instant) -> bool {
        self.tokens =
            (self.tokens + now.duration_since(self.last_refill).as_secs_f64() / 3.0).min(10.0);
        self.last_refill = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyticsEvent {
    event: String,
    #[serde(default)]
    data: AnalyticsEventData,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnalyticsEventData {
    #[serde(skip_serializing_if = "Option::is_none")]
    app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enabled: Option<String>,
    #[serde(skip_deserializing)]
    version: Option<&'static str>,
}

#[derive(Serialize)]
struct UmamiRequest<'a> {
    r#type: &'static str,
    payload: UmamiPayload<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UmamiPayload<'a> {
    website: &'static str,
    hostname: &'static str,
    url: &'static str,
    title: &'static str,
    ip: &'static str,
    user_agent: &'static str,
    browser: &'static str,
    device: &'static str,
    os: &'static str,
    name: &'a str,
    data: &'a AnalyticsEventData,
}

fn http_client() -> Result<&'static Client, String> {
    HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .user_agent(ANALYTICS_USER_AGENT)
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(3))
                .pool_max_idle_per_host(1)
                .pool_idle_timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| "统计服务初始化失败".to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn in_flight_limit() -> &'static Arc<Semaphore> {
    IN_FLIGHT_LIMIT.get_or_init(|| Arc::new(Semaphore::new(2)))
}

fn try_take_rate_limit() -> bool {
    let limiter = RATE_LIMIT.get_or_init(|| {
        Mutex::new(RateLimitState {
            tokens: 10.0,
            last_refill: Instant::now(),
        })
    });
    let Ok(mut state) = limiter.lock() else {
        return false;
    };

    state.try_take(Instant::now())
}

fn validate_event(event: &AnalyticsEvent) -> Result<(), String> {
    if !ALLOWED_EVENTS.contains(&event.event.as_str()) {
        return Err("不支持的统计事件".to_string());
    }

    let data = &event.data;
    if data
        .app
        .as_deref()
        .is_some_and(|value| !ALLOWED_APPS.contains(&value))
    {
        return Err("不支持的应用类型".to_string());
    }
    if data.source.as_deref().is_some_and(|value| {
        !matches!(
            value,
            "manual" | "automatic" | "tray" | "profile" | "failover" | "health_check"
        )
    }) {
        return Err("不支持的切换来源".to_string());
    }
    if data.result.as_deref().is_some_and(|value| {
        !matches!(
            value,
            "success" | "failed" | "partial" | "degraded" | "rejected"
        )
    }) {
        return Err("不支持的操作结果".to_string());
    }
    if data
        .enabled
        .as_deref()
        .is_some_and(|value| !matches!(value, "true" | "false"))
    {
        return Err("无效的开关状态".to_string());
    }

    let valid_shape = match event.event.as_str() {
        "app_started" => no_event_data(data),
        "app_selected" => data.app.is_some() && only(data, true, false, false, false, false),
        "provider_action" => match data.action.as_deref() {
            Some("switch") => only(data, true, true, true, true, false),
            Some("add" | "edit" | "delete" | "sort" | "test") => {
                only(data, true, true, true, false, false)
            }
            _ => false,
        },
        "proxy_action" => match data.action.as_deref() {
            Some("start" | "stop" | "circuit_breaker") => {
                only(data, false, true, true, false, false)
            }
            Some("switch" | "route_config" | "failover_queue_add" | "failover_queue_remove") => {
                only(data, true, true, true, false, false)
            }
            Some("route" | "failover") => only(data, true, true, true, false, true),
            Some("reset_circuit_breaker") => only(data, true, true, true, true, false),
            _ => false,
        },
        "auth_action" => {
            matches!(data.action.as_deref(), Some("login" | "logout"))
                && data.result.is_some()
                && matches!(data.app.as_deref(), Some("github_copilot" | "codex_oauth"))
                && only(data, true, true, true, false, false)
        }
        "config_action" => {
            matches!(
                data.action.as_deref(),
                Some("import" | "export" | "backup" | "restore")
            ) && data.result.is_some()
                && only(data, false, true, true, false, false)
        }
        "webdav_action" => {
            matches!(data.action.as_deref(), Some("test" | "upload" | "download"))
                && data.result.is_some()
                && only(data, false, true, true, false, false)
        }
        "update_action" => match data.action.as_deref() {
            Some("check") => only(data, false, true, true, true, false),
            Some("download" | "install") => only(data, false, true, true, false, false),
            _ => false,
        },
        "setting_action" => match data.action.as_deref() {
            Some("directory") => only(data, true, true, true, false, false),
            Some("terminal") => only(data, false, true, true, false, false),
            Some("startup") => only(data, false, true, true, false, true),
            _ => false,
        },
        _ => false,
    };

    valid_shape
        .then_some(())
        .ok_or_else(|| "统计事件字段不匹配".to_string())
}

fn only(
    data: &AnalyticsEventData,
    app: bool,
    action: bool,
    result: bool,
    source: bool,
    enabled: bool,
) -> bool {
    data.app.is_some() == app
        && data.action.is_some() == action
        && data.result.is_some() == result
        && data.source.is_some() == source
        && data.enabled.is_some() == enabled
}

fn no_event_data(data: &AnalyticsEventData) -> bool {
    only(data, false, false, false, false, false)
}

/// 上报最小化产品事件。校验完成后立即返回，网络请求在后台执行且不重试。
/// 前端做轻量去重，后端再执行限频和并发限制；全程不建立队列或持久化事件。
#[tauri::command(rename_all = "camelCase")]
pub async fn track_product_event(mut event: AnalyticsEvent) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    if !crate::settings::get_settings().anonymous_analytics_enabled {
        return Ok(());
    }

    validate_event(&event)?;
    if !try_take_rate_limit() {
        return Ok(());
    }
    let client = match http_client() {
        Ok(client) => client.clone(),
        Err(_) => return Ok(()),
    };
    let permit = match Arc::clone(in_flight_limit()).try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return Ok(()),
    };

    event.data.version = Some(env!("CARGO_PKG_VERSION"));

    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let request = UmamiRequest {
            r#type: "event",
            payload: UmamiPayload {
                website: UMAMI_WEBSITE_ID,
                hostname: "tuzi-switch",
                url: "/desktop",
                title: "Tuzi Switch",
                // 主动覆盖会话识别字段，避免 Umami 使用真实源 IP 生成地理位置和会话。
                // 反向代理访问日志仍需在服务端配置为关闭或脱敏。
                ip: "127.0.0.1",
                user_agent: ANALYTICS_USER_AGENT,
                browser: "TuziSwitch",
                device: "desktop",
                os: std::env::consts::OS,
                name: &event.event,
                data: &event.data,
            },
        };

        // 统计失败不影响任何业务流程，也不记录请求体或用户数据。
        let _ = client.post(UMAMI_ENDPOINT).json(&request).send().await;
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_custom_provider_names() {
        let event = AnalyticsEvent {
            event: "provider_action".to_string(),
            data: AnalyticsEventData {
                app: Some("my-private-provider".to_string()),
                action: Some("switch".to_string()),
                result: Some("success".to_string()),
                ..Default::default()
            },
        };
        assert!(validate_event(&event).is_err());
    }

    #[test]
    fn accepts_declared_event_shape() {
        let event = AnalyticsEvent {
            event: "provider_action".to_string(),
            data: AnalyticsEventData {
                app: Some("codex".to_string()),
                action: Some("switch".to_string()),
                result: Some("success".to_string()),
                source: Some("manual".to_string()),
                ..Default::default()
            },
        };
        assert!(validate_event(&event).is_ok());
    }

    #[test]
    fn accepts_profile_as_provider_switch_source() {
        let event = AnalyticsEvent {
            event: "provider_action".to_string(),
            data: AnalyticsEventData {
                app: Some("codex".to_string()),
                action: Some("switch".to_string()),
                result: Some("success".to_string()),
                source: Some("profile".to_string()),
                ..Default::default()
            },
        };
        assert!(validate_event(&event).is_ok());
    }

    #[test]
    fn rejects_known_fields_on_wrong_event() {
        let event = AnalyticsEvent {
            event: "app_started".to_string(),
            data: AnalyticsEventData {
                app: Some("codex".to_string()),
                ..Default::default()
            },
        };
        assert!(validate_event(&event).is_err());
    }

    #[test]
    fn rejects_invalid_result() {
        let event = AnalyticsEvent {
            event: "update_action".to_string(),
            data: AnalyticsEventData {
                action: Some("install".to_string()),
                result: Some("private/path".to_string()),
                ..Default::default()
            },
        };
        assert!(validate_event(&event).is_err());
    }

    #[test]
    fn accepts_root_directory_setting_without_exposing_path() {
        let event = AnalyticsEvent {
            event: "setting_action".to_string(),
            data: AnalyticsEventData {
                app: Some("app".to_string()),
                action: Some("directory".to_string()),
                result: Some("success".to_string()),
                ..Default::default()
            },
        };
        assert!(validate_event(&event).is_ok());
    }

    #[test]
    fn rejects_unknown_fields_before_validation() {
        let json = r#"{"event":"app_started","data":{"apiKey":"secret"}}"#;
        assert!(serde_json::from_str::<AnalyticsEvent>(json).is_err());
    }

    #[test]
    fn serializes_privacy_overrides_with_umami_field_names() {
        let data = AnalyticsEventData::default();
        let payload = UmamiPayload {
            website: UMAMI_WEBSITE_ID,
            hostname: "tuzi-switch",
            url: "/desktop",
            title: "Tuzi Switch",
            ip: "127.0.0.1",
            user_agent: ANALYTICS_USER_AGENT,
            browser: "TuziSwitch",
            device: "desktop",
            os: "macos",
            name: "app_started",
            data: &data,
        };
        let json = serde_json::to_value(payload).expect("serialize payload");

        assert_eq!(json["ip"], "127.0.0.1");
        assert_eq!(json["userAgent"], ANALYTICS_USER_AGENT);
        assert_eq!(json["browser"], "TuziSwitch");
        assert_eq!(json["device"], "desktop");
        assert_eq!(json["os"], "macos");
        assert!(json.get("user_agent").is_none());
    }

    #[test]
    fn rate_limit_allows_burst_then_refills_without_queueing() {
        let start = Instant::now();
        let mut state = RateLimitState {
            tokens: 2.0,
            last_refill: start,
        };

        assert!(state.try_take(start));
        assert!(state.try_take(start));
        assert!(!state.try_take(start));
        assert!(state.try_take(start + Duration::from_secs(3)));
    }
}
