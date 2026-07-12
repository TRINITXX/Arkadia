mod agent_registry;
mod claude_watcher;
mod conversation;
mod fonts;
mod popup;
mod external_action;
mod screenshots;
mod terminal;
pub mod terminal_state;

use std::path::PathBuf;
use std::sync::Arc;

use agent_registry::AgentRegistry;
use claude_watcher::watcher::run_watcher;
use fonts::get_font_data;
use screenshots::save_screenshot;
use tauri::{Emitter, Manager};
use terminal::{
    close_terminal, get_text_range, list_message_markers, navigate_message, request_render,
    resize_terminal, scroll_reply_to_top, scroll_terminal, search_terminal, send_input,
    send_mouse_event, set_scrollback_cap, spawn_terminal, SessionMap,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::default());

    // `mut` is only used by the release-only single-instance block below.
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // Single-instance is RELEASE-ONLY. In a release build a second launch (e.g.
    // running a fresh build without closing the old one) would start a duplicate
    // app — and a duplicate popup watcher → several popup windows, some routing
    // the wrong conversation; instead we focus the running window and exit. In
    // debug we skip it so `tauri dev` always launches, even alongside a daily
    // instance. Must be the first plugin registered.
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, argv, _cwd| {
                // Focus the running window (previous behaviour).
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                // If this second launch carried a --wt-* action, forward it to
                // the frontend, which reuses the live add/remove project paths.
                if let Some(action) = crate::external_action::parse_external_action(&argv) {
                    let _ = app.emit("external-action", action);
                }
            },
        ));
    }

    builder
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(SessionMap::default())
        .manage(terminal::ScrollbackConfig::default())
        .manage(registry.clone())
        .manage(popup::PopupQueue::default())
        .setup({
            let registry = registry.clone();
            move |app| {
                let app_handle = app.handle().clone();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.maximize();
                    // When the user alt-tabs back to Arkadia, dismiss any pending
                    // background notification — they're now looking at the app.
                    let ah = app_handle.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::Focused(true) = event {
                            crate::popup::dismiss_all(&ah);
                        }
                    });
                }

                // Background-notification popup: watch the hook signal dir and
                // surface a reply popup when Claude is waiting and the main
                // window is unfocused.
                {
                    let popup_app = app_handle.clone();
                    let popup_registry = registry.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = popup::run_notify_watcher(popup_app, popup_registry) {
                            eprintln!("[arkadia popup] watcher stopped: {e}");
                        }
                    });
                }
                let claude_root = dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".claude")
                    .join("projects");
                let (utx, urx) = std::sync::mpsc::channel::<claude_watcher::watcher::StateUpdate>();
                let (_stx, srx) = std::sync::mpsc::channel::<()>();
                std::thread::spawn(move || {
                    let _ = run_watcher(claude_root, utx, srx);
                });
                std::thread::spawn(move || {
                    while let Ok(update) = urx.recv() {
                        registry.observe_session(
                            &update.cwd,
                            &update.session_id,
                            update.state.clone(),
                        );
                        let payload = agent_registry::AgentStatePayload::from(&update.state);
                        let _ = app_handle.emit(
                            "agent-state-changed",
                            AgentEvent {
                                session_id: update.session_id,
                                cwd: update.cwd,
                                state: payload,
                            },
                        );
                    }
                });
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            spawn_terminal,
            send_input,
            resize_terminal,
            set_scrollback_cap,
            request_render,
            close_terminal,
            scroll_terminal,
            scroll_reply_to_top,
            search_terminal,
            list_message_markers,
            navigate_message,
            get_text_range,
            send_mouse_event,
            get_font_data,
            agent_state_for_pane,
            agent_state_for_project,
            open_path,
            run_detached,
            resolve_path_at,
            save_screenshot,
            conversation::read_conversation,
            conversation::read_conversation_blocks,
            popup::popup_request_state,
            popup::popup_log_ui,
            popup::popup_set_style,
            popup::popup_set_fullscreen,
            popup::popup_set_notif_width,
            popup::set_pane_projects,
            popup::popup_set_auto_scroll,
            popup::popup_dismiss,
            popup::popup_open_in_main,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(serde::Serialize, Clone)]
