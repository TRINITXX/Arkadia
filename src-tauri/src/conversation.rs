//! Reads a pane's full conversation from Claude Code's transcript JSONL.
//!
//! The terminal only renders its current viewport, so a "reading view" of the
//! whole conversation can't come from the grid. The complete, ordered history
//! lives in `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (one JSON
//! object per line). We resolve the pane → session via the agent registry,
//! locate that file, and return just the genuine messages (the user's prompts
//! and Claude's prose), filtering out tool calls/results and injected context.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use crate::agent_registry::AgentRegistry;

#[derive(Serialize)]
pub struct ConvMessage {
    /// "user" or "assistant".
    pub role: String,
    /// The message text (markdown), cleaned of injected noise.
    pub text: String,
}

/// Tags Claude Code injects into user turns that aren't part of what the user
/// actually said — stripped so the reading view stays clean.
const INJECTED_TAGS: &[&str] = &[
    "system-reminder",
    "command-name",
    "command-message",
    "command-args",
    "local-command-stdout",
    "local-command-caveat",
];

/// Removes every `<tag …>…</tag>` span (handles attributes and a missing close).
fn strip_tag(mut s: String, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    while let Some(start) = s.find(&open) {
        if let Some(rel) = s[start..].find(&close) {
            let end = start + rel + close.len();
            s.replace_range(start..end, "");
        } else {
            s.replace_range(start.., "");
            break;
        }
    }
    s
}

fn clean_text(text: &str) -> String {
    let mut s = text.to_string();
    for tag in INJECTED_TAGS {
        s = strip_tag(s, tag);
    }
    s.trim().to_string()
}

/// Pulls the displayable text out of a transcript line. `None` when the line
/// isn't a user/assistant message or carries no genuine text (e.g. a turn that
/// is only a tool result, or only an injected reminder).
fn extract(v: &Value) -> Option<ConvMessage> {
    let typ = v.get("type")?.as_str()?;
    if typ != "user" && typ != "assistant" {
        return None;
    }
    let content = v.get("message")?.get("content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let mut parts = Vec::new();
            for block in arr {
                match block.get("type").and_then(|x| x.as_str()) {
                    Some("text") => {
                        if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                            parts.push(t.to_string());
                        }
                    }
                    // ExitPlanMode is the one tool call whose payload IS content
                    // the user wants to read: the proposed plan only ever lives in
                    // the tool's `plan` input (never echoed as assistant text), so
                    // surface it as markdown under the same header Claude Code
                    // prints in the terminal. Every other tool call is dropped.
                    Some("tool_use")
                        if block.get("name").and_then(|x| x.as_str()) == Some("ExitPlanMode") =>
                    {
                        if let Some(plan) = block
                            .get("input")
                            .and_then(|i| i.get("plan"))
                            .and_then(|p| p.as_str())
                            .map(str::trim)
                            .filter(|p| !p.is_empty())
                        {
                            parts.push(format!("**Here is Claude's plan:**\n\n{plan}"));
                        }
                    }
                    // tool_use / tool_result / thinking blocks are dropped.
                    _ => {}
                }
            }
            parts.join("\n\n")
        }
        _ => return None,
    };
    let cleaned = clean_text(&text);
    if cleaned.is_empty() {
        return None;
    }
    Some(ConvMessage {
        role: typ.to_string(),
        text: cleaned,
    })
}

