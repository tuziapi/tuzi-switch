//! Explicit local MCP setup without disabling the rest of a preview's isolation.
use std::path::PathBuf;

pub(crate) fn select_config_path(
    isolated: bool,
    connect_local: bool,
    test_home: Option<PathBuf>,
    profile_home: PathBuf,
    live_home: Option<PathBuf>,
    override_dir: Option<PathBuf>,
    codex_home: Option<PathBuf>,
) -> Result<(PathBuf, &'static str), String> {
    let (directory, scope) = if let Some(home) = test_home {
        (home.join(".codex"), "isolated")
    } else if isolated && !connect_local {
        (profile_home.join(".codex"), "isolated")
    } else {
        (
            override_dir
                .or(codex_home)
                .or_else(|| live_home.map(|h| h.join(".codex")))
                .ok_or("无法确定本机 Codex 配置目录。")?,
            "local",
        )
    };
    if !directory.is_absolute() {
        return Err("Codex 配置目录必须是绝对路径。".into());
    }
    Ok((directory.join("config.toml"), scope))
}

pub(crate) fn resolve(connect_local: bool) -> Result<(PathBuf, &'static str), String> {
    select_config_path(
        cfg!(feature = "isolated-profile"),
        connect_local,
        std::env::var_os("CC_SWITCH_TEST_HOME")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from),
        crate::config::get_home_dir(),
        dirs::home_dir(),
        crate::settings::get_codex_override_dir(),
        std::env::var_os("CODEX_HOME").map(PathBuf::from),
    )
}
