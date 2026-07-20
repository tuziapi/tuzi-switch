use std::{
    collections::BTreeMap,
    ffi::OsStr,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use base64::{engine::general_purpose, Engine as _};
use flate2::read::GzDecoder;
use futures::StreamExt;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{http, AppHandle, Manager};

const WEB_UPDATE_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEU0REY1Nzg5OTc1ODNGMgpSV1R5ZzNXWmVQVk5EdEhGWlg0UkdSVFArcXpQUUNWWitSTTB1K25CMkNUU09yc2xRZUNqQTJKMwo=";
const ACTIVE_VERSION_FILE: &str = "active-web-version";
const TUZI_CONTRACT_FILE: &str = ".tuzi-contract-v1";
const MAX_ARCHIVE_BYTES: u64 = 30 * 1024 * 1024;
const FORBIDDEN_PROJECT_SWITCHER_MARKERS: &[&str] = &["components/profiles/ProfileSwitcher"];
const REQUIRED_TUZI_ASSET_MARKERS: &[&str] = &[
    "tuziswitch:update:dismissedVersion",
    "get_web_hot_update_status",
    "check_web_hot_update",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebHotUpdateStatus {
    pub bundled_version: String,
    pub active_version: Option<String>,
    pub pending_version: Option<String>,
    pub manifest_url: String,
    pub using_hot_assets: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebHotUpdateResult {
    pub updated: bool,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebManifest {
    version: String,
    app_version_range: String,
    #[serde(default)]
    required_capabilities: BTreeMap<String, String>,
    archive: WebArchive,
}

#[derive(Debug, Clone, Deserialize)]
struct WebArchive {
    url: String,
    sha256: String,
    signature: String,
}

pub fn register_protocol<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_uri_scheme_protocol("tuziweb", |_ctx, request| {
        match serve_hot_asset(request.uri().path()) {
            Ok(response) => response,
            Err(status) => text_response(status, "not found"),
        }
    })
}

pub fn navigate_main_window_if_available(app: &AppHandle) {
    if active_web_root().is_none() {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        match url::Url::parse("tuziweb://localhost/index.html") {
            Ok(url) => {
                if let Err(err) = window.navigate(url) {
                    log::warn!("加载热更新前端资源失败，将继续使用内置资源: {err}");
                }
            }
            Err(err) => log::warn!("构造热更新 URL 失败: {err}"),
        }
    }
}

#[tauri::command]
pub async fn get_web_hot_update_status() -> Result<WebHotUpdateStatus, String> {
    Ok(build_status())
}

#[tauri::command]
pub async fn check_web_hot_update() -> Result<WebHotUpdateResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("初始化更新客户端失败: {e}"))?;

    let manifest = fetch_web_manifest(&client).await?;
    validate_manifest(&manifest)?;

    let current_app_version = env!("CARGO_PKG_VERSION");
    if !is_version_compatible(current_app_version, &manifest.app_version_range) {
        return Ok(WebHotUpdateResult {
            updated: false,
            version: Some(manifest.version),
            message: "界面更新与当前应用版本不兼容".to_string(),
        });
    }
    if !crate::capabilities::required_capabilities_supported(&manifest.required_capabilities) {
        return Ok(WebHotUpdateResult {
            updated: false,
            version: Some(manifest.version),
            message: "界面更新需要更新的应用版本".to_string(),
        });
    }

    if active_version().as_deref() == Some(manifest.version.as_str()) && active_web_root().is_some()
    {
        return Ok(WebHotUpdateResult {
            updated: false,
            version: Some(manifest.version),
            message: "界面已是最新版本".to_string(),
        });
    }

    let archive_path = download_archive(&client, &manifest).await?;
    verify_archive(&archive_path, &manifest)?;
    install_archive(&archive_path, &manifest.version)?;
    cleanup_old_versions(&manifest.version);

    Ok(WebHotUpdateResult {
        updated: true,
        version: Some(manifest.version),
        message: "界面更新已下载，将在下次重启后生效".to_string(),
    })
}

fn build_status() -> WebHotUpdateStatus {
    let active = active_version();
    WebHotUpdateStatus {
        bundled_version: env!("CARGO_PKG_VERSION").to_string(),
        pending_version: active.clone(),
        using_hot_assets: active_web_root().is_some(),
        active_version: active,
        manifest_url: crate::product::WEB_UPDATE_MANIFEST_URLS[0].to_string(),
    }
}

async fn fetch_web_manifest(client: &reqwest::Client) -> Result<WebManifest, String> {
    let mut last_error = String::new();
    for url in crate::product::WEB_UPDATE_MANIFEST_URLS {
        let result = async {
            client
                .get(*url)
                .send()
                .await
                .map_err(|e| format!("检查界面更新失败: {e}"))?
                .error_for_status()
                .map_err(|e| format!("界面更新清单不可用: {e}"))?
                .json()
                .await
                .map_err(|e| format!("解析界面更新清单失败: {e}"))
        }
        .await;

        match result {
            Ok(manifest) => return Ok(manifest),
            Err(error) => {
                last_error = format!("{url}: {error}");
                log::warn!("界面更新清单拉取失败，尝试下一个地址: {last_error}");
            }
        }
    }
    Err(if last_error.is_empty() {
        "界面更新清单不可用".to_string()
    } else {
        last_error
    })
}

fn validate_manifest(manifest: &WebManifest) -> Result<(), String> {
    validate_version(&manifest.version)?;
    if manifest.archive.url.len() > 2048
        || !manifest
            .archive
            .url
            .starts_with(crate::product::WEB_UPDATE_ARCHIVE_URL_PREFIX)
    {
        return Err("界面更新包 URL 不可信".to_string());
    }
    if manifest.archive.sha256.len() != 64
        || !manifest
            .archive
            .sha256
            .chars()
            .all(|c| c.is_ascii_hexdigit())
    {
        return Err("界面更新包 sha256 无效".to_string());
    }
    if manifest.archive.signature.trim().is_empty() {
        return Err("界面更新包签名缺失".to_string());
    }
    Ok(())
}

fn validate_version(version: &str) -> Result<(), String> {
    let ok = version.len() <= 64
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    ok.then_some(()).ok_or_else(|| "界面版本号无效".to_string())
}

async fn download_archive(
    client: &reqwest::Client,
    manifest: &WebManifest,
) -> Result<PathBuf, String> {
    let tmp_dir = root_dir().join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;
    let archive_path = tmp_dir.join(format!("web-assets-{}.tar.gz", manifest.version));
    let tmp_path = archive_path.with_extension("download");

    let response = client
        .get(&manifest.archive.url)
        .send()
        .await
        .map_err(|e| format!("下载界面更新失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("界面更新包不可用: {e}"))?;

    let mut file = fs::File::create(&tmp_path).map_err(|e| format!("创建临时文件失败: {e}"))?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取界面更新流失败: {e}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_ARCHIVE_BYTES {
            let _ = fs::remove_file(&tmp_path);
            return Err("界面更新包过大".to_string());
        }
        file.write_all(&chunk)
            .map_err(|e| format!("写入界面更新包失败: {e}"))?;
    }
    file.sync_all()
        .map_err(|e| format!("同步界面更新包失败: {e}"))?;
    fs::rename(&tmp_path, &archive_path).map_err(|e| format!("保存界面更新包失败: {e}"))?;
    Ok(archive_path)
}

fn verify_archive(path: &Path, manifest: &WebManifest) -> Result<(), String> {
    let data = fs::read(path).map_err(|e| format!("读取界面更新包失败: {e}"))?;
    let digest = hex_lower(&Sha256::digest(&data));
    if digest != manifest.archive.sha256.to_ascii_lowercase() {
        return Err("界面更新包校验失败".to_string());
    }

    let pubkey_text = decode_base64_utf8(WEB_UPDATE_PUBKEY)?;
    let public_key = PublicKey::decode(&pubkey_text).map_err(|e| format!("公钥解析失败: {e}"))?;
    let signature_text = decode_base64_utf8(&manifest.archive.signature)?;
    let signature = Signature::decode(&signature_text).map_err(|e| format!("签名解析失败: {e}"))?;
    public_key
        .verify(signature_payload(manifest).as_bytes(), &signature, true)
        .map_err(|e| format!("界面更新包签名校验失败: {e}"))
}

fn signature_payload(manifest: &WebManifest) -> String {
    format!(
        "{}\n{}\n{}\n",
        manifest.archive.sha256.to_ascii_lowercase(),
        manifest.version,
        manifest.app_version_range
    )
}

fn install_archive(path: &Path, version: &str) -> Result<(), String> {
    let versions_dir = root_dir().join("versions");
    let final_dir = versions_dir.join(version);
    let staging_dir = root_dir().join("staging").join(version);

    let _ = fs::remove_dir_all(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|e| format!("创建解包目录失败: {e}"))?;

    let file = fs::File::open(path).map_err(|e| format!("打开界面更新包失败: {e}"))?;
    let mut archive = tar::Archive::new(GzDecoder::new(file));
    for entry in archive
        .entries()
        .map_err(|e| format!("读取界面更新包失败: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("读取界面更新条目失败: {e}"))?;
        let safe_path = safe_archive_path(
            &entry
                .path()
                .map_err(|e| format!("读取界面更新路径失败: {e}"))?,
        )?;
        let target = staging_dir.join(safe_path);
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("创建界面目录失败: {e}"))?;
        } else if entry.header().entry_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建界面目录失败: {e}"))?;
            }
            entry
                .unpack(&target)
                .map_err(|e| format!("解包界面资源失败: {e}"))?;
        }
    }

    if !staging_dir.join("index.html").is_file() {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err("界面更新包缺少 index.html".to_string());
    }

    if contains_forbidden_project_switcher(&staging_dir)? {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err("界面更新包包含不属于兔子switch的项目切换入口，已跳过".to_string());
    }
    if !contains_required_tuzi_markers(&staging_dir)? {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err("界面更新包缺少兔子switch功能契约，已跳过".to_string());
    }
    fs::write(staging_dir.join(TUZI_CONTRACT_FILE), b"tuzi-web-v1\n")
        .map_err(|e| format!("写入界面功能契约失败: {e}"))?;

    fs::create_dir_all(&versions_dir).map_err(|e| format!("创建版本目录失败: {e}"))?;
    let _ = fs::remove_dir_all(&final_dir);
    fs::rename(&staging_dir, &final_dir).map_err(|e| format!("切换界面版本失败: {e}"))?;
    fs::write(root_dir().join(ACTIVE_VERSION_FILE), version)
        .map_err(|e| format!("写入界面版本状态失败: {e}"))
}

