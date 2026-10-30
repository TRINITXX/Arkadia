//! Claude's own dictation for the chat view. Only Claude Code's terminal
//! interface dictates (the Agent SDK and the API have no speech-to-text), so
//! Arkadia keeps one hidden terminal running `claude`. The page holds space
//! there the way the rail does (`PaneInputRail`), then sends Enter: a
//! `UserPromptSubmit` hook (this same exe, run with `--voice-capture`) writes
//! the prompt to a file and blocks it, so the dictation never reaches the
//! model. Claude Code signs in by itself: Arkadia never touches a token.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, State};

use crate::agent_registry::AgentRegistry;
use crate::conversation::ConvCacheMap;
use crate::terminal::{ScrollbackConfig, SessionMap};

const CAPTURE_ARG: &str = "--voice-capture";
const SETTINGS_FILE: &str = "settings.json";

/// The hidden dictation pane, once started.
#[derive(Default)]
pub struct VoicePane(Mutex<Option<String>>);

/// Per instance: the settings name this exe as the hook, and the hidden
/// `claude` runs here (its transcripts stay out of real projects).
fn voice_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join(if crate::lab::LAB {
            "voice-lab"
        } else {
            "voice"
        })
}

/// The capture folder when this process was started as the hook.
pub fn capture_dir_arg() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    capture_dir_from(&args)
}

fn capture_dir_from(args: &[String]) -> Option<PathBuf> {
    match args {
        [flag, dir] if flag == CAPTURE_ARG => Some(PathBuf::from(dir)),
        _ => None,
    }
}

/// Hook mode, from `main`: keeps the submitted prompt for the pane that
/// dictated it, and tells Claude Code to drop it.
pub fn capture(dir: &Path) {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let pane = std::env::var("ARKADIA_PANE_ID").unwrap_or_default();
    if let Some(text) = prompt_of(&input) {
        if uuid::Uuid::parse_str(&pane).is_ok() {
            let _ = write_capture(dir, &pane, &text);
        }
    }
    let _ = std::io::stdout().write_all(BLOCK_OUTPUT.as_bytes());
}

/// Stops the prompt and keeps its text out of the block message.
const BLOCK_OUTPUT: &str = r#"{"decision":"block","reason":"Dictée envoyée à Arkadia.","hookSpecificOutput":{"hookEventName":"UserPromptSubmit","suppressOriginalPrompt":true}}"#;

fn prompt_of(hook_input: &str) -> Option<String> {
    let value: serde_json::Value =
        serde_json::from_str(hook_input.trim_start_matches('\u{feff}')).ok()?;
    let prompt = value.get("prompt")?.as_str()?.trim();
    (!prompt.is_empty()).then(|| prompt.to_string())
}

/// Written under a temporary name then renamed, so a reader never sees half.
fn write_capture(dir: &Path, pane: &str, text: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{pane}.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, dir.join(format!("{pane}.txt")))
}

fn take_capture(dir: &Path, pane: &str) -> Option<String> {
    uuid::Uuid::parse_str(pane).ok()?;
    let path = dir.join(format!("{pane}.txt"));
    let text = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    Some(text)
}

/// Claude Code settings for the hidden `claude`, over the user's (whose
/// dictation language it keeps). The capture hook runs in exec form, with no
/// shell and no quoting, and a hook that fails blocks the prompt as well: a
/// dictation must never reach the model. Hold-to-talk without auto-submit
/// (Arkadia sends Enter once the transcript is in). Never a Remote Control
/// session nor a target for other sessions' messages, and plan mode should a
/// prompt slip through all the same.
fn settings_json(exe: &str, dir: &str) -> String {
    serde_json::json!({
        "hooks": {
            "UserPromptSubmit": [{
                "hooks": [{
                    "type": "command",
                    "command": exe,
                    "args": [CAPTURE_ARG, dir],
                    "onFailure": "block",
                    "timeout": 10
                }]
            }]
        },
        "voice": { "enabled": true, "mode": "hold", "autoSubmit": false },
        "remoteControlAtStartup": false,
        "crossSessionInbound": "refuse",
        "permissions": { "defaultMode": "plan" }
    })
    .to_string()
}

