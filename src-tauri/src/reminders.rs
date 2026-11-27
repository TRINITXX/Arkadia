//! Reminders left for Arkadia by `~/.claude/scripts/rappel.mjs`: one JSON
//! file per reminder in `%LOCALAPPDATA%\Arkadia\reminders\<id>.json`
//! (`{ id, conversation, subject, prompt, at, createdAt }`, `at` in ISO UTC).
//! Arkadia is not open all the time: the page reads the folder at startup,
//! then every minute, and lists those that fell due beside the sidebar.
//! « Lancer » first claims a reminder (its file moves to `reminders\done\`,
//! a claim that fails once the file is gone), then opens its chat, and gives
//! it back if the chat could not open. « × » claims it the same way, with no
//! chat. « Demain » writes a new `at` (temp file then rename, as the script
//! writes it).
//!
//! Arkadia Lab and a debug build (`tauri dev`) leave the folder to the daily
//! instance: they list nothing, so one reminder is never launched twice.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// Its file's name, given by `rappel.mjs` (`r-<day>-<hex>`; older ones: their Resend id).
    id: String,
    /// The conversation (project) the prompt is for.
    conversation: String,
    subject: String,
    prompt: String,
    /// When it falls due, ISO UTC.
    at: String,
    #[serde(default)]
    created_at: Option<String>,
}

fn reminders_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("reminders")
}

/// A reminder's id names a file of the folder: letters, digits, dashes, nothing that
/// could reach another folder.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn file_of(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("identifiant de rappel invalide : {id}"));
    }
    Ok(dir.join(format!("{id}.json")))
}

/// The folder's reminders, done ones (`done\`), temp files and unreadable
/// files left out. The id is the file's name, whatever the file says.
fn list_in(dir: &Path) -> Vec<Reminder> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() || path.extension().is_none_or(|e| e != "json") {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_owned();
            if !valid_id(&id) {
                return None;
            }
            let text = std::fs::read_to_string(&path).ok()?;
            let mut reminder: Reminder = serde_json::from_str(&text).ok()?;
            reminder.id = id;
            Some(reminder)
        })
        .collect()
}

fn done_file_of(dir: &Path, id: &str) -> Result<PathBuf, String> {
    file_of(dir, id)?;
    Ok(dir.join("done").join(format!("{id}.json")))
}

/// « Lancer » takes it: its file moves to `done\` in one rename, which fails
/// once the file is gone (taken or put off elsewhere): never two chats.
fn claim_in(dir: &Path, id: &str) -> Result<(), String> {
    let file = file_of(dir, id)?;
    if !file.is_file() {
        return Err(format!("rappel déjà pris : {id}"));
    }
    let done = done_file_of(dir, id)?;
    std::fs::create_dir_all(dir.join("done")).map_err(|e| e.to_string())?;
    std::fs::rename(&file, &done).map_err(|e| e.to_string())
}

/// Its chat could not open: the reminder goes back to the list.
fn unclaim_in(dir: &Path, id: &str) -> Result<(), String> {
    let file = file_of(dir, id)?;
    if file.exists() {
        return Err(format!("rappel déjà revenu : {id}"));
    }
    std::fs::rename(done_file_of(dir, id)?, &file).map_err(|e| e.to_string())
}

