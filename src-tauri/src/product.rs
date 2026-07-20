//! Tuzi product identity and distribution constants.
//!
//! Keep fork-specific values here so upstream CC Switch updates do not require
//! scattered string replacements across the native codebase.

use std::path::PathBuf;

pub const APP_NAME: &str = "兔子switch";
pub const APP_CONFIG_DIR_NAME: &str = ".tuzi-switch";
pub const DATABASE_FILE_NAME: &str = "tuzi-switch.db";
pub const LOG_FILE_STEM: &str = "tuzi-switch";
pub const LOG_FILE_NAME: &str = "tuzi-switch.log";
pub const DEEP_LINK_SCHEME: &str = "tuziswitch";
pub const DEEP_LINK_PREFIX: &str = "tuziswitch://";
pub const TRAY_ID: &str = "tuzi-switch";
pub const LATEST_RELEASE_URL: &str = "https://github.com/tuziapi/tuzi-switch/releases/latest";
pub const WEBSITE_URL: &str = "https://github.com/tuziapi/tuzi-switch";
pub const WEB_UPDATE_MANIFEST_URLS: &[&str] = &[
    "https://cdn.jsdelivr.net/gh/tuziapi/tuzi-switch@release-web/latest.json",
    "https://raw.githubusercontent.com/tuziapi/tuzi-switch/release-web/latest.json",
];
pub const WEB_UPDATE_ARCHIVE_URL_PREFIX: &str =
    "https://cdn.jsdelivr.net/gh/tuziapi/tuzi-switch@release-web/";

pub fn default_app_config_dir() -> PathBuf {
    crate::config::get_home_dir().join(APP_CONFIG_DIR_NAME)
}

pub fn database_path() -> PathBuf {
    crate::config::get_app_config_dir().join(DATABASE_FILE_NAME)
}

#[cfg(target_os = "linux")]
pub fn deep_link_handler_filename() -> String {
    format!("{TRAY_ID}-handler.desktop")
}