struct AgentEvent {
    session_id: String,
    cwd: String,
    state: agent_registry::AgentStatePayload,
}

/// Extensions the OS would *execute* rather than *open*. The clicked path comes
/// from untrusted terminal output, so a crafted path to one of these on disk
/// would turn a single click into arbitrary code execution — we refuse them.
/// Document/code types (.txt, .rs, .ts, .json, .html, .png…) stay openable.
const EXECUTABLE_EXTS: &[&str] = &[
    // Windows native / Script Host
    "exe", "com", "bat", "cmd", "scr", "pif", "msi", "msp", "mst", "cpl", "msc", "vbs", "vbe", "js",
    "jse", "ws", "wsf", "wsh", "hta", "lnk", "scf", "reg", "inf", "ins", "isp", "job", "application",
    "gadget", "url", // PowerShell
    "ps1", "psm1", "psd1", // Cross-platform / Java / Unix shells
    "jar", "sh", "bash", "zsh", "csh", "ksh", "command", "desktop", "run", "app",
];

/// True if the path's extension is in the executable denylist (case-insensitive).
fn is_executable_ext(p: &std::path::Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXECUTABLE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Opens a file with the OS default application. The path is expected to be
/// resolved to absolute form by the caller. Detached so the launched app's
/// lifetime is independent of ours. Executable types are rejected (see above).
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("path not found: {path}"));
    }
    if is_executable_ext(p) {
        return Err(format!("refusing to open executable file type: {path}"));
    }
    open::that_detached(&path).map_err(|e| e.to_string())
}

/// Runs `command` via a detached PowerShell process. Detached so it outlives the
/// terminal that requested it — used by the worktree merge flow, where Arkadia
/// closes the requesting terminal and the leftover `git worktree remove` must
/// still run. `cwd` must be a directory NOT inside the worktree being removed.
#[tauri::command]
fn run_detached(command: String, cwd: String) -> Result<(), String> {
    use std::process::Command;
    let mut c = Command::new("pwsh.exe");
    c.arg("-NoProfile").arg("-Command").arg(&command).current_dir(&cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW (0x08000000) | CREATE_NEW_PROCESS_GROUP (0x200):
        // hidden console of its own, independent of the caller's, so a closed
        // PTY can't kill it. NOT DETACHED_PROCESS (0x8): a console-less pwsh
        // exits 0 without ever running `-Command`.
        c.creation_flags(0x0800_0000 | 0x0000_0200);
    }
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// A file path located inside a terminal line by `resolve_path_at`. `start`/`end`
/// are char indices into the line (end exclusive) for the highlight extent.
#[derive(serde::Serialize)]
struct ResolvedPath {
    start: usize,
    end: usize,
    abs_path: String,
    line: Option<u32>,
    col: Option<u32>,
}

/// Joins a possibly-relative path against `cwd`. Absolute when it has a Windows
/// drive prefix (`C:\` / `C:/`) or starts with a slash/backslash. A leading `~`
/// (alone, or followed by `/` or `\`) expands to the user's home directory.
/// Mirrors the previous frontend `resolveAbsPath`.
fn resolve_against_cwd(path_part: &str, cwd: Option<&str>) -> String {
    // `~`, `~/...`, `~\...` → home directory. The `~` is one ASCII byte, so
    // slicing at [1..] keeps the leading separator (or empties for a bare `~`).
    if path_part == "~" || path_part.starts_with("~/") || path_part.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            let home = home.to_string_lossy();
            return format!("{}{}", home.trim_end_matches(['/', '\\']), &path_part[1..]);
        }
    }
    let b = path_part.as_bytes();
    let is_abs = path_part.starts_with('/')
        || path_part.starts_with('\\')
        || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'));
    match cwd {
        Some(cwd) if !is_abs && !cwd.is_empty() => {
            let sep = if cwd.contains('\\') { '\\' } else { '/' };
            format!("{}{}{}", cwd.trim_end_matches(['/', '\\']), sep, path_part)
        }
        _ => path_part.to_string(),
    }
}

