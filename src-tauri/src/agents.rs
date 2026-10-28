//! User-scoped, tool-native Agent Markdown files. No execution or cross-tool conversion.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

static LOCK: Mutex<()> = Mutex::new(());
const MAX_FILE: usize = 256 * 1024;
const MAX_FILES: usize = 200;
const MAX_TOTAL: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentTool {
    Claude,
    Opencode,
}
impl AgentTool {
    fn id(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Opencode => "opencode",
        }
    }
    fn root(self) -> PathBuf {
        #[cfg(feature = "local-preview")]
        let base = match self {
            Self::Claude => crate::config::get_home_dir().join(".claude"),
            Self::Opencode => crate::config::get_home_dir().join(".config/opencode"),
        };
        #[cfg(not(feature = "local-preview"))]
        let base = match self {
            Self::Claude => crate::config::get_claude_config_dir(),
            Self::Opencode => crate::opencode_config::get_opencode_dir(),
        };
        base.join("agents")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFile {
    id: String,
    content: String,
    validation_error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: String,
    path: String,
    files: Vec<AgentFile>,
    can_restore: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    revision: String,
    id: String,
    #[serde(deserialize_with = "required_content")]
    content: Option<String>,
}
fn required_content<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
#[derive(Serialize, Deserialize)]
struct Backup {
    root: PathBuf,
    id: String,
    before: Option<String>,
    after: String,
}

fn safe_path(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("Agent paths must not contain symbolic links".into())
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Cannot inspect Agent path".into()),
        }
    }
    Ok(())
}
fn validate_id(id: &str) -> Result<(), String> {
    if id.len() > 240
        || !id.ends_with(".md")
        || id.contains('\\')
        || id.contains(':')
        || id.contains("//")
        || id.split('/').any(|p| p == "." || p == "..")
        || Path::new(id).is_absolute()
    {
        return Err("Use a relative Agent filename ending in .md".into());
    }
    for part in Path::new(id).components() {
        let Component::Normal(part) = part else {
            return Err("Invalid Agent filename".into());
        };
        let part = part.to_str().ok_or("Invalid Agent filename")?;
        if part.starts_with('.')
            || part.trim() != part
            || part.is_empty()
            || part.chars().any(char::is_control)
        {
            return Err("Invalid Agent filename".into());
        }
    }
    Ok(())
}
fn validate(tool: AgentTool, content: &str) -> Result<String, String> {
    if content.len() > MAX_FILE || content.contains('\0') {
        return Err("Agent file is too large or contains NUL".into());
    }
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        return Err("Agent requires YAML frontmatter between --- lines".into());
    }
    let mut header = Vec::new();
    let mut closed = false;
    for line in lines.by_ref() {
        if line == "---" {
            closed = true;
            break;
        }
        header.push(line);
    }
    if !closed {
        return Err("Agent frontmatter is not closed".into());
    }
    let value: serde_yaml::Value =
        serde_yaml::from_str(&header.join("\n")).map_err(|_| "Invalid Agent YAML frontmatter")?;
    if !value.is_mapping() {
        return Err("Agent frontmatter must be a mapping".into());
    }
    let required = |key: &str| {
        value
            .get(key)
            .and_then(serde_yaml::Value::as_str)
            .filter(|v| !v.trim().is_empty())
    };
    required("description").ok_or("Agent description is required")?;
    let name = match tool {
        AgentTool::Claude => {
            let name = required("name").ok_or("Claude Agent name is required")?;
            if name.len() > 100
                || !name
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            {
                return Err(
                    "Claude Agent name must use lowercase letters, digits and hyphens".into(),
                );
            }
            name.to_owned()
        }
        AgentTool::Opencode => {
            if value
                .get("mode")
                .is_some_and(|v| !matches!(v.as_str(), Some("subagent" | "primary" | "all")))
            {
                return Err("OpenCode mode must be subagent, primary or all".into());
            }
            String::new()
        }
    };
    if lines.collect::<Vec<_>>().join("\n").trim().is_empty() {
        return Err("Agent instructions are required".into());
    }
    Ok(name)
}
fn read_file(path: &Path, limit: usize) -> Result<String, String> {
    safe_path(path)?;
    let meta = fs::metadata(path).map_err(|_| "Cannot inspect Agent file")?;
    if !meta.is_file() || meta.len() > limit as u64 {
        return Err("Agent file must be a regular file within the size limit".into());
    }
    fs::read_to_string(path).map_err(|_| "Cannot read Agent file as UTF-8".into())
}
fn collect(root: &Path) -> Result<BTreeMap<String, String>, String> {
    safe_path(root)?;
    let mut files = BTreeMap::new();
    fn walk(
        root: &Path,
        dir: &Path,
        depth: usize,
        files: &mut BTreeMap<String, String>,
        total: &mut usize,
    ) -> Result<(), String> {
        if depth > 8 {
            return Err("Agent directory nesting exceeds 8 levels".into());
        }
        for entry in fs::read_dir(dir).map_err(|_| "Cannot read Agent directory")? {
            let entry = entry.map_err(|_| "Cannot read Agent directory entry")?;
            let path = entry.path();
            let kind = entry.file_type().map_err(|_| "Cannot inspect Agent file")?;
            if kind.is_symlink() {
                return Err("Agent directory contains a symbolic link; resolve it in the tool before editing".into());
            }
            if kind.is_dir() {
                walk(root, &path, depth + 1, files, total)?;
            } else if path.extension().is_some_and(|v| v == "md") {
                let id = path
                    .strip_prefix(root)
                    .map_err(|_| "Invalid Agent path")?
                    .to_str()
                    .ok_or("Agent filename is not UTF-8")?
                    .replace('\\', "/");
                let content = read_file(&path, MAX_FILE)?;
                *total += content.len();
                if files.len() >= MAX_FILES || *total > MAX_TOTAL {
                    return Err("Agent collection exceeds 200 files or 4 MiB".into());
                }
                files.insert(id, content);
            }
        }
        Ok(())
    }
    match fs::metadata(root) {
        Ok(meta) if meta.is_dir() => walk(root, root, 0, &mut files, &mut 0)?,
        Ok(_) => return Err("Agent root is not a directory".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("Cannot inspect Agent directory".into()),
    }
    Ok(files)
}
fn revision(files: &BTreeMap<String, String>) -> String {
    // Length-delimited serialization prevents filename/content boundary collisions.
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(files).expect("string map serializes"))
    )
}
fn load_backup(path: &Path) -> Result<Backup, String> {
    serde_json::from_str(&read_file(path, 8 * MAX_FILE)?)
        .map_err(|_| "Cannot read Agent recovery record".into())
}
fn snapshot(tool: AgentTool, root: &Path, backup: &Path) -> Result<Snapshot, String> {
    let files = collect(root)?;
    let rev = revision(&files);
    Ok(Snapshot {
        can_restore: load_backup(backup).is_ok_and(|b| b.root == root && b.after == rev),
        revision: rev,
        path: root.to_string_lossy().into_owned(),
        files: files
            .into_iter()
            .map(|(id, content)| {
                let validation_error = validate_id(&id)
                    .and_then(|_| validate(tool, &content).map(|_| ()))
                    .err();
                AgentFile {
                    id,
                    content,
                    validation_error,
                }
            })
            .collect(),
    })
}
fn check_revision(root: &Path, expected: &str) -> Result<BTreeMap<String, String>, String> {
    let files = collect(root)?;
    if revision(&files) != expected {
        return Err("Agent files changed outside the assistant. Refresh before saving.".into());
    }
    Ok(files)
}
fn store(root: &Path, id: &str, content: Option<&str>) -> Result<(), String> {
    validate_id(id)?;
    let target = root.join(id);
    safe_path(&target)?;
    match content {
        Some(content) => {
            ensure_dirs(target.parent().ok_or("Invalid Agent target")?)?;
            crate::native_tools::private_write(&target, content.as_bytes())
        }
        None => fs::remove_file(&target).map_err(|_| "Cannot remove Agent file".into()),
    }
}
fn apply(tool: AgentTool, root: &Path, backup: &Path, change: Change) -> Result<Snapshot, String> {
    validate_id(&change.id)?;
    let mut files = check_revision(root, &change.revision)?;
    if !files.contains_key(&change.id)
        && (root.join(&change.id).exists()
            || files
                .keys()
                .any(|id| id.to_lowercase() == change.id.to_lowercase()))
    {
        return Err("Agent filename conflicts with an existing file or directory".into());
    }
    if let Some(content) = &change.content {
        let name = validate(tool, content)?;
        if matches!(tool, AgentTool::Claude)
            && files
                .iter()
                .any(|(id, body)| id != &change.id && validate(tool, body).is_ok_and(|n| n == name))
        {
            return Err("Another Claude Agent already uses this name".into());
        }
    } else if !files.contains_key(&change.id) {
        return Err("Agent file no longer exists".into());
    }
    let before = files.remove(&change.id);
    if let Some(content) = &change.content {
        files.insert(change.id.clone(), content.clone());
    }
    if files.len() > MAX_FILES || files.values().map(String::len).sum::<usize>() > MAX_TOTAL {
        return Err("Agent collection exceeds size limit".into());
    }
    if before.as_ref() == change.content.as_ref() {
        return snapshot(tool, root, backup);
    }
    let record = Backup {
        root: root.to_owned(),
        id: change.id.clone(),
        before,
        after: revision(&files),
    };
    safe_path(backup)?;
    ensure_dirs(backup.parent().ok_or("Invalid Agent backup")?)?;
    let old_backup = if backup.exists() {
        Some(read_file(backup, 8 * MAX_FILE)?)
    } else {
        None
    };
    crate::native_tools::private_write(
        backup,
        &serde_json::to_vec(&record).map_err(|_| "Cannot encode Agent recovery")?,
    )?;
    if let Err(error) = check_revision(root, &change.revision)
        .and_then(|_| store(root, &change.id, change.content.as_deref()))
    {
        let recovered = match old_backup {
            Some(old) => crate::native_tools::private_write(backup, old.as_bytes()),
            None => fs::remove_file(backup)
                .map_err(|_| "Cannot clear unused Agent recovery record".to_string()),
        };
        if recovered.is_err() {
            return Err("Agent save failed and previous recovery record could not be restored. Verify files before continuing.".into());
        }
        return Err(error);
    }
    snapshot(tool, root, backup)
}
fn restore(
    tool: AgentTool,
    root: &Path,
    backup: &Path,
    expected: &str,
) -> Result<Snapshot, String> {
    check_revision(root, expected)?;
    let record = load_backup(backup)?;
    if record.root != root || record.after != expected {
        return Err("Agent recovery does not match these files".into());
    }
    store(root, &record.id, record.before.as_deref())?;
    // A successful restore consumes the one-step recovery record. No silent redo.
    fs::remove_file(backup).map_err(|_| {
        "Agent restored, but recovery record could not be cleared. Refresh to verify.".to_string()
    })?;
    snapshot(tool, root, backup)
}
fn backup_path(tool: AgentTool) -> PathBuf {
    crate::config::get_app_config_dir()
        .join("agent-backups")
        .join(format!("{}.json", tool.id()))
}

