//! 宿主接口：嵌入本库的程序（ClaudeMom、Codex++）各自实现，本库通过它拿状态目录、设置和上游。
//!
//! 本库只管「把原版 Claude Desktop 接到本地兼容服务上」这件事本身：资源安装、证书、代理进程、
//! 真实 profile 切换、启动 / 停止。上游从哪来（ClaudeMom 直连 Base URL + Key，Codex++ 走自己的网关）、
//! 设置存在哪、听写服务怎么起，都由宿主决定。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use anyhow::{Result, bail};
use serde_json::Value;

use crate::settings::ClaudeLocalSettings;

/// 交给本地兼容服务和内置 Claude Code 的上游。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Upstream {
    /// Anthropic 兼容的根地址：请求发到 `{root}/v1/messages`（与 `ANTHROPIC_BASE_URL` 同一语义）。
    pub root: String,
    pub token: String,
    pub default_model: String,
    /// Haiku 档（标题生成等小任务）用的模型。
    pub small_model: String,
    /// 列给 Claude 模型选择器的模型。
    pub models: Vec<String>,
    /// 因为窗口比默认模型小、没有列给 Claude 的模型（只用于状态展示）。
    pub hidden_models: Vec<String>,
    /// 模型显示名：`{"name": "...", "description": "..."}`。
    pub model_names: BTreeMap<String, Value>,
    /// 逐模型上下文窗口。
    pub model_windows: BTreeMap<String, u64>,
    /// 默认模型的上下文窗口；`None` 表示不声明，Claude 按 200k 处理。
    pub default_window: Option<u64>,
    /// 启动 Claude 时额外带上的环境变量（例如 Codex++ 的 `CLAUDE_CODE_MODEL_CAPABILITIES`）。
    pub extra_env: Vec<(String, String)>,
}

impl Upstream {
    pub fn ready(&self) -> bool {
        !self.root.trim().is_empty() && !self.default_model.trim().is_empty()
    }
}

pub trait Host: Send + Sync {
    /// 宿主的状态目录：本地服务的文件放在 `<state>/claude-local`，听写凭据等也在这里。
    fn state_dir(&self) -> PathBuf;

    /// 证书在系统钥匙串 / 证书库里的名字，两个宿主各用各的，互不覆盖。
    fn ca_name(&self) -> &str;

    /// Host-owned profile; never switch or merge the user's real Claude profile.
    fn isolated_profile_dir(&self) -> Option<PathBuf> { None }
    /// Host-owned signed application copy; None keeps upstream discovery unchanged.
    fn isolated_app_path(&self) -> Option<PathBuf> { None }
    /// Explicit runtime supplied by the host (no borrowing another application's Node).
    fn node_runtime(&self) -> Option<PathBuf> { None }


    fn load_config(&self) -> Result<ClaudeLocalSettings>;
    fn save_config(&self, config: &ClaudeLocalSettings) -> Result<()>;

    /// 状态展示用的上游：只读，不能启动任何服务。还没配好时返回错误，错误信息会显示在界面上。
    fn preview_upstream(&self, config: &ClaudeLocalSettings) -> Result<Upstream>;

    /// 启动前准备并返回真正要用的上游（Codex++ 在这里起网关、写绑定）。
    fn prepare_upstream(&self, config: &ClaudeLocalSettings) -> Result<Upstream>;

    /// 参与配置指纹的上游状态：变了就要重启本地服务。默认用预览上游（失败时为空）。
    fn upstream_fingerprint(&self, config: &ClaudeLocalSettings) -> Value {
        self.preview_upstream(config)
            .map(|upstream| {
                serde_json::json!({
                    "root": upstream.root,
                    "token": sha_hex(&upstream.token),
                    "model": upstream.default_model,
                    "small": upstream.small_model,
                    "models": upstream.models,
                    "windows": upstream.model_windows,
                    "window": upstream.default_window,
                })
            })
            .unwrap_or(Value::Null)
    }

    /// 设置里没写时，Code 页签是否和命令行共用 `~/.claude`（见 [`ClaudeLocalSettings::code_share_home`]）。
    fn default_code_share_home(&self) -> bool {
        false
    }

    /// 本地听写（SenseVoice）是否就绪：模型在、开关开着。
    fn dictation_ready(&self, config: &ClaudeLocalSettings) -> bool;

    /// 开着原生听写时，启动前确保转写服务在线（它在 `<state>/dictation-helper.json` 写凭据，
    /// 本地兼容服务按凭据把麦克风音频转过去）。
    fn prepare_dictation_service(&self) -> Result<()>;

    /// 关闭完整功能模式时的 3p 启动。只有 Codex++ 支持（经它的网关）；默认报错。
    fn launch_three_p(&self, _source: &Path, _root: &Path, _config: &ClaudeLocalSettings) -> Result<()> {
        bail!("当前程序只支持完整功能模式")
    }

    /// 诊断日志；默认丢弃。
    fn diagnostic(&self, _event: &str, _detail: Value) {}
}

fn sha_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

static HOST: OnceLock<Arc<dyn Host>> = OnceLock::new();

/// 进程启动时装一次宿主；重复调用忽略（返回 false）。
pub fn install_host(host: Arc<dyn Host>) -> bool {
    HOST.set(host).is_ok()
}

pub(crate) fn isolated_app_path() -> Option<PathBuf> {
    HOST.get().and_then(|host| host.isolated_app_path())
}

pub(crate) fn isolated_profile_dir() -> Option<PathBuf> {
    HOST.get().and_then(|host| host.isolated_profile_dir())
}

pub(crate) fn host() -> &'static Arc<dyn Host> {
    HOST.get().expect("claude_local::install_host 必须在使用前调用")
}

pub(crate) fn diagnostic(event: &str, detail: Value) {
    if let Some(host) = HOST.get() {
        host.diagnostic(event, detail);
    }
}
