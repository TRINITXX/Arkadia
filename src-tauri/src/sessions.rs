//! Cross-project index of Claude Code sessions, for the "recent sessions"
//! overlay.
//!
//! Every conversation lives at `~/.claude/projects/<encoded-cwd>/<session>.jsonl`
//! (sub-agents sit one level deeper and are skipped, like everywhere else in the
//! app). For each transcript we surface what the overlay needs to identify it:
//!
//! * `ai-title` — the title Claude Code generates for the session, the same one
//!   `/resume` lists. It is re-appended on every turn, so the LAST occurrence is
//!   the current one and a scan of the file's tail finds it.
//! * `cwd` — the real working directory, in clear, near the top of the file (the
//!   directory NAME is a lossy encoding: `-` stands for `\`, ` ` and `-` alike,
//!   so it can't be decoded back).
//! * the first genuine user prompt, as a title fallback for the sessions that
//!   predate `ai-title`.
//!
//! Sessions with neither a title nor a prompt (hook/daemon runs) and sessions
//! whose folder no longer exists (deleted worktrees — `--resume` couldn't find
//! them anyway) are dropped from the listing.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::conversation::{clean_text, is_injected_user_turn};

/// Bytes scanned at the start of a transcript for `cwd` + the first prompt.
/// Generous on purpose: a session can open with a large pasted block or a hook
/// dump before its first real turn.
const HEAD_SCAN: u64 = 256 * 1024;
/// Bytes scanned at the end for the newest `ai-title` line.
const TAIL_SCAN: u64 = 64 * 1024;
/// Longest title we surface (chars) — the row truncates visually anyway.
const TITLE_CAP: usize = 140;
/// Characters of context kept on each side of a search hit.
const EXCERPT_PAD: usize = 90;
/// Shortest query that triggers the (expensive) content search.
const MIN_QUERY: usize = 2;

/// One session as the overlay lists it.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct SessionEntry {
    /// Claude session id — the file stem, i.e. what `--resume` takes.
    pub id: String,
    /// Absolute transcript path (the reading view parses blocks from it).
    pub path: String,
    /// Directory the session ran in — where a resumed pane must spawn, since
    /// `--resume` only finds a transcript under the *current* cwd's project dir.
    pub cwd: String,
    pub title: String,
    /// True when `title` is the first-prompt fallback, not Claude's `ai-title`
    /// (the row renders those in italics).
    pub from_prompt: bool,
    /// Last write, ms since the epoch — the list's sort key.
    pub mtime: u64,
}

/// A content-search hit: which session, and the text around the match.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct SessionMatch {
    pub id: String,
    pub excerpt: String,
}

/// What we parsed out of one transcript (cached against its size+mtime).
#[derive(Clone, PartialEq, Debug)]
struct Parsed {
    cwd: String,
    title: String,
    from_prompt: bool,
}

struct CacheEntry {
    mtime: u64,
    len: u64,
    /// `None` = parsed and rejected (no title, no prompt, no cwd) — cached so a
    /// re-scan doesn't re-read the same dead file.
    parsed: Option<Parsed>,
}

/// Managed cache transcript path → parse result, keyed by (mtime, len) so an
/// appended-to transcript is re-read and an untouched one costs one `stat`.
#[derive(Default)]
pub struct SessionIndex(Mutex<HashMap<PathBuf, CacheEntry>>);

fn projects_root() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("projects"))
}

/// Every `<project>/<session>.jsonl` (depth 2 exactly — sub-agent transcripts
/// live deeper and never belong in the listing).
fn transcript_paths(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(dirs) = std::fs::read_dir(root) else {
        return out;
    };
    for dir in dirs.flatten() {
        if !dir.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(files) = std::fs::read_dir(dir.path()) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                out.push(p);
            }
        }
    }
    out
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Reads `max` bytes starting at `start`. Short reads are fine — callers only
/// consume whole lines out of the buffer.
fn read_span(path: &Path, start: u64, max: usize) -> Option<Vec<u8>> {
    let mut f = std::fs::File::open(path).ok()?;
    if start > 0 {
        f.seek(SeekFrom::Start(start)).ok()?;
    }
    let mut buf = vec![0u8; max];
    let mut filled = 0;
    while filled < max {
        match f.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(_) => return None,
        }
    }
    buf.truncate(filled);
    Some(buf)
}

