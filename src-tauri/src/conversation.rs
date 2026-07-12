//! Reads a pane's full conversation from Claude Code's transcript JSONL.
//!
//! The terminal only renders its current viewport, so a "reading view" of the
//! whole conversation can't come from the grid. The complete, ordered history
//! lives in `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (one JSON
//! object per line). We resolve the pane → session via the agent registry,
//! locate that file, and return just the genuine messages (the user's prompts
//! and Claude's prose), filtering out tool calls/results and injected context.

use std::collections::HashMap;
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
    "task-notification",
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

/// `true` when Claude Code flagged this user turn as injected context — skill
/// contents loaded by the Skill tool, image-cache echoes, auto-continue
/// prompts — rather than something the user actually typed. Those turns must
/// not render as user bubbles. (Their `tool_result` blocks, if any, are still
/// processed; in practice tool results never carry the flag.)
fn is_injected_user_turn(v: &Value) -> bool {
    v.get("isMeta").and_then(Value::as_bool).unwrap_or(false)
}

/// Pulls the displayable text out of a transcript line. `None` when the line
/// isn't a user/assistant message or carries no genuine text (e.g. a turn that
/// is only a tool result, or only an injected reminder).
fn extract(v: &Value) -> Option<ConvMessage> {
    let typ = v.get("type")?.as_str()?;
    if typ != "user" && typ != "assistant" {
        return None;
    }
    if typ == "user" && is_injected_user_turn(v) {
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

/// The Claude session id the notify hook recorded for a pane, or None when the
/// pane never ran Claude. The pane-map files survive restarts, so "restore
/// previous session" resolves the `claude --resume` target from the OLD pane id.
#[tauri::command]
pub fn pane_session_id(pane_id: String) -> Option<String> {
    let path = dirs::data_local_dir()?
        .join("Arkadia")
        .join("panes")
        .join(format!("{pane_id}.json"));
    let raw = std::fs::read_to_string(&path).ok()?;
    let m: PaneMap = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;
    m.session_id.filter(|s| !s.is_empty())
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

// ─── Structured blocks (modern view) ──────────────────────────────────────
//
// Unlike `read_conversation` (which keeps only the genuine prose), the modern
// view shows *everything* Claude produced — prose, thinking, and tool calls —
// each as its own typed block so the UI can render and filter them. `tool_use`
// and its later `tool_result` are paired (by `tool_use_id`) into one block.

/// A cap on tool input/output text so a single huge read/output can't bloat the
/// IPC payload; the full content still lives in the terminal/transcript.
const TOOL_TEXT_CAP: usize = 6000;

#[derive(Serialize, Clone)]
pub struct ConvBlock {
    /// "user" | "assistant" | "thinking" | "tool".
    pub kind: String,
    /// Markdown text for user/assistant/thinking blocks (cleaned of injected noise).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Tool name (tool blocks only), e.g. "Bash", "Read", "Edit".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// Compact JSON of the tool input; the UI derives a one-line summary from it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<String>,
    /// The paired tool_result content (text extracted); `None` until it lands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<String>,
}

/// Truncates `s` to `TOOL_TEXT_CAP` chars, appending a marker when cut.
fn cap(s: &str) -> String {
    if s.chars().count() > TOOL_TEXT_CAP {
        let head: String = s.chars().take(TOOL_TEXT_CAP).collect();
        format!("{head}\n… (tronqué)")
    } else {
        s.to_string()
    }
}

/// Extracts displayable text from a `tool_result` `content` (string or array).
fn tool_result_text(content: &Value) -> String {
    match content {
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
                    Some("image") => parts.push("[image]".to_string()),
                    _ => {}
                }
            }
            parts.join("\n")
        }
        _ => String::new(),
    }
}

