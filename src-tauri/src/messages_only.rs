//! The rail's « Messages seuls » button: shows a pane's prompts and replies
//! alone, every tool call and notice hidden.
//!
//! Claude Code draws those rows, through Alexis's display mod
//! (`outils-discrets`), so the button only leaves a flag for it: one file per
//! pane, `view/<paneId>.json`, which the mod reads with the pane id it
//! inherited (`ARKADIA_PANE_ID`). No file means the full transcript.
//!
//! A pane gets a new id on every launch, so a file left behind is never read
//! again: it goes when its pane closes (`close_terminal`) or the app exits.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

/// Panes this process turned the button on for. On exit only their files go,
/// never another Arkadia's: the daily one and `tauri dev` share the folder.
static TURNED_ON: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

fn turned_on() -> MutexGuard<'static, BTreeSet<String>> {
    TURNED_ON.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewFlag {
    only_messages: bool,
}

fn view_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("view")
}

/// The pane's file, for a pane id made of a UUID's characters only: the id
/// names the file, so nothing else may reach outside the folder.
fn flag_path(dir: &Path, pane_id: &str) -> Option<PathBuf> {
    let is_id = !pane_id.is_empty()
        && pane_id.len() <= 64
        && pane_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    is_id.then(|| dir.join(format!("{pane_id}.json")))
}

fn read_flag(dir: &Path, pane_id: &str) -> bool {
    flag_path(dir, pane_id)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<ViewFlag>(&raw).ok())
        .is_some_and(|flag| flag.only_messages)
}

/// Written under a temporary name then renamed, so the mod never reads a
/// half-written file. Off removes the file.
fn write_flag(dir: &Path, pane_id: &str, on: bool) -> std::io::Result<()> {
    let path = flag_path(dir, pane_id)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "pane id invalide"))?;
    if !on {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    std::fs::create_dir_all(dir)?;
    let body = serde_json::to_string(&ViewFlag {
        only_messages: true,
    })?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, &path)
}

fn set_flag(
    dir: &Path,
    panes: &mut BTreeSet<String>,
    pane_id: &str,
    on: bool,
) -> std::io::Result<()> {
    write_flag(dir, pane_id, on)?;
    if on {
        panes.insert(pane_id.to_string());
    } else {
        panes.remove(pane_id);
    }
    Ok(())
}

fn forget_all_in(dir: &Path, panes: &mut BTreeSet<String>) {
    for pane_id in std::mem::take(panes) {
        let _ = write_flag(dir, &pane_id, false);
    }
}

#[tauri::command]
pub async fn messages_only_get(pane_id: String) -> bool {
    read_flag(&view_dir(), &pane_id)
}

#[tauri::command]
pub async fn messages_only_set(pane_id: String, on: bool) -> Result<(), String> {
    set_flag(&view_dir(), &mut turned_on(), &pane_id, on).map_err(|e| e.to_string())
}

/// A pane closed: its file goes with it.
pub fn forget(pane_id: &str) {
    let _ = set_flag(&view_dir(), &mut turned_on(), pane_id, false);
}

/// The app exits: the files of the panes it turned on go.
pub fn forget_all() {
    forget_all_in(&view_dir(), &mut turned_on());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pane_keeps_its_flag_until_turned_off() {
        let dir = tempfile::tempdir().unwrap();
        let pane = "3f2a9c1e-0b4d-4e8f-9a7c-5d6e7f8a9b0c";
        assert!(!read_flag(dir.path(), pane));
        write_flag(dir.path(), pane, true).unwrap();
        assert!(read_flag(dir.path(), pane));
        assert_eq!(
            std::fs::read_to_string(dir.path().join(format!("{pane}.json"))).unwrap(),
            r#"{"onlyMessages":true}"#
        );
        write_flag(dir.path(), pane, false).unwrap();
        assert!(!read_flag(dir.path(), pane));
        // Turning off a pane that never had the flag is no error.
        write_flag(dir.path(), pane, false).unwrap();
    }

    #[test]
    fn on_exit_only_the_panes_this_process_turned_on_lose_their_file() {
        let dir = tempfile::tempdir().unwrap();
        let mut panes = BTreeSet::new();
        set_flag(dir.path(), &mut panes, "pane-a", true).unwrap();
        set_flag(dir.path(), &mut panes, "pane-b", true).unwrap();
        // Another Arkadia's pane, in the same folder.
        write_flag(dir.path(), "pane-other", true).unwrap();
        forget_all_in(dir.path(), &mut panes);
        assert!(!read_flag(dir.path(), "pane-a"));
        assert!(!read_flag(dir.path(), "pane-b"));
        assert!(read_flag(dir.path(), "pane-other"));
        assert!(panes.is_empty());
    }

    #[test]
    fn an_id_that_is_no_uuid_names_no_file() {
        let dir = tempfile::tempdir().unwrap();
        for id in ["", "../store", "a/b", "a\\b", "C:x", &"a".repeat(65)] {
            assert!(flag_path(dir.path(), id).is_none(), "{id}");
            assert!(write_flag(dir.path(), id, true).is_err(), "{id}");
        }
    }
}