/// Complete JSONL lines in `buf`. `partial_head` drops the first fragment (a
/// tail read starts mid-line); the last fragment is always dropped unless the
/// buffer ends on a newline, so callers never parse half a line.
fn complete_lines(buf: &[u8], partial_head: bool) -> impl Iterator<Item = &[u8]> {
    let ends_clean = buf.last() == Some(&b'\n');
    let mut parts: Vec<&[u8]> = buf.split(|&b| b == b'\n').collect();
    if !ends_clean {
        parts.pop();
    }
    let skip = usize::from(partial_head);
    parts
        .into_iter()
        .skip(skip)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .into_iter()
}

/// Newest `ai-title` in the buffer (the value is rewritten every turn, so the
/// last one wins).
fn last_ai_title(buf: &[u8], partial_head: bool) -> Option<String> {
    let mut found: Option<String> = None;
    for line in complete_lines(buf, partial_head) {
        // Cheap reject before the JSON parse: the vast majority of lines are
        // messages, not the tiny `ai-title` records.
        if !contains(line, b"\"ai-title\"") {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("ai-title") {
            continue;
        }
        if let Some(t) = v.get("aiTitle").and_then(Value::as_str) {
            let t = one_line(t);
            if !t.is_empty() {
                found = Some(t);
            }
        }
    }
    found
}

/// The displayable text of a user turn, cleaned of Claude Code's injected tags
/// (`<system-reminder>`, `<command-name>`, …). `None` for tool-result-only or
/// injected turns.
fn user_turn_text(v: &Value) -> Option<String> {
    if v.get("type").and_then(Value::as_str) != Some("user") || is_injected_user_turn(v) {
        return None;
    }
    let content = v.get("message")?.get("content")?;
    let raw = match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    let cleaned = one_line(&clean_text(&raw));
    (!cleaned.is_empty()).then_some(cleaned)
}

/// `cwd` and the first genuine user prompt, from the head of the transcript.
fn head_cwd_and_prompt(buf: &[u8]) -> (Option<String>, Option<String>) {
    let mut cwd = None;
    let mut prompt = None;
    for line in complete_lines(buf, false) {
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if cwd.is_none() {
            if let Some(c) = v
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                cwd = Some(c.to_string());
            }
        }
        if prompt.is_none() {
            prompt = user_turn_text(&v);
        }
        if cwd.is_some() && prompt.is_some() {
            break;
        }
    }
    (cwd, prompt)
}

/// First non-empty line of `s`, trimmed and capped — a title is one line.
fn one_line(s: &str) -> String {
    let line = s
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    truncate_chars(line, TITLE_CAP)
}

fn truncate_chars(s: &str, cap: usize) -> String {
    if s.chars().count() <= cap {
        return s.to_string();
    }
    let head: String = s.chars().take(cap).collect();
    format!("{}…", head.trim_end())
}

fn parse_transcript(path: &Path, len: u64) -> Option<Parsed> {
    let head = read_span(path, 0, HEAD_SCAN.min(len) as usize)?;
    let (cwd, prompt) = head_cwd_and_prompt(&head);
    let cwd = cwd?;
    // The tail holds the freshest ai-title; on a file smaller than the head
    // scan we already hold everything, so no second read.
    let title = if len > HEAD_SCAN {
        read_span(path, len.saturating_sub(TAIL_SCAN), TAIL_SCAN as usize)
            .and_then(|tail| last_ai_title(&tail, true))
            .or_else(|| last_ai_title(&head, false))
    } else {
        last_ai_title(&head, false)
    };
    match title {
        Some(title) => Some(Parsed {
            cwd,
            title,
            from_prompt: false,
        }),
        // No ai-title (pre-feature session): fall back to the opening prompt.
        None => Some(Parsed {
            cwd,
            title: prompt?,
            from_prompt: true,
        }),
    }
}

