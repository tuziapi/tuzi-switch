//! Claude Desktop 完整功能模式的核心：把原版 Claude Desktop 接到本机兼容服务上。
//!
//! ClaudeMom 与 Codex++ 共用这一份。宿主实现 [`Host`]（状态目录、设置、上游、听写服务），
//! 进程启动时 [`install_host`] 一次，然后调用 [`status`] / [`configure`] / [`perform`] 等。

mod backend;
pub mod cli_import;
pub mod desktop;
pub mod fsutil;
mod host;
pub mod node;
pub mod session_sync;
pub mod settings;
pub mod sysproxy;
#[cfg(windows)]
pub mod winproc;

#[cfg(feature = "dictation")]
pub mod dictation;

pub use backend::{
    ClaudeLocalResult, ClaudeLocalStatus, configure, friendly_model_name, inherited_context_tokens,
    desktop_running, launch_claude, perform, pick_context_tokens, private_dir, reap_stale_proxy, resume_attached_proxy,
    status, stop_backend, serve_headless,
};
pub use host::{Host, Upstream, install_host};
pub use settings::ClaudeLocalSettings;

/// Windows 上启动子进程不弹控制台窗口。
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;
