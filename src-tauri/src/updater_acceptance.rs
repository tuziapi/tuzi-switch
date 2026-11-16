//! Real updater laboratory, compiled only with `updater-acceptance`.
//! Uses the full application and native plugin, but an isolated identity/profile.
use serde::Deserialize;
use serde_json::json;
use std::{fs, io::Write, path::Path, time::Duration};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

#[derive(Deserialize)]
struct Scenario {
    endpoint: String,
    version: String,
    mode: String,
}

const PROFILE_MARKER: &str = "SYNTHETIC updater laboratory profile\n";

fn validate_launch_profile(
    root: &Path,
    executable: &Path,
) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    if !root.is_absolute() {
        return Err("Laboratory profile must be absolute".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if fs::read_to_string(root.join(".updater-lab-profile")).map_err(|e| e.to_string())?
        != PROFILE_MARKER
        || !root.join("scenario.json").is_file()
    {
        return Err("Missing synthetic laboratory profile marker".into());
    }
    let home = root
        .join("home")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let executable = executable.canonicalize().map_err(|e| e.to_string())?;
    if home.parent() != Some(root.as_path()) || !executable.starts_with(&root) {
        return Err("Laboratory executable and home must remain inside the profile".into());
    }
    Ok((root, home))
}

/// NSIS RunAsUser rebuilds the environment when dropping administrator rights.
/// Restore only the explicitly marked test profile, before any app storage opens.
/// This function and its argument are absent from production builds.
pub fn restore_launch_profile() -> Result<(), String> {
    // AppImage runs its inner executable outside the installation directory;
    // only Windows RunAsUser needs this environment restoration.
    if !cfg!(target_os = "windows") {
        return Ok(());
    }
    let args: Vec<_> = std::env::args().collect();
    if !args
        .iter()
        .any(|arg| arg == "--tuzi-verify-updater-install")
    {
        return Ok(());
    }
    let supplied: Vec<_> = args
        .iter()
        .filter_map(|arg| arg.strip_prefix("--tuzi-updater-qa-root="))
        .collect();
    if supplied.len() != 1 {
        return Err("Expected one explicit laboratory profile argument".into());
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let (root, home) = validate_launch_profile(Path::new(supplied[0]), &executable)?;
    let recovered = std::env::var_os("TUZI_UPDATER_QA_ROOT").is_none()
        || std::env::var_os("CC_SWITCH_TEST_HOME").is_none();
    for (name, expected) in [
        ("TUZI_UPDATER_QA_ROOT", &root),
        ("CC_SWITCH_TEST_HOME", &home),
    ] {
        if let Some(previous) = std::env::var_os(name) {
            if Path::new(&previous)
                .canonicalize()
                .map_err(|e| e.to_string())?
                != *expected
            {
                return Err("Conflicting laboratory profile environment".into());
            }
        }
        std::env::set_var(name, expected);
    }
    record(
        &root,
        "profile-restored",
        json!({"environmentRecovered":recovered}),
    )
}

fn record(root: &Path, event: &str, detail: serde_json::Value) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("events.jsonl"))
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", json!({"event":event,"detail":detail})).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

fn verify_data(app: &tauri::AppHandle, home: &Path) -> Result<(), String> {
    let state = app.state::<crate::AppState>();
    let provider = state
        .db
        .get_provider_by_id("SYNTHETIC-UPGRADE", "claude")
        .map_err(|e| e.to_string())?
        .ok_or("Synthetic provider disappeared")?;
    if provider.name != "SYNTHETIC upgrade preservation"
        || provider.settings_config != json!({"synthetic":true,"value":"preserve-me"})
    {
        return Err("Synthetic provider changed".into());
    }
    for name in [
        ".claude/upgrade-fixture.json",
        ".tuzi-switch/upgrade-project.json",
    ] {
        if fs::read_to_string(home.join(name)).map_err(|e| e.to_string())?
            != "SYNTHETIC preservation fixture\n"
        {
            return Err(format!("Fixture changed: {name}"));
        }
    }
    Ok(())
}

async fn execute(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    let home = root
        .join("home")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if app.config().identifier != "com.tuziswitch.desktop.update-qa"
        || crate::config::get_home_dir()
            .canonicalize()
            .map_err(|e| e.to_string())?
            != home
        || crate::config::get_app_config_dir()
            .canonicalize()
            .map_err(|e| e.to_string())?
            != home
                .join(".tuzi-switch")
                .canonicalize()
                .map_err(|e| e.to_string())?
    {
        return Err("Refusing non-isolated updater test".into());
    }
    let scenario: Scenario =
        serde_json::from_slice(&fs::read(root.join("scenario.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let endpoint: url::Url = scenario
        .endpoint
        .parse()
        .map_err(|_| "Invalid test endpoint")?;
    if endpoint.scheme() != "http"
        || endpoint.host_str() != Some("127.0.0.1")
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
    {
        return Err("Only loopback fixtures are permitted".into());
    }
    let version = app.package_info().version.to_string();
    record(
        root,
        "started",
        json!({"version":version,"pid":std::process::id(),"bundleType":format!("{:?}",tauri::utils::platform::bundle_type()),"executable":std::env::current_exe().map_err(|e|e.to_string())?}),
    )?;
    if version == scenario.version {
        let history = fs::read_to_string(root.join("events.jsonl")).map_err(|e| e.to_string())?;
        if !history
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .any(|entry| {
                entry["event"] == "installed"
                    || (cfg!(target_os = "windows") && entry["event"] == "install-started")
            })
        {
            return Err("New version started without a recorded installation".into());
        }
        verify_data(app, &home)?;
        record(
            root,
            "passed",
            json!({"version":version,"restarted":true,"dataPreserved":true}),
        )?;
        app.exit(0);
        return Ok(());
    }

    if root.join("seeded").exists() {
        verify_data(app, &home)?;
    } else {
        let provider = crate::provider::Provider::with_id(
            "SYNTHETIC-UPGRADE".into(),
            "SYNTHETIC upgrade preservation".into(),
            json!({"synthetic":true,"value":"preserve-me"}),
            None,
        );
        app.state::<crate::AppState>()
            .db
            .save_provider("claude", &provider)
            .map_err(|e| e.to_string())?;
        for name in [
            ".claude/upgrade-fixture.json",
            ".tuzi-switch/upgrade-project.json",
        ] {
            let file = home.join(name);
            fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
            fs::write(file, "SYNTHETIC preservation fixture\n").map_err(|e| e.to_string())?;
        }
        fs::write(root.join("seeded"), "SYNTHETIC fixture initialized")
            .map_err(|e| e.to_string())?;
    }
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(15));
    // Preserve the plugin's real cleanup; only record its boundaries in the
    // isolated acceptance build so a failed handoff cannot look like a pass.
    #[cfg(target_os = "windows")]
    let updater = {
        let app = app.clone();
        let root = root.to_path_buf();
        updater.on_before_exit(move || {
            let _ = record(&root, "cleanup-started", json!({}));
            app.cleanup_before_exit();
            let _ = record(&root, "cleanup-completed", json!({}));
        })
    };
    let updater = updater.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    if scenario.mode == "no-update" {
        if update.is_some() {
            return Err("Unexpected update/downgrade".into());
        }
        verify_data(app, &home)?;
        record(
            root,
            "passed",
            json!({"noUpdate":true,"dataPreserved":true}),
        )?;
        app.exit(0);
        return Ok(());
    }
    let update = update.ok_or("Expected a native update")?;
    if update.version != scenario.version {
        return Err("Unexpected update version".into());
    }
    record(root, "available", json!({"version":update.version}))?;
    let downloaded = update.download(|_, _| {}, || {}).await;
    if scenario.mode == "download-error" {
        let error = downloaded.err().ok_or("Invalid download was accepted")?;
        verify_data(app, &home)?;
        record(
            root,
            "passed",
            json!({"downloadRejected":true,"error":error.to_string(),"dataPreserved":true}),
        )?;
        app.exit(0);
        return Ok(());
    }
    let bytes = downloaded.map_err(|e| e.to_string())?;
    record(root, "verified", json!({"bytes":bytes.len()}))?;
    record(root, "install-started", json!({"version":update.version}))?;
    #[cfg(feature = "claude-desktop-local")]
    crate::claude_local_integration::begin_shutdown()?;
    let installed = update.install(bytes);
    if scenario.mode == "install-error" {
        let error = installed.err().ok_or("Invalid archive was installed")?;
        verify_data(app, &home)?;
        record(
            root,
            "passed",
            json!({"installRejected":true,"error":error.to_string(),"dataPreserved":true}),
        )?;
        app.exit(0);
        return Ok(());
    }
    installed.map_err(|e| e.to_string())?;
    record(root, "installed", json!({"version":update.version}))?;
    app.restart();
}

pub fn run(app: &tauri::AppHandle) {
    if !std::env::args().any(|arg| arg == "--tuzi-verify-updater-install") {
        return;
    }
    let Ok(root) = std::env::var("TUZI_UPDATER_QA_ROOT") else {
        app.exit(2);
        return;
    };
    let root = std::path::PathBuf::from(root);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = execute(&app, &root).await {
            let _ = record(&root, "failed", json!({"error":error}));
            app.exit(2);
        }
    });
}

#[cfg(test)]
mod launch_profile_tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("profile with spaces");
        fs::create_dir_all(root.join("home")).unwrap();
        fs::write(root.join(".updater-lab-profile"), PROFILE_MARKER).unwrap();
        fs::write(root.join("scenario.json"), "{}").unwrap();
        let exe = root.join("synthetic.exe");
        fs::write(&exe, "SYNTHETIC").unwrap();
        (temp, root, exe)
    }

    #[test]
    fn accepts_marked_profile_with_spaces() {
        let (_temp, root, exe) = fixture();
        let (validated, home) = validate_launch_profile(&root, &exe).unwrap();
        assert_eq!(validated, root.canonicalize().unwrap());
        assert_eq!(home, root.join("home").canonicalize().unwrap());
    }

    #[test]
    fn rejects_missing_marker_and_outside_executable() {
        let (temp, root, exe) = fixture();
        let outside = temp.path().join("outside.exe");
        fs::write(&outside, "SYNTHETIC").unwrap();
        assert!(validate_launch_profile(&root, &outside).is_err());
        fs::remove_file(root.join(".updater-lab-profile")).unwrap();
        assert!(validate_launch_profile(&root, &exe).is_err());
    }

    #[test]
    fn rejects_relative_profile_and_missing_scenario() {
        let (_temp, root, exe) = fixture();
        assert!(validate_launch_profile(Path::new("relative"), &exe).is_err());
        fs::remove_file(root.join("scenario.json")).unwrap();
        assert!(validate_launch_profile(&root, &exe).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_home_symlink_outside_profile() {
        let (temp, root, exe) = fixture();
        fs::remove_dir(root.join("home")).unwrap();
        std::os::unix::fs::symlink(temp.path(), root.join("home")).unwrap();
        assert!(validate_launch_profile(&root, &exe).is_err());
    }
}
