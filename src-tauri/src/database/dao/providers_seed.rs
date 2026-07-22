//! 官方供应商种子数据
//!
//! 启动时调用 `Database::init_default_official_providers` 把这些条目
//! 写入 `providers` 表，让所有用户都能看到一个"一键切回官方"的入口。
//!
//! 字段与前端预设保持一致，参见：
//! - `src/config/claudeProviderPresets.ts`（"Claude Official"）
//! - `src/config/codexProviderPresets.ts`（"OpenAI Official"）
//! - `src/config/geminiProviderPresets.ts`（"Google Official"）

use crate::app_config::AppType;

pub(crate) const CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID: &str = "claude-desktop-official";
pub(crate) const CODEX_OFFICIAL_PROVIDER_ID: &str = "codex-official";
pub(crate) const TUZI_CODEX_ROUTE_ENDPOINTS: &[&str] = &[
    "https://api.tu-zi.com/v1",
    "https://coding.tu-zi.com",
    "https://coding.opentu.ai",
    "https://coding.sydney-ai.com",
    "https://test-coding.tu-zi.com",
    "https://sub2api-origin.sydney-ai.com",
];

/// Tuzi product presets are additive business routes, not replacements for
/// CC Switch's official providers. Existing rows are never overwritten.
pub(crate) struct TuziProviderSeed {
    pub id: &'static str,
    pub app_type: AppType,
    pub name: &'static str,
    pub website_url: &'static str,
    pub icon: &'static str,
    pub settings_config_json: &'static str,
}

impl TuziProviderSeed {
    pub(crate) fn endpoint_candidates(&self) -> &'static [&'static str] {
        if self.id == "tuzi-route" && self.app_type == AppType::Codex {
            TUZI_CODEX_ROUTE_ENDPOINTS
        } else {
            &[]
        }
    }
}

/// 单条官方供应商种子定义。
pub(crate) struct OfficialProviderSeed {
    pub id: &'static str,
    pub app_type: AppType,
    pub name: &'static str,
    pub website_url: &'static str,
    pub icon: &'static str,
    pub icon_color: &'static str,
    /// settings_config 的 JSON 字符串，每个 app 结构不同。
    pub settings_config_json: &'static str,
}

/// Claude / Claude Desktop / Codex / Gemini 的官方预设。
///
/// id 固定，便于幂等检查；name 直接用英文原名（与前端预设一致），不做 i18n。
pub(crate) const OFFICIAL_SEEDS: &[OfficialProviderSeed] = &[
    OfficialProviderSeed {
        id: "claude-official",
        app_type: AppType::Claude,
        name: "Claude Official",
        website_url: "https://www.anthropic.com/claude-code",
        icon: "anthropic",
        icon_color: "#D4915D",
        // 空 env 让用户走 Claude CLI 默认认证流程
        settings_config_json: r#"{"env":{}}"#,
    },
    OfficialProviderSeed {
        id: CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID,
        app_type: AppType::ClaudeDesktop,
        name: "Claude Desktop Official",
        website_url: "https://claude.ai/download",
        icon: "anthropic",
        icon_color: "#D4915D",
        // 空 env 只是占位；切换该 provider 时会恢复 Claude Desktop 1P 模式
        settings_config_json: r#"{"env":{}}"#,
    },
    OfficialProviderSeed {
        id: CODEX_OFFICIAL_PROVIDER_ID,
        app_type: AppType::Codex,
        name: "OpenAI Official",
        website_url: "https://chatgpt.com/codex",
        icon: "openai",
        icon_color: "#00A67E",
        // 空 auth + 空 config 让用户走 ChatGPT Plus/Pro OAuth
        settings_config_json: r#"{"auth":{},"config":""}"#,
    },
    OfficialProviderSeed {
        id: "gemini-official",
        app_type: AppType::Gemini,
        name: "Google Official",
        website_url: "https://ai.google.dev/",
        icon: "gemini",
        icon_color: "#4285F4",
        // 空 env + 空 config 让用户走 Google OAuth
        settings_config_json: r#"{"env":{},"config":{}}"#,
    },
];

