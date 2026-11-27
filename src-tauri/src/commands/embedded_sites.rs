//! Remote websites are child WebViews, never privileged renderer frames.
use serde::{Deserialize, Serialize};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    Emitter, Manager, Webview, WebviewUrl,
};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EmbeddedSite {
    Direct,
    Shop,
}
impl EmbeddedSite {
    fn label(self) -> &'static str {
        match self {
            Self::Direct => "site-direct",
            Self::Shop => "site-shop",
        }
    }
    fn url(self) -> &'static str {
        match self {
            Self::Direct => "https://web.tu-zi.com/login",
            Self::Shop => "https://store.tu-zi.com/",
        }
    }
}
// Only a public platform origin is remembered, never a URL path, query,
// fragment, cookie or login token. Visiting /login explicitly resets the entry.
const DIRECT_ORIGINS: &[&str] = &[
    "https://share.tu-zi.com", "https://claude.tu-zi.com", "https://grok.tu-zi.com",
    "https://share.sydney-ai.com", "https://claude.sydney-ai.com", "https://grok.sydney-ai.com",
    "https://share.opentu.ai", "https://claude.opentu.ai", "https://grok.opentu.ai",
];
#[derive(Deserialize, Serialize)]
struct SavedDirectEntry {
    version: u8,
    origin: String,
}
fn safe_direct_entry(url: &tauri::Url) -> Option<String> {
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let origin = url.origin().ascii_serialization();
    if origin == "https://web.tu-zi.com" && url.path() == "/login" {
        return Some(EmbeddedSite::Direct.url().into());
    }
    // A getToken navigation can fail; remember only the settled platform page.
    if DIRECT_ORIGINS.contains(&origin.as_str()) && url.path() == "/" {
        return Some(format!("{origin}/"));
    }
    None
}
fn read_direct_entry(path: &std::path::Path) -> String {
    let saved = std::fs::read(path).ok()
        .and_then(|bytes| serde_json::from_slice::<SavedDirectEntry>(&bytes).ok());
    saved.filter(|entry| entry.version == 1)
        .and_then(|entry| {
            let safe = safe_direct_entry(&entry.origin.parse().ok()?)?;
            (safe == entry.origin).then_some(safe)
        })
        .unwrap_or_else(|| EmbeddedSite::Direct.url().into())
}
fn write_direct_entry(path: &std::path::Path, origin: String) -> std::io::Result<()> {
    use std::io::Write;
    if read_direct_entry(path) == origin && path.exists() { return Ok(()); }
    let parent = path.parent().ok_or_else(|| std::io::Error::other("missing entry directory"))?;
    std::fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(&mut file, &SavedDirectEntry { version: 1, origin })?;
    file.flush()?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|err| err.error)?;
    Ok(())
}
#[derive(Deserialize)]
pub struct SiteBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl SiteBounds {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite() && *v >= 0.0 && *v <= 32768.0)
            && self.width >= 1.0
            && self.height >= 1.0
    }
}
#[derive(Clone, Serialize)]
struct SiteLoad {
    site: EmbeddedSite,
    loading: bool,
}
fn authorize(caller: &Webview) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("仅助手主页面可操作网站窗口".into());
    }
    Ok(())
}