fn contains_forbidden_project_switcher(root: &Path) -> Result<bool, String> {
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("读取界面目录失败: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取界面目录失败: {e}"))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|e| format!("读取界面文件类型失败: {e}"))?;

            if file_type.is_dir() {
                stack.push(path);
                continue;
            }

            if file_type.is_file() && should_scan_hot_asset(&path) {
                let data = fs::read(&path).map_err(|e| format!("读取界面资源失败: {e}"))?;
                let text = String::from_utf8_lossy(&data);
                if FORBIDDEN_PROJECT_SWITCHER_MARKERS
                    .iter()
                    .any(|marker| text.contains(marker))
                {
                    return Ok(true);
                }
            }
        }
    }

    Ok(false)
}

fn contains_required_tuzi_markers(root: &Path) -> Result<bool, String> {
    let mut found = vec![false; REQUIRED_TUZI_ASSET_MARKERS.len()];
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("读取界面目录失败: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取界面目录失败: {e}"))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|e| format!("读取界面文件类型失败: {e}"))?;
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() && should_scan_hot_asset(&path) {
                let data = fs::read(&path).map_err(|e| format!("读取界面资源失败: {e}"))?;
                let text = String::from_utf8_lossy(&data);
                for (index, marker) in REQUIRED_TUZI_ASSET_MARKERS.iter().enumerate() {
                    found[index] |= text.contains(marker);
                }
            }
        }
    }

    Ok(found.into_iter().all(|value| value))
}