/// The hidden dictation pane, started on first use: a shell that runs
/// `claude` with the capture settings, on the main account (dictation needs a
/// claude.ai sign-in). Its frames reach the page like any pane's.
// Off the main thread: it writes a file and may start a shell (see `lib.rs`).
#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub fn voice_pane(
    cols: u16,
    rows: u16,
    voice: State<'_, VoicePane>,
    sessions: State<'_, SessionMap>,
    registry: State<'_, Arc<AgentRegistry>>,
    scrollback: State<'_, ScrollbackConfig>,
    conv_cache: State<'_, ConvCacheMap>,
    app: AppHandle,
) -> Result<String, String> {
    let mut current = voice.0.lock();
    if let Some(id) = current.take() {
        if sessions.is_running(&id) {
            *current = Some(id.clone());
            return Ok(id);
        }
        // Its Claude Code quit, and the shell with it: the pane goes, as a
        // closed tab's does, and a fresh one replaces it.
        let _ = crate::terminal::close_terminal(id, sessions.clone(), registry.clone(), conv_cache);
    }
    let dir = voice_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_str().ok_or("chemin d'Arkadia illisible")?;
    let cwd = dir
        .to_str()
        .ok_or("dossier du vocal illisible")?
        .to_string();
    let settings = dir.join(SETTINGS_FILE);
    std::fs::write(&settings, settings_json(exe, &cwd)).map_err(|e| e.to_string())?;
    // No MCP server: dictation uses no tool. `exit` closes the shell along
    // with `claude`, so a Claude Code that quit leaves no live-looking pane.
    let command = format!(
        "claude --strict-mcp-config --settings {}; exit",
        ps_quote(&settings.display().to_string())
    );
    let id = crate::terminal::spawn_terminal(
        cwd,
        cols,
        rows,
        sessions,
        registry,
        scrollback,
        app,
        Some(command),
        None,
    )?;
    *current = Some(id.clone());
    Ok(id)
}

/// A PowerShell single-quoted string: nothing inside is read but the quote,
/// doubled. PowerShell also closes such a string on the typographic quotes
/// (U+2018 to U+201B), as in a profile folder named `O’Neil`.
fn ps_quote(text: &str) -> String {
    let mut quoted = String::from("'");
    for c in text.chars() {
        if matches!(c, '\'' | '\u{2018}'..='\u{201B}') {
            quoted.push(c);
        }
        quoted.push(c);
    }
    quoted.push('\'');
    quoted
}

/// The text the hook kept for this pane, once: None until it arrives.
#[tauri::command(async)]
pub fn voice_take(pane_id: String) -> Option<String> {
    take_capture(&voice_dir(), &pane_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arkadia-voice-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn quotes_a_path_for_powershell() {
        assert_eq!(ps_quote(r"C:\Users\A B\s.json"), r"'C:\Users\A B\s.json'");
        assert_eq!(ps_quote("C:\\O'Neil\\$x"), "'C:\\O''Neil\\$x'");
        assert_eq!(ps_quote("C:\\O\u{2019}Neil"), "'C:\\O\u{2019}\u{2019}Neil'");
    }

    #[test]
    fn hook_mode_needs_the_flag_and_a_folder() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            capture_dir_from(&args(&["--voice-capture", "C:/x"])),
            Some(PathBuf::from("C:/x"))
        );
        assert_eq!(capture_dir_from(&args(&["--voice-capture"])), None);
        assert_eq!(capture_dir_from(&args(&["https://claude.ai"])), None);
    }

    #[test]
    fn keeps_the_dictated_prompt_once() {
        let dir = dir();
        let pane = uuid::Uuid::new_v4().to_string();
        let text = prompt_of(
            r#"{"hook_event_name":"UserPromptSubmit","prompt":"  refais la vue lecture \n"}"#,
        )
        .unwrap();
        write_capture(&dir, &pane, &text).unwrap();
        assert_eq!(
            take_capture(&dir, &pane).as_deref(),
            Some("refais la vue lecture")
        );
        assert_eq!(take_capture(&dir, &pane), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_an_empty_prompt_and_a_bad_pane() {
        assert_eq!(prompt_of(r#"{"prompt":"   "}"#), None);
        assert_eq!(prompt_of("not json"), None);
        assert_eq!(take_capture(&dir(), "../secret"), None);
    }

    #[test]
    fn blocks_the_prompt_without_echoing_it() {
        let out: serde_json::Value = serde_json::from_str(BLOCK_OUTPUT).unwrap();
        assert_eq!(out["decision"], "block");
        assert_eq!(out["hookSpecificOutput"]["suppressOriginalPrompt"], true);
    }

    #[test]
    fn settings_fail_closed_and_stay_private() {
        let exe = r"C:\Users\A B\arkadia-lab.exe";
        let s: serde_json::Value = serde_json::from_str(&settings_json(exe, r"C:\v")).unwrap();
        let hook = &s["hooks"]["UserPromptSubmit"][0]["hooks"][0];
        // Exec form: the path with a space is one argument, no shell quoting.
        assert_eq!(hook["command"], exe);
        assert_eq!(hook["args"], serde_json::json!([CAPTURE_ARG, r"C:\v"]));
        assert_eq!(hook["onFailure"], "block");
        assert_eq!(s["voice"]["mode"], "hold");
        assert_eq!(s["voice"]["autoSubmit"], false);
        assert_eq!(s["remoteControlAtStartup"], false);
        assert_eq!(s["crossSessionInbound"], "refuse");
    }
}