struct FileLock(PathBuf);
impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}
fn file_lock(root: &Path) -> Result<FileLock, String> {
    let parent = root.parent().ok_or("Invalid Agent root")?;
    safe_path(parent)?;
    ensure_dirs(parent)?;
    let lock = root.with_extension("tuzi-switch.lock");
    safe_path(&lock)?;
    fs::create_dir(&lock).map_err(|_| "Agent files are busy in another assistant process")?;
    Ok(FileLock(lock))
}

fn ensure_dirs(path: &Path) -> Result<(), String> {
    safe_path(path)?;
    let missing: Vec<_> = path.ancestors().take_while(|p| !p.exists()).collect();
    for dir in missing.into_iter().rev() {
        fs::create_dir(dir).map_err(|_| "Cannot create Agent directory")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot protect Agent directory")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const CLAUDE: &str = "---\r\nname: reviewer\r\ndescription: Review code\r\ncustom: keep-me\r\n---\r\nReview without editing.\r\n";
    const OPENCODE: &str = "---\ndescription: Review code\nmode: subagent\npermission:\n  edit: deny\ncustom: keep-me\n---\nReview without editing.\n";
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        // macOS /var is a system symlink; fixtures use the resolved temporary root.
        let base = temp.path().canonicalize().unwrap();
        (
            temp,
            base.join("tool/agents"),
            base.join("private/last.json"),
        )
    }
    fn change(root: &Path, id: &str, body: Option<&str>) -> Change {
        Change {
            revision: revision(&collect(root).unwrap()),
            id: id.into(),
            content: body.map(str::to_owned),
        }
    }
    #[test]
    fn both_tools_create_edit_delete_and_restore_exact_original_bytes() {
        for (tool, body) in [(AgentTool::Claude, CLAUDE), (AgentTool::Opencode, OPENCODE)] {
            let (_temp, root, backup) = fixture();
            assert!(snapshot(tool, &root, &backup).unwrap().files.is_empty());
            let created =
                apply(tool, &root, &backup, change(&root, "review.md", Some(body))).unwrap();
            assert!(created.can_restore);
            assert_eq!(fs::read(root.join("review.md")).unwrap(), body.as_bytes());
            restore(tool, &root, &backup, &created.revision).unwrap();
            assert!(!root.join("review.md").exists());
            apply(tool, &root, &backup, change(&root, "review.md", Some(body))).unwrap();
            let edited_body = body.replace("keep-me", "changed");
            let edited = apply(
                tool,
                &root,
                &backup,
                change(&root, "review.md", Some(&edited_body)),
            )
            .unwrap();
            restore(tool, &root, &backup, &edited.revision).unwrap();
            assert_eq!(fs::read(root.join("review.md")).unwrap(), body.as_bytes());
            let deleted = apply(tool, &root, &backup, change(&root, "review.md", None)).unwrap();
            assert!(!root.join("review.md").exists());
            assert!(deleted.can_restore);
            restore(tool, &root, &backup, &deleted.revision).unwrap();
            assert_eq!(fs::read(root.join("review.md")).unwrap(), body.as_bytes());
            assert!(!snapshot(tool, &root, &backup).unwrap().can_restore);
        }
    }
    #[test]
    fn rejects_external_changes_and_recovery_for_another_root() {
        let (_temp, root, backup) = fixture();
        let stale = change(&root, "review.md", Some(CLAUDE));
        let initial = apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(&root, "review.md", Some(CLAUDE)),
        )
        .unwrap();
        assert!(apply(AgentTool::Claude, &root, &backup, stale).is_err());
        fs::write(root.join("review.md"), "external").unwrap();
        assert!(
            !snapshot(AgentTool::Claude, &root, &backup)
                .unwrap()
                .can_restore
        );
        assert!(restore(AgentTool::Claude, &root, &backup, &initial.revision).is_err());
        assert_eq!(
            fs::read_to_string(root.join("review.md")).unwrap(),
            "external"
        );
        let other = root.with_file_name("other");
        assert!(restore(
            AgentTool::Claude,
            &other,
            &backup,
            &revision(&BTreeMap::new())
        )
        .is_err());
    }
    #[test]
    fn nested_files_reject_duplicate_claude_names_and_preserve_invalid_files() {
        let (_temp, root, backup) = fixture();
        apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(&root, "nested/review.md", Some(CLAUDE)),
        )
        .unwrap();
        assert!(apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(&root, "duplicate.md", Some(CLAUDE))
        )
        .is_err());
        fs::write(root.join("broken.md"), "original invalid file").unwrap();
        let snap = snapshot(AgentTool::Claude, &root, &backup).unwrap();
        assert!(snap
            .files
            .iter()
            .find(|v| v.id == "broken.md")
            .unwrap()
            .validation_error
            .is_some());
        let repaired = apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(
                &root,
                "broken.md",
                Some(&CLAUDE.replace("reviewer", "repaired")),
            ),
        )
        .unwrap();
        restore(AgentTool::Claude, &root, &backup, &repaired.revision).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("broken.md")).unwrap(),
            "original invalid file"
        );
        assert!(root.join("nested/review.md").exists());
    }
    #[test]
    fn bad_ids_and_content_never_mutate_files() {
        let (_temp, root, backup) = fixture();
        for id in [
            "../outside.md",
            "/outside.md",
            "a/../outside.md",
            "a//b.md",
            "a/./b.md",
            "a\\b.md",
            ".hidden.md",
            "a.json",
            "C:outside.md",
            "",
        ] {
            assert!(
                apply(
                    AgentTool::Claude,
                    &root,
                    &backup,
                    change(&root, id, Some(CLAUDE))
                )
                .is_err(),
                "{id}"
            );
        }
        for body in [
            "plain text",
            "---\nname: x\n---\ninstructions",
            "---\nname: x\ndescription: ok\n---\n",
            "---\nname: x\ndescription: [broken\n---\ninstructions",
        ] {
            assert!(apply(
                AgentTool::Claude,
                &root,
                &backup,
                change(&root, "invalid.md", Some(body))
            )
            .is_err());
        }
        assert!(validate(
            AgentTool::Opencode,
            &OPENCODE.replace("subagent", "unknown")
        )
        .is_err());
        assert!(validate(AgentTool::Claude, &CLAUDE.replace("reviewer", "Bad name")).is_err());
        assert!(collect(&root).unwrap().is_empty());
        assert!(!backup.exists());
    }
    #[test]
    fn ipc_requires_explicit_content_null_for_deletion() {
        assert!(serde_json::from_value::<Change>(
            serde_json::json!({"revision":"x","id":"review.md"})
        )
        .is_err());
        assert!(serde_json::from_value::<Change>(
            serde_json::json!({"revision":"x","id":"review.md","content":null})
        )
        .is_ok());
        assert!(serde_json::from_value::<AgentTool>(serde_json::json!("codex")).is_err());
    }
    #[test]
    fn failed_write_keeps_previous_recovery_record() {
        let (_temp, root, backup) = fixture();
        apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(&root, "review.md", Some(CLAUDE)),
        )
        .unwrap();
        let original_backup = fs::read(&backup).unwrap();
        fs::create_dir(root.join("collision.md")).unwrap();
        assert!(apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(
                &root,
                "collision.md",
                Some(&CLAUDE.replace("reviewer", "second"))
            )
        )
        .is_err());
        assert_eq!(fs::read(&backup).unwrap(), original_backup);
        assert!(
            snapshot(AgentTool::Claude, &root, &backup)
                .unwrap()
                .can_restore
        );
    }
    #[test]
    fn filename_case_collision_is_not_a_new_agent() {
        let (_temp, root, backup) = fixture();
        apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(&root, "review.md", Some(CLAUDE)),
        )
        .unwrap();
        assert!(apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(
                &root,
                "REVIEW.md",
                Some(&CLAUDE.replace("reviewer", "different"))
            )
        )
        .is_err());
        assert_eq!(fs::read_to_string(root.join("review.md")).unwrap(), CLAUDE);
        assert!(
            snapshot(AgentTool::Claude, &root, &backup)
                .unwrap()
                .can_restore
        );
    }
    #[test]
    fn backup_failure_and_process_lock_prevent_writes() {
        let (_temp, root, backup) = fixture();
        ensure_dirs(&backup).unwrap();
        assert!(apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(&root, "review.md", Some(CLAUDE))
        )
        .is_err());
        assert!(!root.join("review.md").exists());
        let lock = file_lock(&root).unwrap();
        assert!(file_lock(&root).is_err());
        drop(lock);
        assert!(file_lock(&root).is_ok());
    }
    #[test]
    fn oversized_and_non_utf8_files_are_errors_not_empty_lists() {
        let (_temp, root, backup) = fixture();
        ensure_dirs(&root).unwrap();
        fs::write(root.join("bad.md"), [0xff, 0xfe]).unwrap();
        assert!(snapshot(AgentTool::Claude, &root, &backup).is_err());
        fs::write(root.join("bad.md"), vec![b'x'; MAX_FILE + 1]).unwrap();
        assert!(snapshot(AgentTool::Claude, &root, &backup).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn private_permissions_and_symlink_boundaries() {
        use std::os::unix::{fs::symlink, fs::PermissionsExt};
        let (_temp, root, backup) = fixture();
        apply(
            AgentTool::Claude,
            &root,
            &backup,
            change(&root, "nested/review.md", Some(CLAUDE)),
        )
        .unwrap();
        for file in [root.join("nested/review.md"), backup.clone()] {
            assert_eq!(
                fs::metadata(file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        for dir in [&root, &root.join("nested"), backup.parent().unwrap()] {
            assert_eq!(
                fs::metadata(dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        let external = root.parent().unwrap().join("external.md");
        fs::write(&external, CLAUDE).unwrap();
        symlink(&external, root.join("linked.md")).unwrap();
        assert!(snapshot(AgentTool::Claude, &root, &backup).is_err());
        assert!(apply(
            AgentTool::Claude,
            &root,
            &backup,
            Change {
                revision: String::new(),
                id: "linked.md".into(),
                content: Some("changed".into())
            }
        )
        .is_err());
        assert_eq!(fs::read_to_string(&external).unwrap(), CLAUDE);
    }
}

#[tauri::command]
pub fn agents_read(tool: AgentTool) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Agent manager is busy")?;
    snapshot(tool, &tool.root(), &backup_path(tool))
}
#[tauri::command]
pub fn agents_write(tool: AgentTool, change: Change) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Agent manager is busy")?;
    let _file_guard = file_lock(&tool.root())?;
    apply(tool, &tool.root(), &backup_path(tool), change)
}
#[tauri::command]
pub fn agents_restore(tool: AgentTool, revision: String) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Agent manager is busy")?;
    let _file_guard = file_lock(&tool.root())?;
    restore(tool, &tool.root(), &backup_path(tool), &revision)
}
