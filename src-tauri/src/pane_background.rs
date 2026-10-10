//! How many background subagents and workflows each pane's Claude
//! session still waits on, for the sidebar badge.
//!
//! Claude Code stamps `✳` into the title whenever its own turn ends, even while
//! background subagents run and it will resume on its own (shells never
//! count). The notify hook counts
//! those tasks from the transcript and writes `backgroundTasks` into the pane map
//! (`panes/<paneId>.json`); this watcher relays every change to the front as a
//! `pane-background` event, which shows such a pane as busy instead of waiting.
//! Background shells ride along apart (`backgroundShells`): they only ring the
//! badge of a waiting pane.

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Deserialize)]
struct PaneMapCount {
    #[serde(rename = "paneId")]
    pane_id: Option<String>,
    /// Absent on events that don't recount (prompt submitted, session start).
    #[serde(rename = "backgroundTasks")]
    background_tasks: Option<u32>,
    #[serde(rename = "backgroundShells", default)]
    background_shells: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaneBackground {
    pane_id: String,
    count: u32,
    shells: u32,
}

/// The count a pane-map file carries, or None when it has none (keep the last).
fn parse_pane_map(raw: &str) -> Option<PaneBackground> {
    // PowerShell 5.1 may prepend a UTF-8 BOM, which serde_json rejects.
    let m: PaneMapCount = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;
    Some(PaneBackground {
        pane_id: m.pane_id.filter(|s| !s.is_empty())?,
        count: m.background_tasks?,
        shells: m.background_shells,
    })
}

fn panes_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("panes")
}

fn relay(path: &Path, app: &AppHandle) {
    if path.extension().and_then(|s| s.to_str()) != Some("json") {
        return;
    }
    // A half-written file fails to parse; the write's next event carries it whole.
    if let Some(payload) = std::fs::read_to_string(path)
        .ok()
        .as_deref()
        .and_then(parse_pane_map)
    {
        let _ = app.emit("pane-background", payload);
    }
}

/// Watches the pane-map directory for the lifetime of the app (own thread).
pub fn run_pane_map_watcher(app: AppHandle) -> notify::Result<()> {
    let root = panes_dir();
    std::fs::create_dir_all(&root).ok();
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&root, RecursiveMode::NonRecursive)?;
    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    for path in event.paths {
                        relay(&path, &app);
                    }
                }
            }
            Ok(Err(e)) => eprintln!("[arkadia panes] notify error: {e}"),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_count_written_by_the_hook() {
        let raw = "\u{feff}{\"paneId\":\"p1\",\"sessionId\":\"s\",\"backgroundTasks\":2,\"backgroundShells\":1}";
        assert_eq!(
            parse_pane_map(raw),
            Some(PaneBackground {
                pane_id: "p1".into(),
                count: 2,
                shells: 1
            })
        );
    }

    #[test]
    fn no_count_means_keep_the_last_one() {
        assert_eq!(
            parse_pane_map("{\"paneId\":\"p1\",\"sessionId\":\"s\"}"),
            None
        );
        assert_eq!(parse_pane_map("{\"paneId\":\"p1\",\"backgr"), None);
    }
}
