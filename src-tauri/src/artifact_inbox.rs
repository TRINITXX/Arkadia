//! Artifacts Claude Code opens by itself land in the panel of their own tab.
//!
//! Every pane gets `BROWSER` = Arkadia's own exe (`browser_command`): Claude
//! Code, like git, gh or Python, runs that program with the URL to open. That
//! second Arkadia process never starts the app (`forward_request`, checked
//! first thing in `main`): a claude.ai artifact is dropped in the inbox
//! folder with the pane id the process inherited (`ARKADIA_PANE_ID`), and any
//! other URL opens in the default browser as before. The running Arkadia
//! watches the inbox and asks the main window to open each artifact in the
//! tab of its pane.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Url};

/// Set on each pane by `terminal.rs`; inherited by everything it starts.
const PANE_VAR: &str = "ARKADIA_PANE_ID";

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    pane_id: String,
    url: String,
}

fn inbox_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("artifact-inbox")
}

/// What to forward when this process was started as a pane's `BROWSER`: its
/// single argument (a URL, a file, a `vscode:` link…) and the pane it came
/// from, if any. Arkadia's own flags start with `--` and a normal launch
/// takes no argument, so they never land here.
pub fn forward_request() -> Option<(String, Option<String>)> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    request_from(&args, std::env::var(PANE_VAR).ok())
}

fn request_from(args: &[String], pane: Option<String>) -> Option<(String, Option<String>)> {
    let [target] = args else {
        return None;
    };
    (!target.starts_with("--")).then(|| (target.clone(), pane.filter(|p| !p.is_empty())))
}

/// `BROWSER` mode, from `main`: a claude.ai artifact from a pane goes to the
/// running Arkadia; anything else opens as the calling program would have
/// opened it without `BROWSER` (default browser, file, registered app).
pub fn forward(target: &str, pane: Option<&str>) {
    let is_artifact = Url::parse(target)
        .map(|u| crate::artifact_view::is_artifact_url(&u))
        .unwrap_or(false);
    if let (true, Some(pane)) = (is_artifact, pane) {
        if drop_in_inbox(&inbox_dir(), pane, target).is_ok() {
            return;
        }
    }
    let _ = open::that_detached(target);
}

/// Written under a temporary name then renamed, so the watcher never reads a
/// half-written file.
fn drop_in_inbox(dir: &Path, pane: &str, url: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    // Unique even for two drops in the same instant: a shared name would let
    // the second request overwrite the first.
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let name = format!(
        "{stamp}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let body = serde_json::to_string(&OpenRequest {
        pane_id: pane.to_string(),
        url: url.to_string(),
    })?;
    let tmp = dir.join(format!("{name}.tmp"));
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, dir.join(format!("{name}.json")))
}

/// What a pane's `BROWSER` holds: this exe, by its short (8.3) path when the
/// long one has spaces, with forward slashes. gh, Python and others split
/// `BROWSER` like a shell command: spaces cut it, backslashes vanish.
pub fn browser_command() -> Option<&'static str> {
    static COMMAND: OnceLock<Option<String>> = OnceLock::new();
    COMMAND
        .get_or_init(|| {
            let exe = std::env::current_exe().ok()?;
            let long = exe.to_str()?.to_string();
            let path = if long.contains(' ') {
                short_path(&exe).unwrap_or(long)
            } else {
                long
            };
            Some(shell_safe(&path))
        })
        .as_deref()
}

fn shell_safe(path: &str) -> String {
    path.replace('\\', "/")
}

#[cfg(windows)]
fn short_path(path: &Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut buf = vec![0u16; 1024];
    let len = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), Some(&mut buf)) } as usize;
    if len == 0 || len > buf.len() {
        return None;
    }
    let short = String::from_utf16(&buf[..len]).ok()?;
    (!short.contains(' ')).then_some(short)
}

#[cfg(not(windows))]
fn short_path(_path: &Path) -> Option<String> {
    None
}