pub(crate) const TUZI_SEEDS: &[TuziProviderSeed] = &[
    TuziProviderSeed {
        id: "tuzi-route",
        app_type: AppType::Claude,
        name: "兔子线路",
        website_url: "https://api.tu-zi.com",
        icon: "tuzi",
        settings_config_json: r#"{"env":{"ANTHROPIC_BASE_URL":"https://apius.tu-zi.com","ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_API_KEY":"","ANTHROPIC_MODEL":"anthropic/claude-sonnet-4.6","ANTHROPIC_DEFAULT_HAIKU_MODEL":"anthropic/claude-haiku-4.5","ANTHROPIC_DEFAULT_SONNET_MODEL":"anthropic/claude-sonnet-4.6","ANTHROPIC_DEFAULT_OPUS_MODEL":"anthropic/claude-opus-4.7"}}"#,
    },
    TuziProviderSeed {
        id: "gaccode",
        app_type: AppType::Claude,
        name: "gaccode",
        website_url: "https://store.tu-zi.com/cat/1",
        icon: "gaccode",
        settings_config_json: r#"{"env":{"ANTHROPIC_BASE_URL":"https://gaccode.com/claudecode","ANTHROPIC_AUTH_TOKEN":"","ANTHROPIC_API_KEY":"","ANTHROPIC_MODEL":"anthropic/claude-sonnet-4.6","ANTHROPIC_DEFAULT_HAIKU_MODEL":"anthropic/claude-haiku-4.5","ANTHROPIC_DEFAULT_SONNET_MODEL":"anthropic/claude-sonnet-4.6","ANTHROPIC_DEFAULT_OPUS_MODEL":"anthropic/claude-opus-4.7"}}"#,
    },
    TuziProviderSeed {
        id: "tuzi-route",
        app_type: AppType::Codex,
        name: "兔子线路",
        website_url: "https://api.tu-zi.com",
        icon: "tuzi",
        settings_config_json: r#"{"auth":{},"env":{"envKey":"TUZI_CODEX_API_KEY"},"config":"model_provider = \"tuzi\"\nmodel = \"gpt-5.6-sol\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.tuzi]\nname = \"tuzi\"\nbase_url = \"https://api.tu-zi.com/v1\"\nenv_key = \"TUZI_CODEX_API_KEY\"\nwire_api = \"responses\"\nrequires_openai_auth = false\nhttp_headers = { \"x-openai-actor-authorization\" = \"http://coding.tu-zi.com\" }"}"#,
    },
    TuziProviderSeed {
        id: "coding",
        app_type: AppType::Codex,
        name: "codex订阅",
        website_url: "https://store.tu-zi.com/cat/11",
        icon: "codex-sub",
        settings_config_json: r#"{"auth":{},"env":{"envKey":"CODING_CODEX_API_KEY"},"config":"model_provider = \"codex\"\nmodel = \"gpt-5.6-sol\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.codex]\nname = \"codex\"\nbase_url = \"https://api.tu-zi.com/coding\"\nenv_key = \"CODING_CODEX_API_KEY\"\nwire_api = \"responses\"\nrequires_openai_auth = false\nhttp_headers = { \"x-openai-actor-authorization\" = \"http://coding.tu-zi.com\" }"}"#,
    },
    TuziProviderSeed {
        id: "gaccode",
        app_type: AppType::Codex,
        name: "gaccode",
        website_url: "https://store.tu-zi.com/cat/1",
        icon: "gaccode",
        settings_config_json: r#"{"auth":{},"env":{"envKey":"GAC_CODEX_API_KEY"},"config":"model_provider = \"gac\"\nmodel = \"gpt-5.6-sol\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.gac]\nname = \"gac\"\nbase_url = \"https://gaccode.com/codex/v1\"\nenv_key = \"GAC_CODEX_API_KEY\"\nwire_api = \"responses\"\nrequires_openai_auth = false\nhttp_headers = { \"x-openai-actor-authorization\" = \"http://coding.tu-zi.com\" }"}"#,
    },
    TuziProviderSeed {
        id: "tuzi-route",
        app_type: AppType::Gemini,
        name: "兔子线路",
        website_url: "https://api.tu-zi.com",
        icon: "tuzi",
        settings_config_json: r#"{"env":{"GOOGLE_GEMINI_BASE_URL":"https://api.tu-zi.com","GEMINI_API_KEY":"","GEMINI_MODEL":"gemini-3.1-pro"}}"#,
    },
    TuziProviderSeed {
        id: "codex-tuzi",
        app_type: AppType::OpenClaw,
        name: "codex-tuzi",
        website_url: "https://api.tu-zi.com",
        icon: "tuzi",
        settings_config_json: r#"{"baseUrl":"https://api.tu-zi.com/v1","apiKey":"","api":"openai-completions","models":[{"id":"gpt-5.5","name":"GPT-5.5","contextWindow":200000,"cost":{"input":5,"output":15}}]}"#,
    },
    TuziProviderSeed {
        id: "codex-coding",
        app_type: AppType::OpenClaw,
        name: "codex-coding",
        website_url: "https://store.tu-zi.com/cat/11",
        icon: "codex-sub",
        settings_config_json: r#"{"baseUrl":"https://api.tu-zi.com/coding","apiKey":"","api":"openai-completions","models":[{"id":"gpt-5.5","name":"GPT-5.5","contextWindow":200000,"cost":{"input":5,"output":15}}]}"#,
    },
    TuziProviderSeed {
        id: "codex-gaccode",
        app_type: AppType::OpenClaw,
        name: "codex-gaccode",
        website_url: "https://store.tu-zi.com/cat/1",
        icon: "gaccode",
        settings_config_json: r#"{"baseUrl":"https://gaccode.com/code/v1","apiKey":"","api":"openai-completions","models":[{"id":"gpt-5.5","name":"GPT-5.5","contextWindow":200000,"cost":{"input":5,"output":15}}]}"#,
    },
    TuziProviderSeed {
        id: "claude-tuzi",
        app_type: AppType::OpenClaw,
        name: "claude-tuzi",
        website_url: "https://api.tu-zi.com",
        icon: "tuzi",
        settings_config_json: r#"{"baseUrl":"https://api.tu-zi.com/v1","apiKey":"","api":"anthropic-messages","models":[{"id":"claude-sonnet-4-6","name":"Claude Sonnet 4.6","contextWindow":1000000,"cost":{"input":3,"output":15}}]}"#,
    },
    TuziProviderSeed {
        id: "claude-gaccode",
        app_type: AppType::OpenClaw,
        name: "claude-gaccode",
        website_url: "https://store.tu-zi.com/cat/1",
        icon: "gaccode",
        settings_config_json: r#"{"baseUrl":"https://gaccode.com/claudecode","apiKey":"","api":"anthropic-messages","models":[{"id":"claude-sonnet-4-6","name":"Claude Sonnet 4.6","contextWindow":1000000,"cost":{"input":3,"output":15}}]}"#,
    },
    TuziProviderSeed {
        id: "codex-tuzi",
        app_type: AppType::Hermes,
        name: "codex-tuzi",
        website_url: "https://api.tu-zi.com",
        icon: "tuzi",
        settings_config_json: r#"{"name":"codex-tuzi","base_url":"https://api.tu-zi.com/v1","api_key":"","api_mode":"codex_responses","models":[{"id":"gpt-5.5","name":"GPT-5.5","context_length":200000}]}"#,
    },
    TuziProviderSeed {
        id: "codex-coding",
        app_type: AppType::Hermes,
        name: "codex-coding",
        website_url: "https://store.tu-zi.com/cat/11",
        icon: "codex-sub",
        settings_config_json: r#"{"name":"codex-coding","base_url":"https://api.tu-zi.com/coding","api_key":"","api_mode":"codex_responses","models":[{"id":"gpt-5.5","name":"GPT-5.5","context_length":200000}]}"#,
    },
    TuziProviderSeed {
        id: "codex-gaccode",
        app_type: AppType::Hermes,
        name: "codex-gaccode",
        website_url: "https://store.tu-zi.com/cat/1",
        icon: "gaccode",
        settings_config_json: r#"{"name":"codex-gaccode","base_url":"https://gaccode.com/code/v1","api_key":"","api_mode":"codex_responses","models":[{"id":"gpt-5.5","name":"GPT-5.5","context_length":200000}]}"#,
    },
    TuziProviderSeed {
        id: "claude-tuzi",
        app_type: AppType::Hermes,
        name: "claude-tuzi",
        website_url: "https://api.tu-zi.com",
        icon: "tuzi",
        settings_config_json: r#"{"name":"claude-tuzi","base_url":"https://api.tu-zi.com/v1","api_key":"","api_mode":"anthropic_messages","models":[{"id":"claude-sonnet-4-6","name":"Claude Sonnet 4.6","context_length":1000000}]}"#,
    },
    TuziProviderSeed {
        id: "claude-gaccode",
        app_type: AppType::Hermes,
        name: "claude-gaccode",
        website_url: "https://store.tu-zi.com/cat/1",
        icon: "gaccode",
        settings_config_json: r#"{"name":"claude-gaccode","base_url":"https://gaccode.com/claudecode","api_key":"","api_mode":"anthropic_messages","models":[{"id":"claude-sonnet-4-6","name":"Claude Sonnet 4.6","context_length":1000000}]}"#,
    },
];

/// 判断给定的 provider id 是否属于内置官方种子。
///
/// 单一事实源：直接扫描 `OFFICIAL_SEEDS`，避免在多处重复维护 id 列表。
pub(crate) fn is_official_seed_id(id: &str) -> bool {
    OFFICIAL_SEEDS.iter().any(|seed| seed.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_seeds_include_claude_desktop() {
        let seed = OFFICIAL_SEEDS
            .iter()
            .find(|seed| seed.id == CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID)
            .expect("claude desktop official seed");

        assert_eq!(seed.app_type, AppType::ClaudeDesktop);
        assert!(is_official_seed_id(CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID));
    }

    #[test]
    fn tuzi_codex_route_keeps_all_six_endpoints() {
        let seed = TUZI_SEEDS
            .iter()
            .find(|seed| seed.id == "tuzi-route" && seed.app_type == AppType::Codex)
            .expect("Tuzi Codex seed");
        assert_eq!(seed.endpoint_candidates(), TUZI_CODEX_ROUTE_ENDPOINTS);
    }
}
