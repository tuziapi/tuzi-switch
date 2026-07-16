//! 官方供应商种子数据。

pub(crate) const CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID: &str = "claude-desktop-official";
pub(crate) const CLAUDE_OFFICIAL_PROVIDER_IDS: &[(&str, &str, &str, &str)] = &[
    (
        "tuzi-route",
        "兔子线路",
        "https://apius.tu-zi.com",
        "anthropic/claude-sonnet-4.6",
    ),
    (
        "gaccode",
        "gaccode",
        "https://gaccode.com/claudecode",
        "anthropic/claude-sonnet-4.6",
    ),
];
pub(crate) const CODEX_OFFICIAL_PROVIDER_IDS: &[(&str, &str, &str, &str, &str, &str)] = &[
    (
        "tuzi-route",
        "兔子线路",
        "https://api.tu-zi.com",
        "https://api.tu-zi.com/v1",
        "TUZI_CODEX_API_KEY",
        "gpt-5.6-sol",
    ),
    (
        "coding",
        "codex订阅",
        "https://store.tu-zi.com/cat/11",
        "https://api.tu-zi.com/coding",
        "CODING_CODEX_API_KEY",
        "gpt-5.6-sol",
    ),
    (
        "gaccode",
        "gaccode",
        "https://store.tu-zi.com/cat/1",
        "https://gaccode.com/codex/v1",
        "GAC_CODEX_API_KEY",
        "gpt-5.6-sol",
    ),
];

pub(crate) fn is_codex_official_seed_id(id: &str) -> bool {
    CODEX_OFFICIAL_PROVIDER_IDS
        .iter()
        .any(|(seed_id, _, _, _, _, _)| *seed_id == id)
}
pub(crate) const GEMINI_OFFICIAL_PROVIDER_IDS: &[(&str, &str, &str, &str)] = &[(
    "tuzi-route",
    "兔子线路",
    "https://api.tu-zi.com",
    "gemini-3.1-pro",
)];

pub(crate) const OPENCLAW_OFFICIAL_PROVIDER_IDS: &[(&str, &str, &str, &str, &str)] = &[
    (
        "codex-tuzi",
        "codex-tuzi",
        "https://api.tu-zi.com",
        "https://api.tu-zi.com/v1",
        "openai-completions",
    ),
    (
        "codex-coding",
        "codex-coding",
        "https://store.tu-zi.com/cat/11",
        "https://api.tu-zi.com/coding",
        "openai-completions",
    ),
    (
        "codex-gaccode",
        "codex-gaccode",
        "https://store.tu-zi.com/cat/1",
        "https://gaccode.com/code/v1",
        "openai-completions",
    ),
    (
        "claude-tuzi",
        "claude-tuzi",
        "https://api.tu-zi.com",
        "https://api.tu-zi.com/v1",
        "anthropic-messages",
    ),
    (
        "claude-gaccode",
        "claude-gaccode",
        "https://store.tu-zi.com/cat/1",
        "https://gaccode.com/claudecode",
        "anthropic-messages",
    ),
];

pub(crate) const HERMES_OFFICIAL_PROVIDER_IDS: &[(&str, &str, &str, &str, &str)] = &[
    (
        "codex-tuzi",
        "codex-tuzi",
        "https://api.tu-zi.com",
        "https://api.tu-zi.com/v1",
        "codex_responses",
    ),
    (
        "codex-coding",
        "codex-coding",
        "https://store.tu-zi.com/cat/11",
        "https://api.tu-zi.com/coding",
        "codex_responses",
    ),
    (
        "codex-gaccode",
        "codex-gaccode",
        "https://store.tu-zi.com/cat/1",
        "https://gaccode.com/code/v1",
        "codex_responses",
    ),
    (
        "claude-tuzi",
        "claude-tuzi",
        "https://api.tu-zi.com",
        "https://api.tu-zi.com/v1",
        "anthropic_messages",
    ),
    (
        "claude-gaccode",
        "claude-gaccode",
        "https://store.tu-zi.com/cat/1",
        "https://gaccode.com/claudecode",
        "anthropic_messages",
    ),
];