/// A request older than this has no instance left to take it.
const STALE_AFTER: Duration = Duration::from_secs(60);

/// Watches the inbox for the app's lifetime, on its own thread. The folder is
/// shared by every Arkadia running (the daily one and a `tauri dev`): each
/// takes only the requests of its own panes. Stale requests are dropped at
/// startup: the panel starts empty after a restart.
pub fn run_watcher(app: AppHandle) -> notify::Result<()> {
    let dir = inbox_dir();
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_none_or(|age| age > STALE_AFTER);
            if stale {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let owns = |pane: &str| {
        app.try_state::<crate::terminal::SessionMap>()
            .is_some_and(|sessions| sessions.has_session(pane))
    };
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;
    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    for path in event.paths {
                        if let Some(request) = take_request(&path, owns) {
                            let _ = app.emit_to("main", "artifact-open-request", request);
                        }
                    }
                }
            }
            Ok(Err(_)) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

/// Takes one request file if its pane is ours (`owns`), else leaves it to
/// the Arkadia that runs that pane. A malformed request, or anything but a
/// claude.ai artifact, is removed and refused, whoever dropped it. A file
/// that cannot be read yet stays for a later event or the startup cleanup.
fn take_request(path: &Path, owns: impl Fn(&str) -> bool) -> Option<OpenRequest> {
    if path.extension().and_then(|s| s.to_str()) != Some("json") {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<OpenRequest>(raw.trim_start_matches('\u{feff}'))
        .ok()
        .filter(|r| {
            Url::parse(&r.url)
                .map(|u| crate::artifact_view::is_artifact_url(&u))
                .unwrap_or(false)
        });
    match parsed {
        Some(request) if !owns(&request.pane_id) => None,
        parsed => {
            let _ = std::fs::remove_file(path);
            parsed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn handles_any_single_argument_but_arkadia_flags() {
        let pane = || Some("pane-1".to_string());
        let url = "https://claude.ai/artifact/abc";
        assert_eq!(
            request_from(&args(&[url]), pane()),
            Some((url.to_string(), pane()))
        );
        // cargo doc --open passes a file, Claude Code a vscode: link: both
        // open as without BROWSER, never as a second Arkadia.
        assert!(request_from(&args(&["C:/target/doc/index.html"]), pane()).is_some());
        assert!(request_from(&args(&["vscode://file/x"]), None).is_some());
        assert_eq!(request_from(&args(&[url]), Some(String::new())), Some((url.to_string(), None)));
        assert_eq!(request_from(&args(&[]), pane()), None);
        assert_eq!(request_from(&args(&["--gate"]), pane()), None);
        assert_eq!(request_from(&args(&[url, "x"]), pane()), None);
    }

    #[test]
    fn browser_path_survives_shell_style_splitting() {
        assert_eq!(
            shell_safe(r"C:\Users\TRINITX\Desktop\CLAUDE~1\Arkadia\arkadia.exe"),
            "C:/Users/TRINITX/Desktop/CLAUDE~1/Arkadia/arkadia.exe"
        );
    }

    #[test]
    fn inbox_keeps_own_artifacts_leaves_others_and_refuses_other_links() {
        let dir = std::env::temp_dir().join(format!("arkadia-inbox-test-{}", std::process::id()));
        drop_in_inbox(&dir, "pane-1", "https://claude.ai/artifact/abc").unwrap();
        drop_in_inbox(&dir, "pane-1", "https://evil.example/x").unwrap();
        drop_in_inbox(&dir, "other-instance-pane", "https://claude.ai/artifact/def").unwrap();
        let ours = |pane: &str| pane == "pane-1";
        let taken: Vec<OpenRequest> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter_map(|e| take_request(&e.path(), ours))
            .collect();
        assert_eq!(
            taken,
            vec![OpenRequest {
                pane_id: "pane-1".into(),
                url: "https://claude.ai/artifact/abc".into()
            }]
        );
        // Only the other instance's request is left, for it to take.
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
