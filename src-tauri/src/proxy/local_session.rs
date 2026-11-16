//! Ephemeral Claude Local binding. The provider snapshot stays in native memory;
//! the managed compatibility child receives only a short-lived gateway token.
use crate::{
    provider::{ClaudeDesktopModelRoute, Provider},
    proxy::ProxyError,
};
use axum::http::{header, HeaderMap};
use std::sync::RwLock;

#[derive(Default)]
pub(crate) struct LocalSession(RwLock<Option<Binding>>);
struct Binding {
    token: String,
    provider: Provider,
}

impl LocalSession {
    pub fn bind(&self, provider: Provider) -> Result<String, String> {
        let mut slot = self.0.write().map_err(|_| "session lock failed")?;
        if slot.is_some() {
            return Err("请先停止当前兼容会话".into());
        }
        let token = format!(
            "tuzi-local-{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        *slot = Some(Binding {
            token: token.clone(),
            provider,
        });
        Ok(token)
    }
    pub fn active(&self) -> bool {
        self.0.read().map(|v| v.is_some()).unwrap_or(true)
    }
    pub fn clear(&self) {
        if let Ok(mut v) = self.0.write() {
            *v = None;
        }
    }
    pub fn authorize(&self, headers: &HeaderMap) -> Result<Provider, ProxyError> {
        let denied =
            || ProxyError::AuthError("Claude Local session unavailable or unauthorized".into());
        if headers.contains_key(header::ORIGIN) {
            return Err(denied());
        }
        let supplied = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(denied)?;
        let slot = self.0.read().map_err(|_| denied())?;
        let binding = slot.as_ref().ok_or_else(denied)?;
        let different = supplied
            .as_bytes()
            .iter()
            .zip(binding.token.as_bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b));
        if supplied.len() != binding.token.len() || different != 0 {
            return Err(denied());
        }
        Ok(binding.provider.clone())
    }
}

/// Only an in-memory clone gains routes; existing direct/proxy provider settings are untouched.
pub(crate) fn snapshot(mut provider: Provider) -> Result<Provider, String> {
    use crate::proxy::providers::{AuthStrategy, ClaudeAdapter, ProviderAdapter};
    let adapter = ClaudeAdapter::new();
    let auth = adapter
        .extract_auth(&provider)
        .ok_or("P0 需要明确配置 API Key")?;
    if auth.api_key.trim().is_empty()
        || matches!(
            auth.strategy,
            AuthStrategy::GitHubCopilot | AuthStrategy::CodexOAuth | AuthStrategy::GoogleOAuth
        )
    {
        return Err("P0 仅接入 API Key 供应商，暂不接入托管 OAuth 账户".into());
    }
    let base = adapter
        .extract_base_url(&provider)
        .map_err(|e| e.to_string())?;
    let url = url::Url::parse(&base).map_err(|_| "供应商地址无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("供应商地址必须是无内嵌凭证的 HTTP(S) URL".into());
    }
    let meta = provider.meta.get_or_insert_with(Default::default);
    if meta.claude_desktop_model_routes.is_empty() {
        let env = provider.settings_config.get("env");
        for (key, route) in [
            ("ANTHROPIC_MODEL", "claude-local-default"),
            ("ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-local-sonnet"),
            ("ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-local-opus"),
            ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-local-haiku"),
        ] {
            if let Some(model) = env
                .and_then(|v| v.get(key))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                meta.claude_desktop_model_routes.insert(
                    route.into(),
                    ClaudeDesktopModelRoute {
                        model: model.into(),
                        display_name: Some(model.into()),
                        supports_1m: Some(false),
                    },
                );
            }
        }
    }
    crate::claude_desktop_config::proxy_model_routes(&provider).map_err(|e| e.to_string())?;
    Ok(provider)
}
