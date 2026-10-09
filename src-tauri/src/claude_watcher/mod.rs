pub mod parse;
pub mod state;
pub mod watcher;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

/// Whether a Claude session is still paused on a usage limit (see
/// [`parse::ends_on_quota_hit`]), read from the tail of its transcript.
/// False when the transcript can't be found.
#[tauri::command(async)]
pub fn session_paused_on_limit(session_id: String) -> bool {
    let Some(root) = dirs::home_dir().map(|h| h.join(".claude").join("projects")) else {
        return false;
    };
    let name = format!("{session_id}.jsonl");
    let Some(path) = std::fs::read_dir(&root).ok().and_then(|dirs| {
        dirs.flatten()
            .map(|d| d.path().join(&name))
            .find(|p| p.is_file())
    }) else {
        return false;
    };
    const TAIL: u64 = 256 * 1024;
    let Ok(mut file) = File::open(&path) else {
        return false;
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file.seek(SeekFrom::Start(len.saturating_sub(TAIL))).is_err() {
        return false;
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return false;
    }
    // The first line of a tail may be cut: it fails to parse and is skipped.
    parse::ends_on_quota_hit(&String::from_utf8_lossy(&bytes))
}
