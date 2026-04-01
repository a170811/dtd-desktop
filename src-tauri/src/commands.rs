use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_format: Option<String>,
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(data_dir.join("sessions"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(data_dir.join("settings.json"))
}

#[tauri::command]
pub async fn load_sessions(app: AppHandle) -> Result<Vec<Session>, String> {
    let dir = sessions_dir(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut sessions = vec![];
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let session: Session = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            sessions.push(session);
        }
    }
    sessions.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(sessions)
}

#[tauri::command]
pub async fn save_session(app: AppHandle, session: Session) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", session.id));
    let content = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    let path = dir.join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<Option<Settings>, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: Settings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(settings))
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/// Normalize a path by resolving `.` and `..` components lexically (without I/O).
fn normalize_path(path: &PathBuf) -> PathBuf {
    use std::path::Component;
    let mut components: Vec<std::ffi::OsString> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                components.pop();
            }
            c => {
                components.push(c.as_os_str().to_owned());
            }
        }
    }
    components.iter().collect()
}

fn validate_path(path: &str, working_dir: &str) -> Result<PathBuf, String> {
    let base = std::fs::canonicalize(working_dir)
        .map_err(|e| format!("Cannot canonicalize working directory '{}': {}", working_dir, e))?;

    let candidate = base.join(path);

    // If the candidate exists, canonicalize it directly.
    let resolved = if candidate.exists() {
        std::fs::canonicalize(&candidate)
            .map_err(|e| format!("Cannot canonicalize path '{}': {}", path, e))?
    } else {
        // For new files, try to canonicalize the parent, then append the filename.
        let parent = candidate
            .parent()
            .ok_or_else(|| format!("Path has no parent: {}", path))?;
        let canonical_parent = if parent.exists() {
            std::fs::canonicalize(parent)
                .map_err(|e| format!("Cannot canonicalize parent of '{}': {}", path, e))?
        } else {
            // Neither the file nor its parent exist — normalize lexically to resolve `..`.
            normalize_path(&base.join(parent))
        };
        let filename = candidate
            .file_name()
            .ok_or_else(|| format!("Path has no filename: {}", path))?;
        canonical_parent.join(filename)
    };

    if !resolved.starts_with(&base) {
        return Err(format!("Path escapes working directory: {}", path));
    }

    Ok(resolved)
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

const MAX_OUTPUT_BYTES: usize = 50 * 1024; // 50 KB

fn execute_bash_sync(command: &str, working_dir: &str) -> Result<String, String> {
    // Block dangerous commands
    let dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
    for pattern in &dangerous {
        if command.contains(pattern) {
            return Err(format!("Command blocked for safety: contains '{}'", pattern));
        }
    }

    let output = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/C", command])
            .current_dir(working_dir)
            .output()
    } else {
        std::process::Command::new("sh")
            .args(["-c", command])
            .current_dir(working_dir)
            .output()
    }
    .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    combined.push_str(&String::from_utf8_lossy(&output.stderr));

    if combined.is_empty() {
        return Ok("(no output)".to_string());
    }

    if combined.len() > MAX_OUTPUT_BYTES {
        combined.truncate(MAX_OUTPUT_BYTES);
        combined.push_str("\n... (output truncated)");
    }

    Ok(combined)
}

fn execute_read_file_sync(path: &str, working_dir: &str, limit: Option<usize>) -> Result<String, String> {
    let resolved = validate_path(path, working_dir)?;
    let content = std::fs::read_to_string(&resolved)
        .map_err(|e| format!("Cannot read file '{}': {}", path, e))?;

    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();

    let result = if let Some(max_lines) = limit {
        if total > max_lines {
            let shown = lines[..max_lines].join("\n");
            format!("{}\n... ({} more lines)", shown, total - max_lines)
        } else {
            lines.join("\n")
        }
    } else {
        content.clone()
    };

    if result.len() > MAX_OUTPUT_BYTES {
        let mut truncated = result[..MAX_OUTPUT_BYTES].to_string();
        truncated.push_str("\n... (output truncated)");
        Ok(truncated)
    } else {
        Ok(result)
    }
}

fn execute_write_file_sync(path: &str, working_dir: &str, content: &str) -> Result<String, String> {
    let resolved = validate_path(path, working_dir)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create directories for '{}': {}", path, e))?;
    }
    std::fs::write(&resolved, content)
        .map_err(|e| format!("Cannot write file '{}': {}", path, e))?;
    Ok(format!("Wrote {} bytes to {}", content.len(), resolved.display()))
}

fn execute_edit_file_sync(path: &str, working_dir: &str, old_text: &str, new_text: &str) -> Result<String, String> {
    let resolved = validate_path(path, working_dir)?;
    let content = std::fs::read_to_string(&resolved)
        .map_err(|e| format!("Cannot read file '{}': {}", path, e))?;

    if !content.contains(old_text) {
        return Err(format!("old_text not found in file '{}'", path));
    }

    let new_content = content.replacen(old_text, new_text, 1);
    std::fs::write(&resolved, &new_content)
        .map_err(|e| format!("Cannot write file '{}': {}", path, e))?;

    Ok(format!("Edited {}", resolved.display()))
}

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn execute_bash(command: String, working_dir: String) -> Result<String, String> {
    execute_bash_sync(&command, &working_dir)
}

#[tauri::command]
pub async fn execute_read_file(
    path: String,
    working_dir: String,
    limit: Option<usize>,
) -> Result<String, String> {
    execute_read_file_sync(&path, &working_dir, limit)
}

#[tauri::command]
pub async fn execute_write_file(
    path: String,
    working_dir: String,
    content: String,
) -> Result<String, String> {
    execute_write_file_sync(&path, &working_dir, &content)
}