/// Appends the typed blocks of one transcript line to `out`. `tool_index` maps a
/// `tool_use_id` to the index of its (already-pushed) tool block so a later
/// `tool_result` can fill `tool_output`. When that pairing mutates a block that
/// was already sent to a client, `dirty_floor` drops to its index so the next
/// delta re-sends from there.
fn append_blocks(
    v: &Value,
    out: &mut Vec<ConvBlock>,
    tool_index: &mut HashMap<String, usize>,
    dirty_floor: &mut usize,
) {
    let Some(typ) = v.get("type").and_then(|x| x.as_str()) else {
        return;
    };
    if typ != "user" && typ != "assistant" {
        return;
    }
    let injected = typ == "user" && is_injected_user_turn(v);
    let Some(content) = v.get("message").and_then(|m| m.get("content")) else {
        return;
    };
    match content {
        Value::String(s) => {
            if injected {
                return;
            }
            let cleaned = clean_text(s);
            if !cleaned.is_empty() {
                out.push(ConvBlock {
                    kind: typ.to_string(),
                    text: Some(cleaned),
                    tool_name: None,
                    tool_input: None,
                    tool_output: None,
                });
            }
        }
        Value::Array(arr) => {
            for block in arr {
                match block.get("type").and_then(|x| x.as_str()) {
                    Some("text") if !injected => {
                        if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                            let cleaned = clean_text(t);
                            if !cleaned.is_empty() {
                                out.push(ConvBlock {
                                    kind: typ.to_string(),
                                    text: Some(cleaned),
                                    tool_name: None,
                                    tool_input: None,
                                    tool_output: None,
                                });
                            }
                        }
                    }
                    Some("thinking") => {
                        if let Some(t) = block.get("thinking").and_then(|x| x.as_str()) {
                            let cleaned = clean_text(t);
                            if !cleaned.is_empty() {
                                out.push(ConvBlock {
                                    kind: "thinking".to_string(),
                                    text: Some(cleaned),
                                    tool_name: None,
                                    tool_input: None,
                                    tool_output: None,
                                });
                            }
                        }
                    }
                    Some("tool_use") => {
                        let name = block
                            .get("name")
                            .and_then(|x| x.as_str())
                            .unwrap_or("tool")
                            .to_string();
                        let input = block.get("input").map(|i| cap(&i.to_string()));
                        out.push(ConvBlock {
                            kind: "tool".to_string(),
                            text: None,
                            tool_name: Some(name),
                            tool_input: input,
                            tool_output: None,
                        });
                        if let Some(id) = block.get("id").and_then(|x| x.as_str()) {
                            tool_index.insert(id.to_string(), out.len() - 1);
                        }
                    }
                    Some("tool_result") => {
                        if let Some(id) = block.get("tool_use_id").and_then(|x| x.as_str()) {
                            if let Some(&idx) = tool_index.get(id) {
                                let text = block
                                    .get("content")
                                    .map(tool_result_text)
                                    .unwrap_or_default();
                                out[idx].tool_output = Some(cap(&text));
                                *dirty_floor = (*dirty_floor).min(idx);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

// ─── Incremental block reads (modern view) ──────────────────────

/// Per-pane incremental parse state for `read_conversation_delta`: the typed
/// blocks parsed so far plus the byte offset they cover, so each refresh only
/// reads and parses what the transcript appended since the previous one.
struct ConvCacheEntry {
    path: PathBuf,
    /// Byte offset consumed so far — always sits right after a `\n`, so the
    /// next read starts at a fresh (complete) JSONL line.
    offset: u64,
    /// Bumped on every cache reset (new transcript, truncated file) so a
    /// client holding blocks from the old state knows to drop them.
    generation: u64,
    blocks: Vec<ConvBlock>,
    tool_index: HashMap<String, usize>,
    /// Smallest block index mutated (tool_result pairing) since the last
    /// delta was served; the next delta re-sends from here.
    dirty_floor: usize,
}

impl ConvCacheEntry {
    fn new(path: PathBuf, generation: u64) -> Self {
        Self {
            path,
            offset: 0,
            generation,
            blocks: Vec::new(),
            tool_index: HashMap::new(),
            dirty_floor: 0,
        }
    }
}

/// Managed map pane-id → incremental parse state.
#[derive(Default)]
pub struct ConvCacheMap(std::sync::Mutex<HashMap<String, ConvCacheEntry>>);

/// One incremental response: the client keeps its first `base` blocks and
/// appends `blocks` after them (`base` = 0 replaces everything).
#[derive(Serialize)]
pub struct ConvDelta {
    pub generation: u64,
    pub base: usize,
    pub blocks: Vec<ConvBlock>,
    /// Claude session id of the transcript (the JSONL file stem), so the
    /// frontend can ignore `agent-state-changed` events for other sessions.
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
}

/// Drops a pane's cached parse state (its terminal closed).
pub fn evict_conversation_cache(cache: &ConvCacheMap, pane_id: &str) {
    if let Ok(mut map) = cache.0.lock() {
        map.remove(pane_id);
    }
}

/// Incremental variant of the old full-file read for the modern view: returns
/// every typed block (prose, thinking, tool calls paired with their results),
/// oldest first, but only reads/parses the bytes appended since the last call.
/// `generation`/`have` describe what the client already holds (0/0 = nothing).
#[tauri::command]
pub fn read_conversation_delta(
    pane_id: String,
    generation: u64,
    have: usize,
    cache: State<'_, ConvCacheMap>,
) -> Result<ConvDelta, String> {
    // Only the exact pane→transcript map (written by the hook on this pane's first
    // turn). No cwd-based fallback on purpose: a brand-new Claude tab (or a plain
    // shell) has no map yet, so this returns nothing instead of grabbing a
    // *neighbouring* session's transcript — which would otherwise surface the
    // previous tab's conversation until the new pane sends its first message.
    let path = transcript_from_pane_map(&pane_id)
        .ok_or("no Claude conversation found for this pane yet")?;
    delta_from_path(&cache, &pane_id, path, generation, have)
}

/// Command body, path already resolved (unit-testable without the pane map).
fn delta_from_path(
    cache: &ConvCacheMap,
    pane_id: &str,
    path: PathBuf,
    generation: u64,
    have: usize,
) -> Result<ConvDelta, String> {
    let mut map = cache.0.lock().map_err(|e| e.to_string())?;
    let entry = map
        .entry(pane_id.to_string())
        .or_insert_with(|| ConvCacheEntry::new(path.clone(), 1));
    // New transcript for this pane (fresh session / resume): start over.
    if entry.path != path {
        *entry = ConvCacheEntry::new(path.clone(), entry.generation + 1);
    }
    let file_len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    // Shrunk file = rewritten/truncated transcript: our offset is meaningless.
    if file_len < entry.offset {
        *entry = ConvCacheEntry::new(path.clone(), entry.generation + 1);
    }

    if file_len > entry.offset {
        use std::io::{Read, Seek, SeekFrom};
        let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        f.seek(SeekFrom::Start(entry.offset))
            .map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        // Consume only complete lines; a partially-written trailing line is
        // left for the next refresh (its bytes stay before `offset`).
        let consumed = buf
            .iter()
            .rposition(|&b| b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(0);
        let text = String::from_utf8_lossy(&buf[..consumed]);
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            append_blocks(
                &v,
                &mut entry.blocks,
                &mut entry.tool_index,
                &mut entry.dirty_floor,
            );
        }
        entry.offset += consumed as u64;
    }

    let base = if generation == entry.generation {
        have.min(entry.dirty_floor).min(entry.blocks.len())
    } else {
        0
    };
    let blocks = entry.blocks[base..].to_vec();
    entry.dirty_floor = entry.blocks.len();
    Ok(ConvDelta {
        generation: entry.generation,
        base,
        blocks,
        session_id: path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_jsonl(name: &str, content: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("arkadia-conv-{name}-{}.jsonl", Uuid::new_v4()));
        std::fs::write(&path, content).unwrap();
        path
    }

    const USER_LINE: &str = r#"{"type":"user","message":{"role":"user","content":"salut"}}"#;
    const TOOL_LINE: &str = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#;
    const RESULT_LINE: &str = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#;

    #[test]
    fn delta_appends_only_new_lines() {
        let cache = ConvCacheMap::default();
        let path = tmp_jsonl("append", &format!("{USER_LINE}\n"));

        let d1 = delta_from_path(&cache, "p1", path.clone(), 0, 0).unwrap();
        assert_eq!(d1.base, 0);
        assert_eq!(d1.blocks.len(), 1);

        // Append a tool call; the next delta only carries the new block.
        let mut content = std::fs::read_to_string(&path).unwrap();
        content.push_str(&format!("{TOOL_LINE}\n"));
        std::fs::write(&path, &content).unwrap();

        let d2 = delta_from_path(&cache, "p1", path.clone(), d1.generation, 1).unwrap();
        assert_eq!(d2.generation, d1.generation);
        assert_eq!(d2.base, 1);
        assert_eq!(d2.blocks.len(), 1);
        assert_eq!(d2.blocks[0].kind, "tool");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn delta_resends_mutated_tool_block() {
        let cache = ConvCacheMap::default();
        let path = tmp_jsonl("mutate", &format!("{USER_LINE}\n{TOOL_LINE}\n"));

        let d1 = delta_from_path(&cache, "p1", path.clone(), 0, 0).unwrap();
        assert_eq!(d1.blocks.len(), 2);
        assert!(d1.blocks[1].tool_output.is_none());

        // The tool_result lands later and mutates block #1 (already sent):
        // the delta must re-send from index 1, not just append.
        let mut content = std::fs::read_to_string(&path).unwrap();
        content.push_str(&format!("{RESULT_LINE}\n"));
        std::fs::write(&path, &content).unwrap();

        let d2 = delta_from_path(&cache, "p1", path.clone(), d1.generation, 2).unwrap();
        assert_eq!(d2.base, 1);
        assert_eq!(d2.blocks.len(), 1);
        assert_eq!(d2.blocks[0].tool_output.as_deref(), Some("ok"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn delta_ignores_partial_trailing_line() {
        let cache = ConvCacheMap::default();
        // No trailing \n on the second line: it's still being written.
        let path = tmp_jsonl("partial", &format!("{USER_LINE}\n{}", &TOOL_LINE[..40]));

        let d1 = delta_from_path(&cache, "p1", path.clone(), 0, 0).unwrap();
        assert_eq!(d1.blocks.len(), 1);

        // The writer finishes the line: the whole tool block arrives intact.
        let mut content = format!("{USER_LINE}\n{TOOL_LINE}\n");
        std::fs::write(&path, &mut content).unwrap();
        let d2 = delta_from_path(&cache, "p1", path.clone(), d1.generation, 1).unwrap();
        assert_eq!(d2.base, 1);
        assert_eq!(d2.blocks[0].kind, "tool");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn delta_truncated_file_bumps_generation_and_resends_all() {
        let cache = ConvCacheMap::default();
        let path = tmp_jsonl("trunc", &format!("{USER_LINE}\n{TOOL_LINE}\n"));
        let d1 = delta_from_path(&cache, "p1", path.clone(), 0, 0).unwrap();

        // Rewritten shorter (session restart): generation bumps, full resend.
        std::fs::write(&path, format!("{USER_LINE}\n")).unwrap();
        let d2 = delta_from_path(&cache, "p1", path.clone(), d1.generation, 2).unwrap();
        assert_ne!(d2.generation, d1.generation);
        assert_eq!(d2.base, 0);
        assert_eq!(d2.blocks.len(), 1);
        std::fs::remove_file(&path).ok();
    }

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
    fn task_notification_only_turn_is_not_a_message() {
        // Background-task notifications are injected as plain user turns
        // (no isMeta flag) — the tag strip must make them vanish entirely.
        let v: Value = serde_json::from_str(
            r#"{"type":"user","message":{"role":"user","content":"<task-notification> <task-id>borasn00c</task-id> <output>done</output> </task-notification>"}}"#,
        )
        .unwrap();
        assert!(extract(&v).is_none());

        // Real-world shape: the turn *starts* with the notification and a
        // <system-reminder> follows — both strip, leaving nothing to render.
        let v: Value = serde_json::from_str(
            r#"{"type":"user","message":{"role":"user","content":"<task-notification>\n<task-id>b1</task-id>\n<output>long output here</output>\n</task-notification>\n<system-reminder>\nBackground review feedback\n</system-reminder>"}}"#,
        )
        .unwrap();
        assert!(extract(&v).is_none());
    }

    #[test]
    fn meta_user_turn_is_not_a_message() {
        // Skill contents injected by the Skill tool arrive as a user turn with
        // isMeta: true — they must not render as a user bubble.
        let v: Value = serde_json::from_str(
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Base directory for this skill: C:\\skills\\brainstorming"}}"#,
        )
        .unwrap();
        assert!(extract(&v).is_none());
    }

    #[test]
    fn blocks_skip_meta_user_turns() {
        let mut out = Vec::new();
        let mut idx = HashMap::new();
        let string_form: Value = serde_json::from_str(
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Base directory for this skill: X"}}"#,
        )
        .unwrap();
        let array_form: Value = serde_json::from_str(
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":[{"type":"text","text":"[Image: source: cache/2.png]"}]}}"#,
        )
        .unwrap();
        append_blocks(&string_form, &mut out, &mut idx, &mut 0);
        append_blocks(&array_form, &mut out, &mut idx, &mut 0);
        assert!(out.is_empty());
    }

    #[test]
    fn tool_result_only_user_turn_is_skipped() {
        let v: Value = serde_json::from_str(
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"out"}]}}"#,
        )
        .unwrap();
        assert!(extract(&v).is_none());
    }

    #[test]
    fn blocks_pair_tool_use_with_its_result() {
        let mut out = Vec::new();
        let mut idx = HashMap::new();
        let call: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#,
        )
        .unwrap();
        let result: Value = serde_json::from_str(
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"file.txt"}]}}"#,
        )
        .unwrap();
        append_blocks(&call, &mut out, &mut idx, &mut 0);
        append_blocks(&result, &mut out, &mut idx, &mut 0);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "tool");
        assert_eq!(out[0].tool_name.as_deref(), Some("Bash"));
        assert_eq!(out[0].tool_output.as_deref(), Some("file.txt"));
    }

    #[test]
    fn blocks_keep_thinking_and_text_in_order() {
        let mut out = Vec::new();
        let mut idx = HashMap::new();
        let v: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"hi"}]}}"#,
        )
        .unwrap();
        append_blocks(&v, &mut out, &mut idx, &mut 0);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].kind, "thinking");
        assert_eq!(out[0].text.as_deref(), Some("hmm"));
        assert_eq!(out[1].kind, "assistant");
        assert_eq!(out[1].text.as_deref(), Some("hi"));
    }

    #[test]
    fn blocks_extract_array_tool_result_text() {
        let v: Value = serde_json::from_str(
            r#"[{"type":"text","text":"line one"},{"type":"image"},{"type":"text","text":"line two"}]"#,
        )
        .unwrap();
        assert_eq!(tool_result_text(&v), "line one\n[image]\nline two");
    }
}