/// Chars that can't appear in a path and therefore bound the candidate window.
fn is_hard_delim(c: char) -> bool {
    matches!(c, '"' | '<' | '>' | '|' | '*' | '?') || c.is_control()
}

/// If `s` ends with `:N` or `:N:M` (digits), returns (path_len, line, col) where
/// `path_len` is the char count of the path portion. Otherwise (s.len(), None, None).
fn strip_line_col(s: &[char]) -> (usize, Option<u32>, Option<u32>) {
    fn trailing_num(s: &[char], end: usize) -> Option<(usize, u32)> {
        let mut i = end;
        while i > 0 && s[i - 1].is_ascii_digit() {
            i -= 1;
        }
        if i == end || i == 0 || s[i - 1] != ':' {
            return None;
        }
        let num: String = s[i..end].iter().collect();
        num.parse::<u32>().ok().map(|v| (i - 1, v))
    }
    let n = s.len();
    if let Some((colon2, b)) = trailing_num(s, n) {
        if let Some((colon1, a)) = trailing_num(s, colon2) {
            return (colon1, Some(a), Some(b));
        }
        return (colon2, Some(b), None);
    }
    (n, None, None)
}

/// Finds the longest existing file path in `line` that covers char index `click`,
/// resolving relative paths against `cwd`. Spaces are allowed inside a path; the
/// filesystem check is what bounds the path, so prose around it (which doesn't
/// resolve to an existing file) is naturally excluded. Executables are skipped.
#[tauri::command]
fn resolve_path_at(line: String, cwd: Option<String>, click: usize) -> Option<ResolvedPath> {
    let chars: Vec<char> = line.chars().collect();
    let n = chars.len();
    if n == 0 || click >= n {
        return None;
    }

    // 1. Window around `click`, bounded by hard delimiters and runs of >=2 spaces.
    let mut win_start = click;
    while win_start > 0 {
        let c = chars[win_start - 1];
        if is_hard_delim(c) || (c == ' ' && win_start >= 2 && chars[win_start - 2] == ' ') {
            break;
        }
        win_start -= 1;
    }
    let mut win_end = click;
    while win_end < n {
        let c = chars[win_end];
        if is_hard_delim(c) || (c == ' ' && win_end + 1 < n && chars[win_end + 1] == ' ') {
            break;
        }
        win_end += 1;
    }
    while win_start < click && chars[win_start] == ' ' {
        win_start += 1;
    }
    while win_end > click + 1 && chars[win_end - 1] == ' ' {
        win_end -= 1;
    }
    if win_start >= win_end {
        return None;
    }

    // 2. Start candidates: window start + after each single space up to click.
    //    End candidates: window end + each single space after click.
    //    Brackets/quotes also split — they often hug a path (`Read(C:\…\x.rs)`)
    //    — but only as *candidates*, never hard bounds, because they can be
    //    part of the path itself (`C:\Program Files (x86)\…`). Longest-first
    //    trial keeps such paths winning when they exist on disk.
    const OPENERS: [char; 4] = ['(', '[', '{', '\''];
    const CLOSERS: [char; 4] = [')', ']', '}', '\''];
    let mut starts = vec![win_start];
    for i in win_start..click {
        if chars[i] == ' ' || OPENERS.contains(&chars[i]) {
            starts.push(i + 1);
        }
    }
    let mut ends = vec![win_end];
    for i in (click + 1)..win_end {
        if chars[i] == ' ' || CLOSERS.contains(&chars[i]) {
            ends.push(i);
        }
    }

    // 3. Try (start, end) longest first; first one that exists wins.
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    for &s in &starts {
        for &e in &ends {
            if s <= click && click < e && s < e {
                pairs.push((s, e));
            }
        }
    }
    pairs.sort_by_key(|&(s, e)| std::cmp::Reverse(e - s));

    for (s, e) in pairs {
        let sub = &chars[s..e];
        if !sub.iter().any(|&c| c == '/' || c == '\\') {
            continue; // not path-like
        }
        let (path_len, line_no, col_no) = strip_line_col(sub);
        let path_part: String = sub[..path_len].iter().collect();
        let path_part = path_part.trim();
        if path_part.is_empty() {
            continue;
        }
        let abs = resolve_against_cwd(path_part, cwd.as_deref());
        let p = std::path::Path::new(&abs);
        if p.exists() && !is_executable_ext(p) {
            return Some(ResolvedPath {
                start: s,
                end: e,
                abs_path: abs,
                line: line_no,
                col: col_no,
            });
        }
    }
    None
}