#[tauri::command]
pub async fn execute_edit_file(
    path: String,
    working_dir: String,
    old_text: String,
    new_text: String,
) -> Result<String, String> {
    execute_edit_file_sync(&path, &working_dir, &old_text, &new_text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_roundtrip() {
        let session = Session {
            id: "test-id".to_string(),
            title: "Test".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            messages: vec![],
            working_directory: Some("/tmp/project".to_string()),
            allowed_tools: vec!["bash".to_string(), "read_file".to_string()],
        };
        let json = serde_json::to_string(&session).unwrap();
        let parsed: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "test-id");
        assert_eq!(parsed.title, "Test");
        assert_eq!(parsed.working_directory, Some("/tmp/project".to_string()));
        assert_eq!(parsed.allowed_tools, vec!["bash", "read_file"]);
    }

    #[test]
    fn test_session_roundtrip_defaults() {
        // allowed_tools defaults to empty vec when absent from JSON
        let json = r#"{"id":"x","title":"T","createdAt":"2026-01-01T00:00:00Z","messages":[]}"#;
        let parsed: Session = serde_json::from_str(json).unwrap();
        assert!(parsed.allowed_tools.is_empty());
        assert!(parsed.working_directory.is_none());
    }

    #[test]
    fn test_settings_roundtrip() {
        let settings = Settings {
            base_url: "http://localhost:4000".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4o".to_string(),
            api_format: Some("responses".to_string()),
        };
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.base_url, "http://localhost:4000");
        assert_eq!(parsed.api_format, Some("responses".to_string()));
    }

    #[test]
    fn test_settings_api_format_optional() {
        // api_format is absent from JSON — should deserialize to None
        let json = r#"{"baseUrl":"http://localhost:4000","apiKey":"sk-test","model":"gpt-4o"}"#;
        let parsed: Settings = serde_json::from_str(json).unwrap();
        assert!(parsed.api_format.is_none());
    }

    #[test]
    fn test_validate_path_within_workdir() {
        let workdir = std::env::temp_dir().join("test_workdir");
        std::fs::create_dir_all(&workdir).unwrap();
        // Canonicalize so symlinks (e.g. /var -> /private/var on macOS) are resolved.
        let canonical_workdir = std::fs::canonicalize(&workdir).unwrap();
        let result = validate_path("test.txt", canonical_workdir.to_str().unwrap());
        assert!(result.is_ok());
        let resolved = result.unwrap();
        assert!(resolved.starts_with(&canonical_workdir));
        std::fs::remove_dir_all(&workdir).ok();
    }

    #[test]
    fn test_validate_path_escapes_workdir() {
        let workdir = std::env::temp_dir().join("test_workdir2");
        std::fs::create_dir_all(&workdir).unwrap();
        // Canonicalize so validate_path works with a real base.
        let canonical_workdir = std::fs::canonicalize(&workdir).unwrap();
        let result = validate_path("../../etc/passwd", canonical_workdir.to_str().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("escapes"));
        std::fs::remove_dir_all(&workdir).ok();
    }

    #[test]
    fn test_execute_read_file_and_write_file() {
        let workdir = std::env::temp_dir().join("test_rw_workdir");
        std::fs::create_dir_all(&workdir).unwrap();

        let write_result = execute_write_file_sync("hello.txt", workdir.to_str().unwrap(), "Hello, world!");
        assert!(write_result.is_ok());
        assert!(write_result.unwrap().contains("13 bytes"));

        let read_result = execute_read_file_sync("hello.txt", workdir.to_str().unwrap(), None);
        assert!(read_result.is_ok());
        assert_eq!(read_result.unwrap(), "Hello, world!");

        std::fs::remove_dir_all(&workdir).ok();
    }

    #[test]
    fn test_execute_read_file_with_limit() {
        let workdir = std::env::temp_dir().join("test_limit_workdir");
        std::fs::create_dir_all(&workdir).unwrap();

        let content = "line1\nline2\nline3\nline4\nline5";
        execute_write_file_sync("lines.txt", workdir.to_str().unwrap(), content).unwrap();

        let result = execute_read_file_sync("lines.txt", workdir.to_str().unwrap(), Some(3)).unwrap();
        assert!(result.contains("line1"));
        assert!(result.contains("line3"));
        assert!(result.contains("2 more lines"));
        assert!(!result.contains("line5"));

        std::fs::remove_dir_all(&workdir).ok();
    }

    #[test]
    fn test_execute_edit_file() {
        let workdir = std::env::temp_dir().join("test_edit_workdir");
        std::fs::create_dir_all(&workdir).unwrap();

        execute_write_file_sync("edit.txt", workdir.to_str().unwrap(), "Hello, world!").unwrap();

        let result = execute_edit_file_sync(
            "edit.txt",
            workdir.to_str().unwrap(),
            "world",
            "Rust",
        );
        assert!(result.is_ok());

        let content = execute_read_file_sync("edit.txt", workdir.to_str().unwrap(), None).unwrap();
        assert_eq!(content, "Hello, Rust!");

        std::fs::remove_dir_all(&workdir).ok();
    }

    #[test]
    fn test_execute_edit_file_text_not_found() {
        let workdir = std::env::temp_dir().join("test_edit_notfound_workdir");
        std::fs::create_dir_all(&workdir).unwrap();

        execute_write_file_sync("edit2.txt", workdir.to_str().unwrap(), "Hello, world!").unwrap();

        let result = execute_edit_file_sync(
            "edit2.txt",
            workdir.to_str().unwrap(),
            "nonexistent text",
            "replacement",
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("old_text not found"));

        std::fs::remove_dir_all(&workdir).ok();
    }
}
