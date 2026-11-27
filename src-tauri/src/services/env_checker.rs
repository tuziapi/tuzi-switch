use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "windows"))]
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConflict {
    pub var_name: String,
    pub var_value: String,
    pub source_type: String, // "system" | "file"
    pub source_path: String, // Registry path or file path
}

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

/// Check environment variables for conflicts
pub fn check_env_conflicts(app: &str) -> Result<Vec<EnvConflict>, String> {
    let keywords = get_keywords_for_app(app);
    let mut conflicts = Vec::new();

    // Check system environment variables
    conflicts.extend(check_system_env(&keywords)?);

    // Check shell configuration files (Unix only)
    #[cfg(not(target_os = "windows"))]
    conflicts.extend(check_shell_configs(&keywords)?);

    Ok(conflicts)
}

/// Get relevant keywords for each app
fn get_keywords_for_app(app: &str) -> Vec<&str> {
    match app.to_lowercase().as_str() {
        "claude" => vec!["ANTHROPIC"],
        "codex" => vec!["OPENAI"],
        "gemini" => vec!["GEMINI", "GOOGLE_GEMINI"],
        _ => vec![],
    }
}

/// Check system environment variables (Windows Registry or Unix env)
#[cfg(target_os = "windows")]
fn check_system_env(keywords: &[&str]) -> Result<Vec<EnvConflict>, String> {
    let mut conflicts = Vec::new();

    // Check HKEY_CURRENT_USER\Environment
    if let Ok(hkcu) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
        for (name, value) in hkcu.enum_values().filter_map(Result::ok) {
            if keywords.iter().any(|k| name.to_uppercase().contains(k)) {
                conflicts.push(EnvConflict {
                    var_name: name.clone(),
                    var_value: value.to_string(),
                    source_type: "system".to_string(),
                    source_path: "HKEY_CURRENT_USER\\Environment".to_string(),
                });
            }
        }
    }

    // Check HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Session Manager\Environment
    if let Ok(hklm) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")
    {
        for (name, value) in hklm.enum_values().filter_map(Result::ok) {
            if keywords.iter().any(|k| name.to_uppercase().contains(k)) {
                conflicts.push(EnvConflict {
                    var_name: name.clone(),
                    var_value: value.to_string(),
                    source_type: "system".to_string(),
                    source_path: "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment".to_string(),
                });
            }
        }
    }

    Ok(conflicts)
}

#[cfg(not(target_os = "windows"))]
fn check_system_env(keywords: &[&str]) -> Result<Vec<EnvConflict>, String> {
    let mut conflicts = Vec::new();

    // Check current process environment
    for (key, value) in std::env::vars() {
        if keywords.iter().any(|k| key.to_uppercase().contains(k)) {
            conflicts.push(EnvConflict {
                var_name: key,
                var_value: value,
                source_type: "system".to_string(),
                source_path: "Process Environment".to_string(),
            });
        }
    }

    Ok(conflicts)
}

/// Check shell configuration files for environment variable exports (Unix only)
#[cfg(not(target_os = "windows"))]
fn check_shell_configs(keywords: &[&str]) -> Result<Vec<EnvConflict>, String> {
    let mut conflicts = Vec::new();

    let home = crate::config::get_home_dir().to_string_lossy().into_owned();
    let config_files = vec![
        format!("{}/.bashrc", home),
        format!("{}/.bash_profile", home),
        format!("{}/.zshrc", home),
        format!("{}/.zshenv", home),
        format!("{}/.zprofile", home),
        format!("{}/.profile", home),
        "/etc/profile".to_string(),
        "/etc/bashrc".to_string(),
    ];

    for file_path in config_files {
        if let Ok(content) = fs::read_to_string(&file_path) {
            // Parse lines for export statements
            for (line_num, line) in content.lines().enumerate() {
                if let Some((var_name, var_value)) = parse_assignment(line) {
                    if keywords.iter().any(|k| var_name.to_uppercase().contains(k)) {
                        conflicts.push(EnvConflict {
                            var_name: var_name.to_string(),
                            var_value: var_value.to_string(),
                            source_type: "file".into(),
                            source_path: format!("{}:{}", file_path, line_num + 1),
                        });
                    }
                }
            }
        }
    }

    Ok(conflicts)
}

/// Only standalone literal assignments are automatically editable; never execute shell code.
#[cfg(not(target_os = "windows"))]
pub(super) fn parse_assignment(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    let line = line
        .strip_prefix("export ")
        .or_else(|| line.strip_prefix("export\t"))
        .unwrap_or(line)
        .trim();
    let (name, value) = line.split_once('=')?;
    if name.is_empty()
        || !name
            .chars()
            .enumerate()
            .all(|(i, c)| c == '_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit()))
    {
        return None;
    }
    let value = value.trim();
    if value.starts_with('\'') || value.starts_with('"') {
        let quote = value.chars().next()?;
        let end = value[1..].find(quote)? + 1;
        let tail = value[end + 1..].trim();
        if !tail.is_empty() && !tail.starts_with('#') {
            return None;
        }
        let literal = &value[1..end];
        if quote == '"' && literal.contains(['$', '`', '\\']) {
            return None;
        }
        Some((name, literal))
    } else {
        let value = value.split(" #").next()?.trim_end();
        if value
            .chars()
            .any(|c| c.is_whitespace() || ";&|$`\\()<>".contains(c))
        {
            return None;
        }
        Some((name, value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parses_only_standalone_literals() {
        assert_eq!(
            parse_assignment("export\tANTHROPIC_API_KEY='synthetic-only' # keep"),
            Some(("ANTHROPIC_API_KEY", "synthetic-only"))
        );
        assert_eq!(
            parse_assignment("ANTHROPIC_API_KEY="),
            Some(("ANTHROPIC_API_KEY", ""))
        );
        for line in [
            "# ANTHROPIC_API_KEY=x",
            "export ANTHROPIC_API_KEY=x; echo y",
            "export ANTHROPIC_API_KEY=$(cat secret)",
            "export ANTHROPIC_API_KEY=\"$SECRET\"",
            "echo ANTHROPIC_API_KEY=x",
        ] {
            assert_eq!(parse_assignment(line), None);
        }
    }
    #[test]
    fn test_get_keywords() {
        assert_eq!(get_keywords_for_app("claude"), vec!["ANTHROPIC"]);
        assert_eq!(get_keywords_for_app("codex"), vec!["OPENAI"]);
        assert_eq!(
            get_keywords_for_app("gemini"),
            vec!["GEMINI", "GOOGLE_GEMINI"]
        );
        assert_eq!(get_keywords_for_app("unknown"), Vec::<&str>::new());
    }
}