#[tauri::command]
fn agent_state_for_pane(
    pane_id: String,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> agent_registry::AgentStatePayload {
    let uuid = uuid::Uuid::parse_str(&pane_id).unwrap_or_else(|_| uuid::Uuid::nil());
    registry.pane_state(uuid)
}

#[tauri::command]
fn agent_state_for_project(
    pane_ids: Vec<String>,
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> agent_registry::AgentStatePayload {
    let uuids: Vec<uuid::Uuid> = pane_ids
        .into_iter()
        .filter_map(|s| uuid::Uuid::parse_str(&s).ok())
        .collect();
    registry.project_state(&uuids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Char index of `needle` in `line`, plus `offset` chars into it.
    fn click_at(line: &str, needle: &str, offset: usize) -> usize {
        let byte_pos = line.find(needle).expect("needle in line");
        line[..byte_pos].chars().count() + offset
    }

    #[test]
    fn run_detached_actually_runs_the_command() {
        // Spawn success is NOT enough: with DETACHED_PROCESS a console-less
        // pwsh exits 0 without ever running `-Command`. Assert the observable
        // side effect instead of the spawn result.
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("ran.txt");
        let cmd = format!("Set-Content -Path '{}' -Value ok", marker.display());
        let cwd = dir.path().to_string_lossy().to_string();
        assert!(run_detached(cmd, cwd).is_ok());
        // pwsh cold-start can take a few seconds on CI-grade machines.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while !marker.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        assert!(marker.exists(), "detached pwsh never ran the command");
    }

    #[test]
    fn resolves_absolute_path_with_spaces() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("Program Files").join("My App");
        fs::create_dir_all(&nested).unwrap();
        let file = nested.join("file.txt");
        fs::write(&file, "x").unwrap();
        let abs = file.to_string_lossy().to_string();
        let line = format!("see {abs} now");
        let click = click_at(&line, "file.txt", 2);
        let r = resolve_path_at(line, None, click).expect("should resolve");
        assert_eq!(r.abs_path, abs);
    }

    #[test]
    fn resolves_relative_path_with_spaces_excluding_prose() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let nested = dir.path().join("src").join("mon dossier");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("x.tsx"), "x").unwrap();
        let line = "Update src/mon dossier/x.tsx here".to_string();
        let click = click_at(&line, "x.tsx", 1);
        let r = resolve_path_at(line.clone(), Some(cwd), click).expect("should resolve");
        let chars: Vec<char> = line.chars().collect();
        let extent: String = chars[r.start..r.end].iter().collect();
        // The "Update " prose prefix must be excluded.
        assert_eq!(extent, "src/mon dossier/x.tsx");
    }

    #[test]
    fn returns_none_for_nonexistent_path() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let line = "edit foo/bar.txt please".to_string();
        let click = click_at(&line, "bar.txt", 1);
        assert!(resolve_path_at(line, Some(cwd), click).is_none());
    }

    #[test]
    fn skips_executables() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        fs::write(dir.path().join("tool.exe"), "x").unwrap();
        let line = "run ./tool.exe now".to_string();
        let click = click_at(&line, "tool.exe", 1);
        assert!(resolve_path_at(line, Some(cwd), click).is_none());
    }

    #[test]
    fn resolves_path_hugged_by_parens() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("terminal.rs");
        fs::write(&file, "x").unwrap();
        let abs = file.to_string_lossy().to_string();
        // Claude Code tool-call rendering: `Read(C:\…\terminal.rs)`.
        let line = format!("Read({abs})");
        let click = click_at(&line, "terminal.rs", 3);
        let r = resolve_path_at(line.clone(), None, click).expect("should resolve");
        assert_eq!(r.abs_path, abs);
        let chars: Vec<char> = line.chars().collect();
        let extent: String = chars[r.start..r.end].iter().collect();
        assert_eq!(extent, abs); // parens excluded from the highlight
    }

    #[test]
    fn resolves_path_containing_parens() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("Program Files (x86)").join("App");
        fs::create_dir_all(&nested).unwrap();
        let file = nested.join("readme.txt");
        fs::write(&file, "x").unwrap();
        let abs = file.to_string_lossy().to_string();
        let line = format!("see {abs} now");
        let click = click_at(&line, "readme.txt", 2);
        let r = resolve_path_at(line, None, click).expect("should resolve");
        assert_eq!(r.abs_path, abs);
    }

    #[test]
    fn resolves_parenthesized_path_with_line_col() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let nested = dir.path().join("src");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("App.tsx"), "x").unwrap();
        let line = "error at (src/App.tsx:42:5)".to_string();
        let click = click_at(&line, "App.tsx", 1);
        let r = resolve_path_at(line, Some(cwd), click).expect("should resolve");
        assert_eq!(r.line, Some(42));
        assert_eq!(r.col, Some(5));
        assert!(r.abs_path.ends_with("App.tsx"));
    }

    #[test]
    fn expands_leading_tilde_to_home() {
        let home = dirs::home_dir().expect("home dir");
        let home_str = home.to_string_lossy();
        let home_trimmed = home_str.trim_end_matches(['/', '\\']);
        // The `~` wins over a cwd join, even though it isn't classically absolute.
        assert_eq!(
            resolve_against_cwd("~/Desktop/report.md", Some("/some/cwd")),
            format!("{home_trimmed}/Desktop/report.md")
        );
        assert_eq!(
            resolve_against_cwd("~\\Desktop\\report.md", Some("/some/cwd")),
            format!("{home_trimmed}\\Desktop\\report.md")
        );
        assert_eq!(resolve_against_cwd("~", None), home_trimmed.to_string());
        // A `~` not at the start, or `~name`, is left untouched (joined to cwd).
        assert_eq!(
            resolve_against_cwd("~user/x", Some("/cwd")),
            "/cwd/~user/x"
        );
    }

    #[test]
    fn resolves_tilde_home_path() {
        let home = dirs::home_dir().expect("home dir");
        let name = "arkadia_tilde_click_test.txt";
        let file = home.join(name);
        fs::write(&file, "x").unwrap();
        let line = format!("open ~/{name} please");
        let click = click_at(&line, name, 1);
        let r = resolve_path_at(line, None, click);
        fs::remove_file(&file).ok();
        let r = r.expect("should resolve ~ path");
        // Compare as paths so a mixed `/` vs `\` separator doesn't fail on Windows.
        assert_eq!(std::path::Path::new(&r.abs_path), file.as_path());
    }

    #[test]
    fn strips_line_col_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_string_lossy().to_string();
        let nested = dir.path().join("src");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("App.tsx"), "x").unwrap();
        let line = "at src/App.tsx:42:5 there".to_string();
        let click = click_at(&line, "App.tsx", 1);
        let r = resolve_path_at(line, Some(cwd), click).expect("should resolve");
        assert_eq!(r.line, Some(42));
        assert_eq!(r.col, Some(5));
        assert!(r.abs_path.ends_with("App.tsx"));
    }
}