/// Rebuilds the listing, reusing cached parses for untouched transcripts and
/// dropping cache entries whose file is gone.
fn scan(index: &SessionIndex) -> Vec<SessionEntry> {
    let Some(root) = projects_root() else {
        return Vec::new();
    };
    let paths = transcript_paths(&root);
    let mut cache = match index.0.lock() {
        Ok(c) => c,
        Err(e) => e.into_inner(),
    };
    let mut fresh: HashMap<PathBuf, CacheEntry> = HashMap::with_capacity(paths.len());
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let (mtime, len) = (mtime_ms(&meta), meta.len());
        let parsed = match cache.get(&path) {
            Some(e) if e.mtime == mtime && e.len == len => e.parsed.clone(),
            _ => parse_transcript(&path, len),
        };
        if let Some(p) = &parsed {
            // Re-checked on every scan, never cached: a worktree can be
            // recreated at the same path (and `--resume` would work again).
            if Path::new(&p.cwd).is_dir() {
                out.push(SessionEntry {
                    id: path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or_default()
                        .to_string(),
                    path: path.to_string_lossy().into_owned(),
                    cwd: p.cwd.clone(),
                    title: p.title.clone(),
                    from_prompt: p.from_prompt,
                    mtime,
                });
            }
        }
        fresh.insert(path, CacheEntry { mtime, len, parsed });
    }
    *cache = fresh;
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    out
}

/// Every listable session, newest first.
#[tauri::command(async)]
pub fn list_claude_sessions(index: State<'_, SessionIndex>) -> Vec<SessionEntry> {
    scan(&index)
}

// ─── Content search ─────────────────────────────────────────────────────────

/// ASCII-case-insensitive substring test — `needle` must already be lowercase.
/// Used as the cheap per-line pre-filter before the JSON parse; a case-varying
/// accented letter (É/é) can slip through it, which only costs a missed hit on
/// a line whose prose match would have needed full Unicode folding.
fn contains_ci(hay: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || hay.len() < needle.len() {
        return false;
    }
    hay.windows(needle.len())
        .any(|w| w.eq_ignore_ascii_case(needle))
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.len() >= needle.len() && hay.windows(needle.len()).any(|w| w == needle)
}

/// The text around the first occurrence of `needle` in `text`, padded on both
/// sides and elided with `…`. Char-based, so it never splits a UTF-8 sequence.
fn excerpt_around(text: &str, needle: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let byte_at = lower.find(needle)?;
    // Byte offset → char offset (`to_lowercase` can change byte lengths, so map
    // through the lowercased string and clamp against the original).
    let char_at = lower[..byte_at].chars().count();
    let chars: Vec<char> = text.chars().collect();
    // Lowercasing can change a string's char count (ẞ, İ…), so the offset is
    // only approximate against the original — clamp both ends rather than
    // risk an inverted range.
    let start = char_at.saturating_sub(EXCERPT_PAD).min(chars.len());
    let end = (char_at + needle.chars().count() + EXCERPT_PAD)
        .min(chars.len())
        .max(start);
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(&chars[start.min(chars.len())..end]);
    if end < chars.len() {
        out.push('…');
    }
    Some(out.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Prose of a user/assistant line: what the user typed and what Claude wrote,
/// never tool inputs/outputs (those match on nearly every session and drown the
/// real hits).
fn prose_of(v: &Value) -> Option<String> {
    let typ = v.get("type").and_then(Value::as_str)?;
    if typ != "user" && typ != "assistant" {
        return None;
    }
    if typ == "user" && is_injected_user_turn(v) {
        return None;
    }
    let content = v.get("message")?.get("content")?;
    let raw = match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    let cleaned = clean_text(&raw);
    (!cleaned.is_empty()).then_some(cleaned)
}

/// First prose hit in one transcript, streamed line by line so a 90 MB file
/// never lands in memory at once.
fn prose_hit(path: &Path, needle: &str) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut line: Vec<u8> = Vec::with_capacity(8 * 1024);
    let needle_bytes = needle.as_bytes();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return None,
            Ok(_) => {}
        }
        if !contains_ci(&line, needle_bytes) {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        let Some(text) = prose_of(&v) else { continue };
        if let Some(x) = excerpt_around(&text, needle) {
            return Some(x);
        }
    }
}