fn should_scan_hot_asset(path: &Path) -> bool {
    matches!(
        path.extension().and_then(OsStr::to_str),
        Some("html" | "js" | "mjs" | "css" | "json")
    )
}

fn serve_hot_asset(path: &str) -> Result<http::Response<Vec<u8>>, http::StatusCode> {
    let root = active_web_root().ok_or(http::StatusCode::NOT_FOUND)?;
    let relative = request_path_to_relative(path)?;
    let mut target = root.join(&relative);
    if !target.exists() && relative.extension().is_none() {
        target = root.join("index.html");
    }

    let canonical = target
        .canonicalize()
        .map_err(|_| http::StatusCode::NOT_FOUND)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| http::StatusCode::NOT_FOUND)?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err(http::StatusCode::NOT_FOUND);
    }

    let mut file = fs::File::open(&canonical).map_err(|_| http::StatusCode::NOT_FOUND)?;
    let mut body = Vec::new();
    file.read_to_end(&mut body)
        .map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)?;
    http::Response::builder()
        .status(http::StatusCode::OK)
        .header(http::header::CONTENT_TYPE, content_type(&canonical))
        .body(body)
        .map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)
}

fn request_path_to_relative(path: &str) -> Result<PathBuf, http::StatusCode> {
    let decoded =
        percent_decode(path.trim_start_matches('/')).ok_or(http::StatusCode::BAD_REQUEST)?;
    if decoded.is_empty() {
        return Ok(PathBuf::from("index.html"));
    }
    if decoded.contains('\\') || decoded.contains('\0') {
        return Err(http::StatusCode::BAD_REQUEST);
    }
    safe_archive_path(Path::new(&decoded)).map_err(|_| http::StatusCode::BAD_REQUEST)
}

