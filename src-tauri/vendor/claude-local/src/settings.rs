//! Claude Desktop 完整功能模式的设置（Codex++ 存在 settings.json 的 `claudeDesktopLocal` 下，ClaudeMom 同一形状）。

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClaudeLocalSettings {
    pub enabled: bool,
    pub model: String,
    pub localization: bool,
    pub voice_input: bool,
    pub computer_use: bool,
    pub background_mode: bool,
    /// 无视 Claude 对后台模式的 macOS 版本上限（新系统上 Claude 会提示「暂不支持」，默认关）。
    /// 打开时一并打开后台模式；Claude 没在这个系统上验证过，可能不稳定。
    pub force_background_mode: bool,
    /// 打开 Cowork 的总开关（GrowthBook `yukon_silver`，默认开）。录制模板里它是关的，
    /// 新版 Claude 会因此只显示 Chat / Code。平台限制（MSIX、HCS 等）仍由 Claude 自己检查。
    pub cowork: bool,
    /// Claude 里显示的用户名；空串按「Local User」。
    pub display_name: String,
    /// Claude 里显示的邮箱；空串按「local@claude.local」。
    pub email: String,
    /// Claude 里显示的套餐：free / pro / max / ultra。
    pub plan: String,
    /// 启动前同步 3p 模式与完整功能模式的 Code 会话（默认关）。
    pub session_sync: bool,
    /// 交给 Claude 的模型是否按窗口过滤：默认只列窗口不小于默认模型的那些
    /// （Claude 的窗口是启动时一份全局值，切到更小的模型不会跟着变小）。
    /// 打开后池里的聊天模型全列出来，代价是切到小窗口模型时可能超上限。
    pub list_all_models: bool,
    /// 隐藏 Claude 自带、供应商池里没有对应路由的模型（Opus / Sonnet / Haiku 等原生条目，默认开）。
    /// 这些条目选了也会被换成默认模型；关掉则照旧显示。
    pub hide_unrouted_models: bool,
    /// Code 页签（内置 Claude Code）是否和命令行共用 `~/.claude`：会话记录、MCP、插件都是同一份。
    /// 代价是 `~/.claude/settings.json` 里的 `env`（如 `ANTHROPIC_BASE_URL`）会盖过本程序给的上游。
    /// 不写时按宿主的默认（ClaudeMom 共用，Codex++ 独立）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_share_home: Option<bool>,
    /// 启动前把命令行（终端、BaoCode 等）建的 Claude Code 会话登记进 Desktop 的会话列表（默认开）。
    pub import_cli_sessions: bool,
}

impl Default for ClaudeLocalSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            model: String::new(),
            localization: true,
            voice_input: true,
            computer_use: false,
            background_mode: false,
            force_background_mode: false,
            cowork: true,
            display_name: String::new(),
            email: String::new(),
            plan: "ultra".into(),
            session_sync: false,
            list_all_models: false,
            hide_unrouted_models: true,
            code_share_home: None,
            import_cli_sessions: true,
        }
    }
}

impl ClaudeLocalSettings {
    /// 套餐只认 free / pro / max / ultra（大小写不敏感），其他一律 ultra。
    pub fn normalized_plan(&self) -> &str {
        match self.plan.trim().to_ascii_lowercase().as_str() {
            "free" => "free",
            "pro" => "pro",
            "max" => "max",
            _ => "ultra",
        }
    }

    /// 显示名：trim、去控制字符、最多 64 字符；空则按默认「Local User」。
    pub fn effective_display_name(&self) -> String {
        let name: String = self
            .display_name
            .trim()
            .chars()
            .filter(|ch| !ch.is_control())
            .take(64)
            .collect();
        let name = name.trim();
        if name.is_empty() {
            "Local User".to_string()
        } else {
            name.to_string()
        }
    }

    /// 用户填的邮箱是否可用：去首尾空白后为空，或形如 `a@b`
    /// （最长 254 字符、不含空白与控制字符、`@` 两侧都非空）。
    pub fn email_is_valid(&self) -> bool {
        normalized_email(&self.email).is_some()
    }

    /// 显示邮箱：空或格式不对都按默认「local@claude.local」。
    pub fn effective_email(&self) -> String {
        normalized_email(&self.email)
            .filter(|email| !email.is_empty())
            .unwrap_or_else(|| "local@claude.local".to_string())
    }
}

/// 邮箱规范化：`Some("")` 表示没填，`None` 表示格式不对。
fn normalized_email(raw: &str) -> Option<String> {
    let email = raw.trim();
    if email.is_empty() {
        return Some(String::new());
    }
    if email.chars().count() > 254 || email.chars().any(|ch| ch.is_whitespace() || ch.is_control()) {
        return None;
    }
    let (local, domain) = email.rsplit_once('@')?;
    (!local.is_empty() && !domain.is_empty()).then(|| email.to_string())
}