/// The pane → session/transcript map the hook writes (panes/<paneId>.json),
/// keyed by `ARKADIA_PANE_ID`. This is the unambiguous source even with several
/// Claude sessions in one folder.
#[derive(Deserialize)]
struct PaneMap {
    #[serde(rename = "transcriptPath")]
    transcript_path: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

/// Resolves a pane's transcript from the hook-written map: prefer the exact
/// `transcriptPath`; if it's stale/missing, fall back to a search by session id.
fn transcript_from_pane_map(pane_id: &str) -> Option<PathBuf> {
    let path = dirs::data_local_dir()?
        .join("Arkadia")
        .join("panes")
        .join(format!("{pane_id}.json"));
    let raw = std::fs::read_to_string(&path).ok()?;
    let content = raw.trim_start_matches('\u{feff}');
    let m: PaneMap = serde_json::from_str(content).ok()?;
    if let Some(tp) = m.transcript_path.as_deref().filter(|s| !s.is_empty()) {
        let p = PathBuf::from(tp);
        if p.is_file() {
            return Some(p);
        }
    }
    m.session_id.as_deref().and_then(find_transcript)
}

/// Finds `<session-id>.jsonl` directly under a project dir (depth 2). Sub-agent
/// transcripts live one level deeper, so they're naturally excluded.
fn find_transcript(session_id: &str) -> Option<PathBuf> {
    let root = dirs::home_dir()?.join(".claude").join("projects");
    let fname = format!("{session_id}.jsonl");
    for entry in std::fs::read_dir(&root).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let candidate = p.join(&fname);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Returns the full conversation (user prompts + Claude replies) for a pane,
/// oldest first. Each Claude text block is its own message (so replies split
/// around tool calls read as separate bubbles); only consecutive user turns are
/// merged.
#[tauri::command]
pub fn read_conversation(
    pane_id: String,
    registry: State<'_, Arc<AgentRegistry>>,
) -> Result<Vec<ConvMessage>, String> {
    // Prefer the exact pane → transcript map written by the hook (unambiguous
    // even with several sessions in one folder); fall back to the cwd-keyed
    // registry mapping for sessions that predate the map.
    let path = transcript_from_pane_map(&pane_id)
        .or_else(|| {
            let uuid = Uuid::parse_str(&pane_id).ok()?;
            let session_id = registry.pane_session_id(uuid)?;
            find_transcript(&session_id)
        })
        .ok_or("no Claude conversation found for this pane yet")?;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let mut out: Vec<ConvMessage> = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(m) = extract(&v) {
            // Claude's separate replies in a row (its text split around tool
            // calls) each stay their own bubble, so they read as distinct
            // messages with a gap between them. Only a rare run of consecutive
            // user turns is merged (one blank line) into a single bubble.
            if let Some(last) = out.last_mut() {
                if last.role == m.role && m.role == "user" {
                    last.text.push_str("\n\n");
                    last.text.push_str(&m.text);
                    continue;
                }
            }
            out.push(m);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_injected_tags() {
        let t = clean_text("vrai prompt <system-reminder>bla\nbla</system-reminder> suite");
        assert_eq!(t, "vrai prompt  suite");
    }

    #[test]
    fn user_string_content_is_a_message() {
        let v: Value =
            serde_json::from_str(r#"{"type":"user","message":{"role":"user","content":"salut"}}"#)
                .unwrap();
        assert_eq!(extract(&v).unwrap().text, "salut");
    }

    #[test]
    fn assistant_text_blocks_only() {
        let v: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"voici"},{"type":"tool_use","name":"Bash","input":{}}]}}"#,
        )
        .unwrap();
        assert_eq!(extract(&v).unwrap().text, "voici");
    }

    #[test]
    fn exit_plan_mode_plan_is_surfaced() {
        let v: Value = serde_json::from_str(
            r##"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"J'appelle ExitPlanMode :"},{"type":"tool_use","name":"ExitPlanMode","input":{"plan":"# Plan\n\n1. Step one"}}]}}"##,
        )
        .unwrap();
        let m = extract(&v).unwrap();
        assert_eq!(
            m.text,
            "J'appelle ExitPlanMode :\n\n**Here is Claude's plan:**\n\n# Plan\n\n1. Step one"
        );
    }

    #[test]
    fn other_tool_calls_are_still_dropped() {
        let v: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}"#,
        )
        .unwrap();
        assert!(extract(&v).is_none());
    }

    #[test]
    fn tool_result_only_user_turn_is_skipped() {
        let v: Value = serde_json::from_str(
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"out"}]}}"#,
        )
        .unwrap();
        assert!(extract(&v).is_none());
    }
}
