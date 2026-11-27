//! Manual native probe: run once with `seed`, then with `verify`.
//! Uses a dedicated app/site profile and synthetic cookies only; never logs cookie values.
#[path = "../src/commands/embedded_sites.rs"]
mod embedded_sites;
#[path = "../src/renderer_security.rs"]
mod renderer_security;
#[tauri::command]
fn probe_privileged() -> String {
    "must-not-reach-remote".into()
}
use embedded_sites::{EmbeddedSite, SiteBounds};
use tauri::Manager;

fn bounds() -> SiteBounds {
    serde_json::from_str(r#"{"x":0,"y":110,"width":1000,"height":600}"#).unwrap()
}
async fn run_probe(app: tauri::AppHandle, seed: bool) -> Result<(), String> {
    let main = app.get_webview("main").ok_or("missing main")?;
    for (site, label, domain) in [
        (EmbeddedSite::Direct, "site-direct", "web.tu-zi.com"),
        (EmbeddedSite::Shop, "site-shop", "store.tu-zi.com"),
    ] {
        embedded_sites::sync_embedded_site(main.clone(), Some(site), Some(bounds())).await?;
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let child = app.get_webview(label).ok_or("missing child")?;
        if seed {
            let cookie = format!("tuzi_native_probe=synthetic-only; Domain={domain}; Path=/; Secure; HttpOnly; Max-Age=3600").parse().map_err(|_| "invalid probe cookie")?;
            child.set_cookie(cookie).map_err(|e| e.to_string())?;
        }
        // A real remote page can take longer than the original fixed delay.
        // Require a fresh answer from the loaded document, never a prior cookie.
        let marker = format!("tuzi_ipc_probe_{}", std::process::id());
        let mut denied = false;
        for _ in 0..80 {
            child.eval(format!("if (window.__TAURI_INTERNALS__) {{ window.__TAURI_INTERNALS__.invoke('probe_privileged').then(() => {{ document.cookie='{marker}=allowed; Path=/; Secure'; }}).catch(() => {{ document.cookie='{marker}=denied; Path=/; Secure'; }}); }}")).map_err(|e| e.to_string())?;
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let cookies = child.cookies_for_url(format!("https://{domain}/").parse().unwrap()).map_err(|e| e.to_string())?;
            if cookies.iter().any(|c| c.name() == marker && c.value() == "allowed") {
                return Err(format!("{label}: remote application IPC was accepted"));
            }
            if cookies.iter().any(|c| c.name() == marker && c.value() == "denied") {
                denied = true;
                break;
            }
        }
        let cookies = child
            .cookies_for_url(format!("https://{domain}/").parse().unwrap())
            .map_err(|e| e.to_string())?;
        if !cookies
            .iter()
            .any(|c| c.name() == "tuzi_native_probe" && c.value() == "synthetic-only")
        {
            return Err(format!("{label}: synthetic cookie did not persist"));
        }
        if !denied {
            return Err(format!("{label}: no fresh IPC probe response from remote page within 20 seconds"));
        }
        // The remote child must not be allowed to control privileged windows.
        if embedded_sites::sync_embedded_site(child.clone(), None, None)
            .await
            .is_ok()
        {
            return Err("remote caller accepted".into());
        }
        embedded_sites::sync_embedded_site(main.clone(), None, None).await?;
        embedded_sites::sync_embedded_site(main.clone(), Some(site), Some(bounds())).await?;
        if app.get_window("main").is_none() {
            return Err("main window lookup failed".into());
        }
        embedded_sites::embedded_site_action(main.clone(), site, "reload".into()).await?;
        println!(
            "PASS {label}: {} cookie, hide/show, remote IPC denied, reload",
            if seed { "seeded" } else { "restart-persistent" }
        );
    }
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    Ok(())
}
fn main() {
    let seed = std::env::args().nth(1).as_deref() == Some("seed");
    tauri::Builder::default()
        .invoke_handler(renderer_security::guard(tauri::generate_handler![
            probe_privileged
        ]))
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match run_probe(handle.clone(), seed).await {
                    Ok(()) => {
                        println!("NATIVE_PROBE_PASS");
                        handle.exit(0);
                    }
                    Err(error) => {
                        eprintln!("NATIVE_PROBE_FAIL: {error}");
                        handle.exit(1);
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!(
            "examples/embedded-sites-probe/tauri.conf.json"
        ))
        .expect("native probe runtime");
}
