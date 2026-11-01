//! Arkadia Lab: a second build of Arkadia that runs beside the daily one, to
//! try new views without closing it. Built with `ARKADIA_LAB_BUILD=1` and the
//! `tauri.lab.conf.json` overlay, whose own identifier gives it its own
//! single-instance lock, store and WebView2 profile (see `Rebuild Arkadia
//! Lab.bat`). It leaves the phone, the gate and artifact routing to the daily
//! instance, runs the usage poller and its quota hellos only while the daily
//! one is closed (`gate::arkadia_running`), notifies from its own signal
//! folder (`popup::signal_dir`), and starts from its projects without its
//! tabs. Serving the phone from the Lab would blind that check: the Lab would
//! see itself and never send a hello.

use std::path::Path;

/// Whether this build is Arkadia Lab.
pub const LAB: bool = is_lab_flag(option_env!("ARKADIA_LAB_BUILD"));
/// Build-time switch, set only by the Lab's build script. Kept apart from
/// `PANE_MARKER`: a daily build run from a Lab pane must not become a Lab.
pub const BUILD_FLAG: &str = "ARKADIA_LAB_BUILD";
/// Set on every Lab pane, for the hooks (`arkadia-notify.ps1` drops its
/// signals into the Lab's own folder, never the daily instance's).
pub const PANE_MARKER: &str = "ARKADIA_LAB";

/// Only the exact value "1" builds a Lab: "0" or an empty value never does.
const fn is_lab_flag(flag: Option<&str>) -> bool {
    match flag {
        // A const can't compare strings: "1", byte by byte.
        Some(flag) => matches!(flag.as_bytes(), [b'1']),
        None => false,
    }
}

/// Variables one instance leaves behind for the other: the build flag (a
/// build run from anything this instance starts would make a Lab), the Lab
/// pane marker in a daily instance started from a Lab pane (its hooks would
/// write to the Lab's folder), in the Lab a `BROWSER` pointing at the daily
/// exe (its artifacts would land in an inbox nobody reads), and in both the
/// chat marker of an instance started from a chat session (the hooks of all
/// its terminals would go quiet).
fn foreign_vars(lab: bool) -> &'static [&'static str] {
    if lab {
        &[BUILD_FLAG, "BROWSER", crate::chat::CHAT_MARKER]
    } else {
        &[BUILD_FLAG, PANE_MARKER, crate::chat::CHAT_MARKER]
    }
}

/// Drops `foreign_vars` from Arkadia's own environment, so no terminal, tool
/// or build it starts inherits them. Call first thing in `main`, before any
/// thread exists, like `forget_parent_claude_session`.
pub fn forget_foreign_vars() {
    for name in foreign_vars(LAB) {
        std::env::remove_var(name);
    }
}

const DAILY_ID: &str = "com.trinitx.arkadia";
const LAB_ID: &str = "com.trinitx.arkadia.lab";
const STORE_FILE: &str = "store.json";
/// Daily store keys a fresh Lab must not inherit: the tabs to restore would
/// resume the daily sessions a second time, and the usage-limit bookkeeping
/// belongs to the daily instance (same pair as `seedDevStore` in `store.ts`).
const SKIPPED_KEYS: [&str; 2] = ["sessionSnapshot", "limitState"];

/// First Lab launch: copy the daily store, minus its tabs and usage-limit
/// bookkeeping. Call before the webview loads the store.
pub fn seed_store() {
    if !LAB {
        return;
    }
    // Tauri's app data dir on Windows: the roaming dir + the identifier.
    let Some(roaming) = dirs::data_dir() else {
        return;
    };
    if let Err(e) = seed_store_in(&roaming) {
        crate::popup::log_line(&format!("[lab] store not seeded: {e}"));
    }
}

/// Returns whether a store was written. An existing Lab store is never touched.
fn seed_store_in(roaming: &Path) -> Result<bool, String> {
    let lab = roaming.join(LAB_ID).join(STORE_FILE);
    if lab.exists() {
        return Ok(false);
    }
    let daily = match std::fs::read_to_string(roaming.join(DAILY_ID).join(STORE_FILE)) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    let mut store: serde_json::Value =
        serde_json::from_str(daily.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
    let Some(entries) = store.as_object_mut() else {
        return Err("daily store is not a JSON object".into());
    };
    for key in SKIPPED_KEYS {
        entries.remove(key);
    }
    let dir = roaming.join(LAB_ID);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(&store).map_err(|e| e.to_string())?;
    std::fs::write(&lab, text).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_builds_a_lab() {
        assert!(is_lab_flag(Some("1")));
        for flag in [None, Some("0"), Some(""), Some("10"), Some(" 1")] {
            assert!(!is_lab_flag(flag), "{flag:?}");
        }
    }

    #[test]
    fn each_instance_drops_what_the_other_leaves() {
        let chat = crate::chat::CHAT_MARKER;
        assert_eq!(foreign_vars(true), [BUILD_FLAG, "BROWSER", chat]);
        assert_eq!(foreign_vars(false), [BUILD_FLAG, PANE_MARKER, chat]);
    }

    fn roaming() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("arkadia-lab-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join(DAILY_ID)).unwrap();
        dir
    }

    #[test]
    fn copies_the_daily_projects_without_its_tabs() {
        let root = roaming();
        std::fs::write(
            root.join(DAILY_ID).join(STORE_FILE),
            r#"{"projects":[{"name":"Arkadia"}],"sessionSnapshot":{"tabs":[1]},"limitState":{}}"#,
        )
        .unwrap();
        assert_eq!(seed_store_in(&root), Ok(true));
        let lab: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(root.join(LAB_ID).join(STORE_FILE)).unwrap(),
        )
        .unwrap();
        assert_eq!(lab, serde_json::json!({"projects":[{"name":"Arkadia"}]}));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn never_overwrites_a_lab_store() {
        let root = roaming();
        std::fs::write(root.join(DAILY_ID).join(STORE_FILE), r#"{"projects":[]}"#).unwrap();
        std::fs::create_dir_all(root.join(LAB_ID)).unwrap();
        std::fs::write(root.join(LAB_ID).join(STORE_FILE), r#"{"mine":true}"#).unwrap();
        assert_eq!(seed_store_in(&root), Ok(false));
        assert_eq!(
            std::fs::read_to_string(root.join(LAB_ID).join(STORE_FILE)).unwrap(),
            r#"{"mine":true}"#
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