// Async is required: add_child dispatches to the UI thread and waits for it.
#[tauri::command]
pub async fn sync_embedded_site(
    caller: Webview,
    site: Option<EmbeddedSite>,
    bounds: Option<SiteBounds>,
) -> Result<(), String> {
    authorize(&caller)?;
    let app = caller.app_handle();
    for candidate in [EmbeddedSite::Direct, EmbeddedSite::Shop] {
        if let Some(view) = app.get_webview(candidate.label()) {
            view.hide().map_err(|e| e.to_string())?;
        }
    }
    let Some(site) = site else {
        return Ok(());
    };
    let bounds = bounds
        .filter(SiteBounds::valid)
        .ok_or("无效的网站显示区域")?;
    let position = tauri::LogicalPosition::new(bounds.x, bounds.y);
    let size = tauri::LogicalSize::new(bounds.width, bounds.height);
    if let Some(view) = app.get_webview(site.label()) {
        view.set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|e| e.to_string())?;
        view.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let events = app.clone();
    let entry_path = app.path().app_local_data_dir().ok()
        .map(|path| path.join("website-data/direct-entry-v1.json"));
    let start_url = match site {
        EmbeddedSite::Direct => entry_path.as_deref().map(read_direct_entry)
            .unwrap_or_else(|| site.url().into()),
        EmbeddedSite::Shop => site.url().into(),
    };
    let mut builder = WebviewBuilder::new(
        site.label(),
        WebviewUrl::External(start_url.parse().unwrap()),
    )
    .incognito(false)
    .on_navigation(|url| url.scheme() == "https")
    .on_new_window(|url, _| {
        // External auth/payment windows remain explicit browser handoffs.
        // Never grant remote origins access to native commands.
        if url.scheme() == "https" {
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<String>);
        }
        NewWindowResponse::Deny
    })
    .on_page_load(move |_, event| {
        if matches!(site, EmbeddedSite::Direct) && event.event() == PageLoadEvent::Finished {
            if let (Some(path), Some(origin)) = (&entry_path, safe_direct_entry(event.url())) {
                if write_direct_entry(path, origin).is_err() {
                    log::warn!("Unable to save embedded site entry preference");
                }
            }
        }
        let _ = events.emit_to(
            "main",
            "embedded-site-load",
            SiteLoad {
                site,
                loading: event.event() == PageLoadEvent::Started,
            },
        );
    });
    // Stable per-app/per-site profile. Never clear cookies on navigation or startup.
    #[cfg(not(target_os = "macos"))]
    {
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("website-data")
            .join(site.label());
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        builder = builder.data_directory(directory);
    }
    #[cfg(target_os = "macos")]
    {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(
            format!(
                "{}:embedded-sites-v1:{}",
                app.config().identifier,
                site.label()
            )
            .as_bytes(),
        );
        let mut id = [0u8; 16];
        id.copy_from_slice(&digest[..16]);
        builder = builder.data_store_identifier(id);
        // Wry falls back to the app's persistent default store on macOS <14.
    }
    let window = app.get_window("main").ok_or("助手窗口不可用")?;
    window
        .add_child(builder, position, size)
        .map_err(|e| format!("无法加载内嵌网站: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn embedded_site_action(
    caller: Webview,
    site: EmbeddedSite,
    action: String,
) -> Result<(), String> {
    authorize(&caller)?;
    let view = caller
        .app_handle()
        .get_webview(site.label())
        .ok_or("网站尚未加载")?;
    match action.as_str() {
        "reload" => view.reload().map_err(|e| e.to_string()),
        "back" => view.eval("history.back()").map_err(|e| e.to_string()),
        _ => Err("不支持的网站操作".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resume_entry_never_persists_auth_links_or_untrusted_origins() {
        for raw in [
            "https://share.tu-zi.com/getToken?token=synthetic#access_token=synthetic",
            "https://share.tu-zi.com.evil.example/", "http://share.tu-zi.com/",
            "https://user:synthetic@share.tu-zi.com/", "https://share.tu-zi.com:444/",
            "https://unknown.example/", "https://share.tu-zi.com/c/private-chat",
        ] {
            assert!(safe_direct_entry(&raw.parse().unwrap()).is_none());
        }
        assert_eq!(safe_direct_entry(&"https://share.tu-zi.com/?token=synthetic#secret".parse().unwrap()), Some("https://share.tu-zi.com/".into()));
    }
    #[test]
    fn resume_entry_roundtrip_and_explicit_login_reset() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("entry.json");
        assert_eq!(read_direct_entry(&path), EmbeddedSite::Direct.url());
        write_direct_entry(&path, "https://share.tu-zi.com/".into()).unwrap();
        assert_eq!(read_direct_entry(&path), "https://share.tu-zi.com/");
        write_direct_entry(&path, safe_direct_entry(&"https://web.tu-zi.com/login".parse().unwrap()).unwrap()).unwrap();
        assert_eq!(read_direct_entry(&path), EmbeddedSite::Direct.url());
        for contents in [r#"{"version":2,"origin":"https://share.tu-zi.com/"}"#, r#"{"version":1,"origin":"https://share.tu-zi.com/?token=synthetic"}"#, "{}", "broken"] {
            std::fs::write(&path, contents).unwrap();
            assert_eq!(read_direct_entry(&path), EmbeddedSite::Direct.url());
        }
    }
    #[test]
    fn fixed_destinations_and_bounded_geometry() {
        assert_eq!(EmbeddedSite::Direct.url(), "https://web.tu-zi.com/login");
        assert_eq!(EmbeddedSite::Shop.url(), "https://store.tu-zi.com/");
        assert!(SiteBounds {
            x: 0.,
            y: 100.,
            width: 900.,
            height: 500.
        }
        .valid());
        for width in [0., -1., f64::NAN, f64::INFINITY, 100000.] {
            assert!(!SiteBounds {
                x: 0.,
                y: 100.,
                width,
                height: 500.
            }
            .valid());
        }
        assert!(serde_json::from_str::<EmbeddedSite>("\"https://evil.invalid\"").is_err());
    }
}