/// Sessions whose conversation (prose only) contains `query`, with the matching
/// excerpt. Runs over the same listing the overlay shows, so a session hidden
/// from the list is never surfaced by search either.
#[tauri::command(async)]
pub fn search_claude_sessions(query: String, index: State<'_, SessionIndex>) -> Vec<SessionMatch> {
    search(&index, &query)
}

/// Command body (unit-testable without a Tauri `State`).
fn search(index: &SessionIndex, query: &str) -> Vec<SessionMatch> {
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < MIN_QUERY {
        return Vec::new();
    }
    let entries = scan(index);
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).max(1))
        .unwrap_or(3)
        .min(8);
    let chunk = entries.len().div_ceil(threads).max(1);
    let out: Mutex<Vec<SessionMatch>> = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for part in entries.chunks(chunk) {
            let needle = &needle;
            let out = &out;
            s.spawn(move || {
                let mut local = Vec::new();
                for e in part {
                    if let Some(excerpt) = prose_hit(Path::new(&e.path), needle) {
                        local.push(SessionMatch {
                            id: e.id.clone(),
                            excerpt,
                        });
                    }
                }
                if let Ok(mut o) = out.lock() {
                    o.append(&mut local);
                }
            });
        }
    });
    out.into_inner().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("arkadia-sessions-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
        let p = dir.join(name);
        let mut f = std::fs::File::create(&p).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
        p
    }

    fn user_line(text: &str) -> String {
        format!(
            r#"{{"type":"user","cwd":"{}","message":{{"role":"user","content":"{text}"}}}}"#,
            std::env::temp_dir().to_string_lossy().replace('\\', "\\\\")
        )
    }

    #[test]
    fn prefers_the_last_ai_title_over_the_first_prompt() {
        let dir = tmp_dir();
        let p = write(
            &dir,
            "s.jsonl",
            &[
                &user_line("premier prompt"),
                r#"{"type":"ai-title","aiTitle":"Titre initial"}"#,
                r#"{"type":"ai-title","aiTitle":"Titre final"}"#,
            ],
        );
        let len = std::fs::metadata(&p).unwrap().len();
        let parsed = parse_transcript(&p, len).unwrap();
        assert_eq!(parsed.title, "Titre final");
        assert!(!parsed.from_prompt);
    }

    #[test]
    fn falls_back_to_the_first_genuine_prompt() {
        let dir = tmp_dir();
        let p = write(
            &dir,
            "s.jsonl",
            &[
                r#"{"type":"user","isMeta":true,"cwd":"C:\\nope","message":{"role":"user","content":"contexte injecté"}}"#,
                // `\\n` so the JSON string carries an escaped newline (a raw one
                // would split the line and make it unparsable).
                &user_line("vrai premier prompt\\nsuite ignorée"),
                &user_line("second prompt"),
            ],
        );
        let len = std::fs::metadata(&p).unwrap().len();
        let parsed = parse_transcript(&p, len).unwrap();
        assert_eq!(parsed.title, "vrai premier prompt");
        assert!(parsed.from_prompt);
        // cwd comes from the first line that carries one, injected or not.
        assert_eq!(parsed.cwd, "C:\\nope");
    }

    #[test]
    fn strips_injected_tags_from_the_fallback_title() {
        let dir = tmp_dir();
        let p = write(
            &dir,
            "s.jsonl",
            &[&user_line(
                "<command-name>/grill-me</command-name>ajoute un bouton",
            )],
        );
        let len = std::fs::metadata(&p).unwrap().len();
        assert_eq!(parse_transcript(&p, len).unwrap().title, "ajoute un bouton");
    }

    #[test]
    fn rejects_a_transcript_without_title_or_prompt() {
        let dir = tmp_dir();
        let p = write(
            &dir,
            "s.jsonl",
            &[r#"{"type":"mode","mode":"normal","cwd":"C:\\x"}"#],
        );
        let len = std::fs::metadata(&p).unwrap().len();
        assert!(parse_transcript(&p, len).is_none());
    }

    #[test]
    fn search_matches_prose_and_ignores_tool_payloads() {
        let dir = tmp_dir();
        let tool = write(
            &dir,
            "tool.jsonl",
            &[r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"git worktree list"}}]}}"#],
        );
        let prose = write(
            &dir,
            "prose.jsonl",
            &[r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"le WORKTREE n'apparaît pas dans la liste"}]}}"#],
        );
        assert!(prose_hit(&tool, "worktree").is_none());
        let hit = prose_hit(&prose, "worktree").unwrap();
        assert!(hit.contains("WORKTREE"), "excerpt was {hit}");
    }

    #[test]
    fn search_skips_injected_user_turns() {
        let dir = tmp_dir();
        let p = write(
            &dir,
            "m.jsonl",
            &[
                r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"skill mentionnant worktree"}}"#,
            ],
        );
        assert!(prose_hit(&p, "worktree").is_none());
    }

    /// Manual diagnostic against the real `~/.claude/projects` (machine-
    /// dependent, hence ignored): reports coverage and timing of a full scan.
    /// Run with `cargo test --lib -- --ignored --nocapture scan_real_home`.
    #[test]
    #[ignore]
    fn scan_real_home() {
        let index = SessionIndex::default();
        let t = std::time::Instant::now();
        let first = scan(&index);
        let cold = t.elapsed();
        let t = std::time::Instant::now();
        let second = scan(&index);
        let warm = t.elapsed();
        let root = projects_root().unwrap();
        let total = transcript_paths(&root).len();
        let titled = first.iter().filter(|s| !s.from_prompt).count();
        println!(
            "{} transcripts on disk → {} listed ({titled} with an ai-title, {} from a prompt)",
            total,
            first.len(),
            first.len() - titled
        );
        println!("cold scan {cold:?} · warm scan {warm:?}");
        for s in first.iter().take(5) {
            println!("  {} · {} · {}", s.title, folder_of(&s.cwd), s.id);
        }
        assert_eq!(first.len(), second.len(), "cache changed the listing");
    }

    /// Manual diagnostic: prose search across the real transcripts, cold cache.
    /// `cargo test --release --lib -- --ignored --nocapture search_real_home`.
    #[test]
    #[ignore]
    fn search_real_home() {
        let index = SessionIndex::default();
        for needle in ["worktree", "supabase"] {
            let t = std::time::Instant::now();
            let hits = search(&index, needle);
            println!("{:?} → {} sessions in {:?}", needle, hits.len(), t.elapsed());
            if let Some(h) = hits.first() {
                println!("   e.g. {}", h.excerpt);
            }
        }
        assert!(search(&index, "a").is_empty(), "1-char query must not scan");
    }

    fn folder_of(p: &str) -> String {
        Path::new(p)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| p.to_string())
    }

    #[test]
    fn excerpt_elides_around_the_match() {
        let text = format!("{} cible {}", "a".repeat(200), "b".repeat(200));
        let x = excerpt_around(&text, "cible").unwrap();
        assert!(x.starts_with('…') && x.ends_with('…'));
        assert!(x.contains("cible"));
        assert!(x.chars().count() < text.chars().count());
    }

    #[test]
    fn tail_scan_finds_the_title_of_a_large_transcript() {
        let dir = tmp_dir();
        let filler = user_line(&"x".repeat(400));
        let mut lines: Vec<String> = vec![user_line("premier prompt")];
        // Push the ai-title past HEAD_SCAN so only a tail read can reach it.
        while lines.iter().map(|l| l.len() + 1).sum::<usize>() < (HEAD_SCAN as usize) + 4096 {
            lines.push(filler.clone());
        }
        lines.push(r#"{"type":"ai-title","aiTitle":"Titre en fin de fichier"}"#.to_string());
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let p = write(&dir, "big.jsonl", &refs);
        let len = std::fs::metadata(&p).unwrap().len();
        let parsed = parse_transcript(&p, len).unwrap();
        assert_eq!(parsed.title, "Titre en fin de fichier");
        assert!(!parsed.from_prompt);
    }
}
