//! Saves images pasted into the notepad (e.g. PrintScreen captures) to the
//! app data dir so their file path can be inserted into a prompt.

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn save_screenshot(app: AppHandle, bytes: Vec<u8>, ext: String) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("empty image".into());
    }
    // Extension comes from the clipboard MIME subtype; keep it boring.
    let ext = if !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric())
    {
        ext.to_ascii_lowercase()
    } else {
        "png".to_string()
    };
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?
        .join("screenshots");
    fs::create_dir_all(&dir).map_err(|e| format!("create screenshots dir: {e}"))?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("clock: {e}"))?
        .as_millis();
    let path = dir.join(format!("screenshot-{ts}.{ext}"));
    fs::write(&path, &bytes).map_err(|e| format!("write screenshot: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}
