fn main() {
    const DEFAULT_RELEASE_REPOSITORY: &str = "tuziapi/tuzi-switch";
    println!("cargo:rerun-if-env-changed=TUZI_SWITCH_RELEASE_REPOSITORY");
    println!("cargo:rerun-if-env-changed=GITHUB_REPOSITORY");
    let release_repository = std::env::var("TUZI_SWITCH_RELEASE_REPOSITORY")
        .or_else(|_| std::env::var("GITHUB_REPOSITORY"))
        .unwrap_or_else(|_| DEFAULT_RELEASE_REPOSITORY.to_string());
    assert!(
        valid_release_repository(&release_repository),
        "invalid release repository: {release_repository}"
    );
    println!("cargo:rustc-env=TUZI_SWITCH_RELEASE_REPOSITORY={release_repository}");

    tauri_build::build();

    // Windows: Embed Common Controls v6 manifest for test binaries
    //
    // When running `cargo test`, the generated test executables don't include
    // the standard Tauri application manifest. Without Common Controls v6,
    // `tauri::test` calls fail with STATUS_ENTRYPOINT_NOT_FOUND.
    //
    // This workaround:
    // 1. Embeds the manifest into test binaries via /MANIFEST:EMBED
    // 2. Uses /MANIFEST:NO for the main binary to avoid duplicate resources
    //    (Tauri already handles manifest embedding for the app binary)
    #[cfg(target_os = "windows")]
    {
        let manifest_path = std::path::PathBuf::from(
            std::env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"),
        )
        .join("common-controls.manifest");
        let manifest_arg = format!("/MANIFESTINPUT:{}", manifest_path.display());

        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg={}", manifest_arg);
        // Avoid duplicate manifest resources in binary builds.
        println!("cargo:rustc-link-arg-bins=/MANIFEST:NO");
        println!("cargo:rerun-if-changed={}", manifest_path.display());
    }
}

fn valid_release_repository(value: &str) -> bool {
    let mut parts = value.split('/');
    let Some(owner) = parts.next() else {
        return false;
    };
    let Some(repository) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && !owner.is_empty()
        && !repository.is_empty()
        && owner.chars().all(valid_repository_char)
        && repository.chars().all(valid_repository_char)
}

fn valid_repository_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.')
}