/// Put off to `at` (ISO UTC): the file keeps every other field, written
/// whole to a temp file first, so a crash never leaves half of it.
fn postpone_in(dir: &Path, id: &str, at: &str) -> Result<(), String> {
    let file = file_of(dir, id)?;
    chrono::DateTime::parse_from_rfc3339(at).map_err(|e| format!("date invalide {at} : {e}"))?;
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let mut value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let Some(fields) = value.as_object_mut() else {
        return Err(format!("rappel illisible : {id}"));
    };
    fields.insert("at".into(), Value::String(at.to_owned()));
    let out = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{id}.json.tmp"));
    std::fs::write(&tmp, out).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

/// Whether this instance launches reminders: only the daily build, as
/// `pip_follow::ENABLED`.
const ENABLED: bool = !crate::lab::LAB && !cfg!(debug_assertions);

/// Every reminder of the folder, due or not: the page picks the due ones.
#[tauri::command]
pub async fn reminders_list() -> Vec<Reminder> {
    if !ENABLED {
        return Vec::new();
    }
    list_in(&reminders_dir())
}

#[tauri::command]
pub async fn reminder_claim(id: String) -> Result<(), String> {
    claim_in(&reminders_dir(), &id)
}

#[tauri::command]
pub async fn reminder_unclaim(id: String) -> Result<(), String> {
    unclaim_in(&reminders_dir(), &id)
}

#[tauri::command]
pub async fn reminder_postpone(id: String, at: String) -> Result<(), String> {
    postpone_in(&reminders_dir(), &id, &at)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join(name), text).unwrap();
    }

    const ONE: &str = r#"{
  "id": "abc-1",
  "conversation": "Arkadia",
  "subject": "Rappel : lire la sonde",
  "prompt": "Lis la sonde.",
  "at": "2026-11-17T08:00:00.000Z",
  "createdAt": "2026-11-16T10:00:00.000Z"
}"#;

    #[test]
    fn lists_the_folder_without_done_temp_or_broken_files() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "abc-1.json", ONE);
        write(dir.path(), "abc-2.json.tmp", ONE);
        write(dir.path(), "broken.json", "{ not json");
        std::fs::create_dir(dir.path().join("done")).unwrap();
        write(&dir.path().join("done"), "old.json", ONE);
        let list = list_in(dir.path());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "abc-1");
        assert_eq!(list[0].conversation, "Arkadia");
        assert_eq!(list[0].created_at.as_deref(), Some("2026-11-16T10:00:00.000Z"));
    }

    #[test]
    fn a_claimed_reminder_moves_to_done() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "abc-1.json", ONE);
        claim_in(dir.path(), "abc-1").unwrap();
        assert!(!dir.path().join("abc-1.json").exists());
        assert!(dir.path().join("done").join("abc-1.json").exists());
        assert!(list_in(dir.path()).is_empty());
    }

    #[test]
    fn a_reminder_gone_cannot_be_claimed() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "abc-1.json", ONE);
        claim_in(dir.path(), "abc-1").unwrap();
        assert!(claim_in(dir.path(), "abc-1").is_err());
        assert!(claim_in(dir.path(), "never-there").is_err());
        assert!(!dir.path().join("done").join("never-there.json").exists());
    }

    #[test]
    fn unclaiming_brings_it_back_to_the_list() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "abc-1.json", ONE);
        claim_in(dir.path(), "abc-1").unwrap();
        unclaim_in(dir.path(), "abc-1").unwrap();
        assert!(!dir.path().join("done").join("abc-1.json").exists());
        assert_eq!(list_in(dir.path())[0].id, "abc-1");
        assert!(unclaim_in(dir.path(), "abc-1").is_err());
    }

    #[test]
    fn postponing_rewrites_at_and_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "abc-1.json", ONE);
        postpone_in(dir.path(), "abc-1", "2026-11-18T08:00:00.000Z").unwrap();
        let list = list_in(dir.path());
        assert_eq!(list[0].at, "2026-11-18T08:00:00.000Z");
        assert_eq!(list[0].prompt, "Lis la sonde.");
        assert!(!dir.path().join("abc-1.json.tmp").exists());
    }

    #[test]
    fn refuses_ids_and_dates_it_cannot_trust() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "abc-1.json", ONE);
        assert!(claim_in(dir.path(),"..\\abc-1").is_err());
        assert!(postpone_in(dir.path(), "abc-1/../x", "2026-11-18T08:00:00Z").is_err());
        assert!(postpone_in(dir.path(), "abc-1", "demain").is_err());
        assert_eq!(list_in(dir.path())[0].at, "2026-11-17T08:00:00.000Z");
    }
}