fn safe_archive_path(path: &Path) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) if is_safe_component(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err("界面更新包包含不安全路径".to_string()),
        }
    }
    if out.as_os_str().is_empty() {
        Err("界面更新包路径为空".to_string())
    } else {
        Ok(out)
    }
}

fn is_safe_component(component: &OsStr) -> bool {
    let value = component.to_string_lossy();
    !value.is_empty() && !value.contains('\0') && !value.contains(':') && !value.contains('\\')
}

fn root_dir() -> PathBuf {
    crate::config::get_app_config_dir().join("web-hot-update")
}

fn active_version() -> Option<String> {
    fs::read_to_string(root_dir().join(ACTIVE_VERSION_FILE))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| validate_version(s).is_ok())
}

fn active_web_root() -> Option<PathBuf> {
    let root = root_dir().join("versions").join(active_version()?);
    (root.join("index.html").is_file() && root.join(TUZI_CONTRACT_FILE).is_file()).then_some(root)
}

fn cleanup_old_versions(current_version: &str) {
    let Ok(entries) = fs::read_dir(root_dir().join("versions")) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().and_then(OsStr::to_str) != Some(current_version) {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn is_version_compatible(version: &str, range: &str) -> bool {
    range.split_whitespace().all(|rule| {
        if let Some(required) = rule.strip_prefix(">=") {
            compare_versions(version, required) >= 0
        } else if let Some(required) = rule.strip_prefix('>') {
            compare_versions(version, required) > 0
        } else if let Some(required) = rule.strip_prefix("<=") {
            compare_versions(version, required) <= 0
        } else if let Some(required) = rule.strip_prefix('<') {
            compare_versions(version, required) < 0
        } else if let Some(required) = rule.strip_prefix('=') {
            compare_versions(version, required) == 0
        } else {
            compare_versions(version, rule) == 0
        }
    })
}

fn compare_versions(a: &str, b: &str) -> i8 {
    let pa = parse_semver_core(a);
    let pb = parse_semver_core(b);
    for i in 0..3 {
        match pa[i].cmp(&pb[i]) {
            std::cmp::Ordering::Greater => return 1,
            std::cmp::Ordering::Less => return -1,
            std::cmp::Ordering::Equal => {}
        }
    }
    0
}

fn parse_semver_core(version: &str) -> [u64; 3] {
    let clean = version
        .trim_start_matches('v')
        .split('-')
        .next()
        .unwrap_or(version);
    let mut out = [0, 0, 0];
    for (idx, part) in clean.split('.').take(3).enumerate() {
        out[idx] = part.parse().unwrap_or(0);
    }
    out
}

fn decode_base64_utf8(input: &str) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    String::from_utf8(bytes).map_err(|e| format!("utf8 解码失败: {e}"))
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn percent_decode(input: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(input.len());
    let raw = input.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' {
            if i + 2 >= raw.len() {
                return None;
            }
            let hex = std::str::from_utf8(&raw[i + 1..i + 3]).ok()?;
            bytes.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            bytes.push(raw[i]);
            i += 1;
        }
    }
    String::from_utf8(bytes).ok()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(OsStr::to_str).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "wasm" => "application/wasm",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn text_response(status: http::StatusCode, message: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_range_supports_basic_comparisons() {
        assert!(is_version_compatible("3.17.0", ">=3.17.0 <3.18.0"));
        assert!(!is_version_compatible("3.18.0", ">=3.17.0 <3.18.0"));
    }

    #[test]
    fn safe_archive_path_rejects_traversal() {
        assert!(safe_archive_path(Path::new("assets/app.js")).is_ok());
        assert!(safe_archive_path(Path::new("../app.js")).is_err());
        assert!(safe_archive_path(Path::new("/tmp/app.js")).is_err());
        assert!(safe_archive_path(Path::new("C:/app.js")).is_err());
    }

    #[test]
    fn percent_decode_rejects_invalid_utf8() {
        assert_eq!(
            percent_decode("assets%2Fapp.js").as_deref(),
            Some("assets/app.js")
        );
        assert!(percent_decode("%ff").is_none());
    }

    #[test]
    fn hot_asset_scan_rejects_project_switcher_markers() {
        let dir = tempfile::tempdir().expect("tempdir");
        let assets = dir.path().join("assets");
        fs::create_dir_all(&assets).expect("create assets");
        fs::write(
            assets.join("app.js"),
            "import './components/profiles/ProfileSwitcher'",
        )
        .expect("write js");

        assert!(contains_forbidden_project_switcher(dir.path()).expect("scan assets"));
    }

    #[test]
    fn hot_asset_scan_allows_normal_assets() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("index.html"), "<div>兔子switch</div>").expect("write html");
        fs::write(
            dir.path().join("logo.png"),
            b"components/profiles/ProfileSwitcher",
        )
        .expect("write png");

        assert!(!contains_forbidden_project_switcher(dir.path()).expect("scan assets"));
    }

    #[test]
    fn hot_asset_scan_requires_tuzi_feature_markers() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(
            dir.path().join("app.js"),
            REQUIRED_TUZI_ASSET_MARKERS.join("\n"),
        )
        .expect("write js");
        assert!(contains_required_tuzi_markers(dir.path()).expect("scan markers"));

        fs::write(dir.path().join("app.js"), "plain cc assets").expect("replace js");
        assert!(!contains_required_tuzi_markers(dir.path()).expect("scan markers"));
    }

    #[test]
    fn signature_payload_is_stable() {
        let manifest = WebManifest {
            version: "3.17.0-tuzi.1-web.1".to_string(),
            app_version_range: ">=3.17.0-tuzi.1 <3.18.0".to_string(),
            required_capabilities: BTreeMap::new(),
            archive: WebArchive {
                url: "https://cdn.jsdelivr.net/gh/tuziapi/tuzi-switch@release-web/versions/v3.17.0-tuzi.1/web.tar.gz".to_string(),
                sha256: "ABCDEF".to_string(),
                signature: "sig".to_string(),
            },
        };
        assert_eq!(
            signature_payload(&manifest),
            "abcdef\n3.17.0-tuzi.1-web.1\n>=3.17.0-tuzi.1 <3.18.0\n"
        );
    }
}
