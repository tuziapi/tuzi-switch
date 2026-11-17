//! 找 Node 运行时（本地兼容服务是 Node 脚本）。

use std::path::PathBuf;

/// 找 Node：`CLAUDE_LOCAL_NODE`（或 `CODEX_PLUS_NODE`） → Codex App 自带的 cua_node → PATH 与常见安装目录。
pub fn locate_node() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CLAUDE_LOCAL_NODE")
        .or_else(|| std::env::var_os("CODEX_PLUS_NODE"))
        .map(PathBuf::from)
    {
        if path.is_absolute() && path.is_file() {
            return Some(path);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
        ));
        candidates.push(PathBuf::from(
            "/Applications/Codex.app/Contents/Resources/cua_node/bin/node",
        ));
        if let Some(base) = directories::BaseDirs::new() {
            candidates.push(
                base.home_dir()
                    .join("Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"),
            );
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .or_else(|| locate_program("node"))
}

/// 在 PATH 与常见安装目录里找程序。访达启动的 App 拿不到 shell 的 PATH，补上常见位置。
pub fn locate_program(name: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) {
        vec![format!("{name}.exe"), format!("{name}.cmd"), name.to_string()]
    } else {
        vec![name.to_string()]
    };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    if let Some(base) = directories::BaseDirs::new() {
        for extra in [".local/bin", ".volta/bin", ".npm-global/bin", ".bun/bin"] {
            dirs.push(base.home_dir().join(extra));
        }
    }
    if cfg!(unix) {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
    }
    dirs.into_iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| path.is_file())
}
