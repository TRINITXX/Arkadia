# Arkadia — Claude Detection + Persistent Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live Claude Code state detection (visible badge in sidepanel/tabbar) and persistent sessions with `ccd --resume` auto-restore.

**Architecture:** A filesystem watcher on `~/.claude/projects/*.jsonl` (notify crate) parses Claude session files to derive `Busy/Waiting/Idle` states. An `AgentRegistry` maps pane↔session via OSC 7 cwd. A separate `session.rs` module persists tab/split/cwd/session_id snapshots atomically; restore re-spawns shells and injects `ccd --resume <id>` via stdin after prompt readiness.

**Tech Stack:** Rust (`notify`, `serde`, `tokio`, `tauri 2`), TypeScript/React frontend, existing OSC 7 cwd infrastructure.

---

## File Structure

### New files (Rust backend)

- `src-tauri/src/claude_watcher/mod.rs` — module entry, public API.
- `src-tauri/src/claude_watcher/parse.rs` — parse jsonl entries (pure functions).
- `src-tauri/src/claude_watcher/state.rs` — state machine deriving `AgentState` from events.
- `src-tauri/src/claude_watcher/watcher.rs` — fs watcher + offset tracking.
- `src-tauri/src/agent_registry.rs` — pane↔session mapping + project aggregation.
- `src-tauri/src/session.rs` — persistent session snapshot save/load with atomic writes.

### New files (frontend)

- `src/lib/agentState.ts` — shared types for agent state values.
- `src/components/AgentBadge.tsx` — reusable dot badge component.

### Modified files

- `src-tauri/Cargo.toml` — add `notify`, `tokio` features, `chrono`, `tauri-plugin-notification`.
- `src-tauri/src/lib.rs` — register registry/watcher state, new commands, plugin.
- `src-tauri/src/terminal.rs` — wire OSC 7 → registry, add `spawn_terminal_with_init`.
- `src/App.tsx` — boot restore + 30s save loop + agent listener.
- `src/store.ts` — agent state slice + session restore logic.
- `src/components/Sidepanel.tsx` — show `AgentBadge` per project.
- `src/components/TabBar.tsx` — show `AgentBadge` per tab.
- `src/components/SettingsDialog.tsx` — sessions section.
- `src/lib/paneTree.ts` — serialize/restore helpers.

### Reused infrastructure

- `terminal.rs::OscParser` and `terminal-cwd` event (already emits cwd on OSC 7).
- `terminal.rs::send_input` for stdin injection (used by toolbar).
- `tauri-plugin-store` for preferences toggles only (not session, which uses dedicated atomic file).

---

## Task Sequence

| #   | Task                                      | Depends on |
| --- | ----------------------------------------- | ---------- |
| 0   | Bootstrap (git + deps + module skeleton)  | —          |
| 1   | Parse jsonl entries                       | 0          |
| 2   | Derive AgentState from events             | 1          |
| 3   | Fs watcher with offset tracking           | 1          |
| 4   | AgentRegistry (state + aggregation)       | 2          |
| 5   | Wire OSC 7 → registry                     | 4          |
| 6   | Boot watcher + emit tauri events          | 3, 4, 5    |
| 7   | Frontend store + listener                 | 6          |
| 8   | AgentBadge + Sidepanel integration        | 7          |
| 9   | TabBar badge integration                  | 8          |
| 10  | Session model (serde types)               | —          |
| 11  | Session atomic storage                    | 10         |
| 12  | Tauri session commands                    | 11         |
| 13  | spawn_with_init_command (stdin injection) | —          |
| 14  | Frontend save/restore + Settings UI       | 12, 13     |
| 15  | Notification on Waiting (optional)        | 7          |

---

## Task 0: Bootstrap

**Files:**

- Create: `C:\Users\TRINITX\Desktop\arkadia\.gitignore` (only if missing — check existing first)
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 0.1: Initialize git**

```bash
cd C:/Users/TRINITX/Desktop/arkadia
git init
git add .
git commit -m "chore: snapshot before claude detection + sessions feature"
```

Expected: a single initial commit listing all current files. If `.gitignore` is missing or incomplete, add `target/`, `node_modules/`, `dist/`, `src-tauri/target/`, `crates/terminal-renderer/pkg/` before committing.

- [ ] **Step 0.2: Add Rust dependencies**

Append to `src-tauri/Cargo.toml` `[dependencies]` section:

```toml
notify = "6"
tokio = { version = "1", features = ["fs", "sync", "rt", "rt-multi-thread", "macros", "time"] }
chrono = { version = "0.4", features = ["serde"] }
dirs = "5"
tauri-plugin-notification = "2"
```

- [ ] **Step 0.3: Verify build still works**

Run:

```bash
cd C:/Users/TRINITX/Desktop/arkadia/src-tauri && cargo check
```

Expected: completes without errors (warnings about unused deps are fine).

- [ ] **Step 0.4: Create empty module skeletons**

Create `src-tauri/src/claude_watcher/mod.rs`:

```rust
pub mod parse;
pub mod state;
pub mod watcher;
```

Create empty stubs:

- `src-tauri/src/claude_watcher/parse.rs` (empty)
- `src-tauri/src/claude_watcher/state.rs` (empty)
- `src-tauri/src/claude_watcher/watcher.rs` (empty)
- `src-tauri/src/agent_registry.rs` (empty)
- `src-tauri/src/session.rs` (empty)

Add to `src-tauri/src/lib.rs` top:

```rust
mod agent_registry;
mod claude_watcher;
mod session;
```

- [ ] **Step 0.5: Verify build**

Run: `cd src-tauri && cargo check`
Expected: completes without errors.

- [ ] **Step 0.6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/
git commit -m "chore: scaffold claude_watcher, agent_registry, session modules"
```

---

## Task 1: Parse jsonl entries

**Files:**

- Modify: `src-tauri/src/claude_watcher/parse.rs`

Goal: pure functions that parse a single Claude jsonl line into a domain enum.

- [ ] **Step 1.1: Write the failing tests**

Replace `src-tauri/src/claude_watcher/parse.rs`:

```rust
use serde::Deserialize;

#[derive(Debug, Clone, PartialEq)]
pub enum Entry {
    User,
    AssistantPartial,
    AssistantComplete,
    ToolUse { name: String },
    ToolResult,
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedLine {
    pub entry: Entry,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
struct RawEntry {
    #[serde(rename = "type")]
    kind: Option<String>,
    cwd: Option<String>,
    message: Option<RawMessage>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct RawMessage {
    stop_reason: Option<serde_json::Value>,
}

pub fn parse_line(line: &str) -> Option<ParsedLine> {
    let raw: RawEntry = serde_json::from_str(line).ok()?;
    let entry = match raw.kind.as_deref() {
        Some("user") => Entry::User,
        Some("assistant") => {
            let stop_reason = raw.message.as_ref().and_then(|m| m.stop_reason.as_ref());
            match stop_reason {
                Some(serde_json::Value::Null) | None => Entry::AssistantPartial,
                Some(_) => Entry::AssistantComplete,
            }
        }
        Some("tool_use") => Entry::ToolUse {
            name: raw.name.unwrap_or_default(),
        },
        Some("tool_result") => Entry::ToolResult,
        _ => Entry::Other,
    };
    Some(ParsedLine { entry, cwd: raw.cwd })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_user_entry() {
        let line = r#"{"type":"user","message":{"role":"user","content":"hi"},"cwd":"/tmp"}"#;
        let parsed = parse_line(line).unwrap();
        assert_eq!(parsed.entry, Entry::User);
        assert_eq!(parsed.cwd.as_deref(), Some("/tmp"));
    }

    #[test]
    fn parses_assistant_complete() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn","content":""}}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::AssistantComplete);
    }

    #[test]
    fn parses_assistant_partial_via_null_stop_reason() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","stop_reason":null,"content":""}}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::AssistantPartial);
    }

    #[test]
    fn parses_assistant_partial_via_missing_message() {
        let line = r#"{"type":"assistant"}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::AssistantPartial);
    }

    #[test]
    fn parses_tool_use_with_name() {
        let line = r#"{"type":"tool_use","name":"Edit","id":"abc"}"#;
        match parse_line(line).unwrap().entry {
            Entry::ToolUse { name } => assert_eq!(name, "Edit"),
            other => panic!("expected ToolUse, got {:?}", other),
        }
    }

    #[test]
    fn parses_tool_result() {
        let line = r#"{"type":"tool_result","tool_use_id":"abc"}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::ToolResult);
    }

    #[test]
    fn malformed_json_returns_none() {
        assert!(parse_line("not json at all").is_none());
        assert!(parse_line(r#"{"type":"user"#).is_none()); // truncated
    }

    #[test]
    fn unknown_type_becomes_other() {
        let line = r#"{"type":"summary","content":"..."}"#;
        assert_eq!(parse_line(line).unwrap().entry, Entry::Other);
    }
}
```

- [ ] **Step 1.2: Run tests, verify they pass**

Run: `cd src-tauri && cargo test --lib claude_watcher::parse`
Expected: 8 passed.

- [ ] **Step 1.3: Commit**

```bash
git add src-tauri/src/claude_watcher/parse.rs
git commit -m "feat(watcher): parse Claude jsonl entries"
```

---

## Task 2: Derive AgentState from events

**Files:**

- Modify: `src-tauri/src/claude_watcher/state.rs`

- [ ] **Step 2.1: Write the failing tests + implementation**

Replace `src-tauri/src/claude_watcher/state.rs`:

```rust
use std::time::{Duration, Instant};

use super::parse::Entry;

#[derive(Debug, Clone, PartialEq)]
pub enum AgentState {
    None,
    Idle { session_id: String },
    Busy { tool: Option<String> },
    Waiting { session_id: String },
}

const WAITING_TO_IDLE: Duration = Duration::from_secs(60);
const STREAMING_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const TOOL_BUSY_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct StateMachine {
    session_id: String,
    last_entry: Option<Entry>,
    last_event_at: Instant,
    current: AgentState,
}

impl StateMachine {
    pub fn new(session_id: String, now: Instant) -> Self {
        Self {
            session_id: session_id.clone(),
            last_entry: None,
            last_event_at: now,
            current: AgentState::Idle { session_id },
        }
    }

    pub fn observe(&mut self, entry: Entry, now: Instant) -> AgentState {
        self.last_entry = Some(entry.clone());
        self.last_event_at = now;
        self.current = match entry {
            Entry::User => AgentState::Busy { tool: None },
            Entry::ToolUse { name } => AgentState::Busy { tool: Some(name) },
            Entry::AssistantPartial => AgentState::Busy { tool: None },
            Entry::AssistantComplete => AgentState::Waiting {
                session_id: self.session_id.clone(),
            },
            Entry::ToolResult | Entry::Other => self.current.clone(),
        };
        self.current.clone()
    }

    pub fn tick(&mut self, now: Instant) -> AgentState {
        let elapsed = now.saturating_duration_since(self.last_event_at);
        match (&self.current, &self.last_entry) {
            (AgentState::Busy { .. }, Some(Entry::AssistantPartial))
                if elapsed > STREAMING_BUSY_TIMEOUT =>
            {
                self.current = AgentState::Waiting {
                    session_id: self.session_id.clone(),
                };
            }
            (AgentState::Busy { .. }, Some(Entry::ToolUse { .. }))
                if elapsed > TOOL_BUSY_TIMEOUT =>
            {
                self.current = AgentState::Waiting {
                    session_id: self.session_id.clone(),
                };
            }
            (AgentState::Waiting { .. }, _) if elapsed > WAITING_TO_IDLE => {
                self.current = AgentState::Idle {
                    session_id: self.session_id.clone(),
                };
            }
            _ => {}
        }
        self.current.clone()
    }

    pub fn current(&self) -> &AgentState {
        &self.current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> Instant {
        Instant::now()
    }

    #[test]
    fn user_event_triggers_busy() {
        let mut sm = StateMachine::new("sess1".into(), t0());
        let s = sm.observe(Entry::User, t0());
        assert!(matches!(s, AgentState::Busy { tool: None }));
    }

    #[test]
    fn tool_use_carries_name() {
        let mut sm = StateMachine::new("sess1".into(), t0());
        let s = sm.observe(
            Entry::ToolUse {
                name: "Edit".into(),
            },
            t0(),
        );
        assert!(matches!(s, AgentState::Busy { tool: Some(n) } if n == "Edit"));
    }

    #[test]
    fn assistant_complete_transitions_to_waiting() {
        let mut sm = StateMachine::new("sess1".into(), t0());
        sm.observe(Entry::User, t0());
        let s = sm.observe(Entry::AssistantComplete, t0());
        assert!(matches!(s, AgentState::Waiting { session_id } if session_id == "sess1"));
    }

    #[test]
    fn streaming_assistant_partial_stays_busy_within_timeout() {
        let start = t0();
        let mut sm = StateMachine::new("sess1".into(), start);
        sm.observe(Entry::AssistantPartial, start);
        let s = sm.tick(start + Duration::from_secs(2));
        assert!(matches!(s, AgentState::Busy { .. }));
    }

    #[test]
    fn streaming_assistant_partial_falls_to_waiting_after_5s() {
        let start = t0();
        let mut sm = StateMachine::new("sess1".into(), start);
        sm.observe(Entry::AssistantPartial, start);
        let s = sm.tick(start + Duration::from_secs(6));
        assert!(matches!(s, AgentState::Waiting { .. }));
    }

    #[test]
    fn waiting_falls_to_idle_after_60s() {
        let start = t0();
        let mut sm = StateMachine::new("sess1".into(), start);
        sm.observe(Entry::AssistantComplete, start);
        let s = sm.tick(start + Duration::from_secs(61));
        assert!(matches!(s, AgentState::Idle { .. }));
    }

    #[test]
    fn tool_use_falls_to_waiting_after_30s() {
        let start = t0();
        let mut sm = StateMachine::new("sess1".into(), start);
        sm.observe(
            Entry::ToolUse {
                name: "Bash".into(),
            },
            start,
        );
        let s = sm.tick(start + Duration::from_secs(31));
        assert!(matches!(s, AgentState::Waiting { .. }));
    }

    #[test]
    fn tool_result_does_not_alter_state() {
        let mut sm = StateMachine::new("sess1".into(), t0());
        sm.observe(Entry::User, t0());
        let s = sm.observe(Entry::ToolResult, t0());
        assert!(matches!(s, AgentState::Busy { .. }));
    }
}
```

- [ ] **Step 2.2: Run tests**

Run: `cd src-tauri && cargo test --lib claude_watcher::state`
Expected: 8 passed.

- [ ] **Step 2.3: Commit**

```bash
git add src-tauri/src/claude_watcher/state.rs
git commit -m "feat(watcher): derive AgentState via state machine with timeouts"
```

---

## Task 3: Fs watcher with offset tracking

**Files:**

- Modify: `src-tauri/src/claude_watcher/watcher.rs`
- Modify: `src-tauri/src/claude_watcher/mod.rs`

- [ ] **Step 3.1: Write the watcher module**

Replace `src-tauri/src/claude_watcher/watcher.rs`:

```rust
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::parse::{parse_line, ParsedLine};
use super::state::{AgentState, StateMachine};

#[derive(Debug, Clone)]
pub struct StateUpdate {
    pub session_id: String,
    pub cwd: String,
    pub state: AgentState,
}

pub fn run_watcher(
    root: PathBuf,
    updates: Sender<StateUpdate>,
    shutdown: std::sync::mpsc::Receiver<()>,
) -> notify::Result<()> {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;

    if !root.exists() {
        std::fs::create_dir_all(&root).ok();
    }
    watcher.watch(&root, RecursiveMode::Recursive)?;

    let mut offsets: HashMap<PathBuf, u64> = HashMap::new();
    let mut machines: HashMap<String, (StateMachine, String)> = HashMap::new();
    let tick_interval = Duration::from_millis(250);
    let mut last_tick = Instant::now();

    loop {
        if shutdown.try_recv().is_ok() {
            break;
        }
        match rx.recv_timeout(tick_interval) {
            Ok(Ok(event)) => handle_event(event, &mut offsets, &mut machines, &updates),
            Ok(Err(e)) => eprintln!("[claude_watcher] notify error: {e}"),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if last_tick.elapsed() >= tick_interval {
            tick_all(&mut machines, &updates);
            last_tick = Instant::now();
        }
    }
    Ok(())
}

fn handle_event(
    event: Event,
    offsets: &mut HashMap<PathBuf, u64>,
    machines: &mut HashMap<String, (StateMachine, String)>,
    updates: &Sender<StateUpdate>,
) {
    let interesting = matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    );
    if !interesting {
        return;
    }
    for path in event.paths {
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        if matches!(event.kind, EventKind::Remove(_)) {
            handle_removal(&path, offsets, machines, updates);
            continue;
        }
        process_file(&path, offsets, machines, updates);
    }
}

fn process_file(
    path: &Path,
    offsets: &mut HashMap<PathBuf, u64>,
    machines: &mut HashMap<String, (StateMachine, String)>,
    updates: &Sender<StateUpdate>,
) {
    let session_id = match path.file_stem().and_then(|s| s.to_str()) {
        Some(s) => s.to_string(),
        None => return,
    };
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let last = *offsets.get(path).unwrap_or(&0);
    if file.seek(SeekFrom::Start(last)).is_err() {
        return;
    }
    let mut reader = BufReader::new(file);
    let mut new_offset = last;
    let mut last_parsed: Option<ParsedLine> = None;
    loop {
        let mut line = String::new();
        let read = match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        new_offset += read as u64;
        if let Some(parsed) = parse_line(line.trim()) {
            last_parsed = Some(parsed);
        }
    }
    offsets.insert(path.to_path_buf(), new_offset);

    let parsed = match last_parsed {
        Some(p) => p,
        None => return,
    };
    let cwd = match parsed.cwd.clone() {
        Some(c) => c,
        None => match machines.get(&session_id) {
            Some((_, c)) => c.clone(),
            None => return,
        },
    };
    let now = Instant::now();
    let entry = machines
        .entry(session_id.clone())
        .or_insert_with(|| (StateMachine::new(session_id.clone(), now), cwd.clone()));
    entry.1 = cwd.clone();
    let state = entry.0.observe(parsed.entry, now);
    let _ = updates.send(StateUpdate {
        session_id,
        cwd,
        state,
    });
}

fn handle_removal(
    path: &Path,
    offsets: &mut HashMap<PathBuf, u64>,
    machines: &mut HashMap<String, (StateMachine, String)>,
    updates: &Sender<StateUpdate>,
) {
    offsets.remove(path);
    if let Some(session_id) = path.file_stem().and_then(|s| s.to_str()) {
        if let Some((_, cwd)) = machines.remove(session_id) {
            let _ = updates.send(StateUpdate {
                session_id: session_id.to_string(),
                cwd,
                state: AgentState::None,
            });
        }
    }
}

fn tick_all(
    machines: &mut HashMap<String, (StateMachine, String)>,
    updates: &Sender<StateUpdate>,
) {
    let now = Instant::now();
    for (session_id, (sm, cwd)) in machines.iter_mut() {
        let prev = sm.current().clone();
        let next = sm.tick(now);
        if prev != next {
            let _ = updates.send(StateUpdate {
                session_id: session_id.clone(),
                cwd: cwd.clone(),
                state: next,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::mpsc::channel;
    use std::thread;
    use std::time::Duration;

    fn write_jsonl(dir: &Path, session: &str, lines: &[&str]) -> PathBuf {
        let cwd_dir = dir.join("C--tmp-test");
        std::fs::create_dir_all(&cwd_dir).unwrap();
        let path = cwd_dir.join(format!("{session}.jsonl"));
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
        path
    }

    #[test]
    fn detects_new_session_and_emits_busy_then_waiting() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let (utx, urx) = channel();
        let (_stx, srx) = channel();
        let root_clone = root.clone();
        let handle = thread::spawn(move || run_watcher(root_clone, utx, srx).ok());

        thread::sleep(Duration::from_millis(200));
        write_jsonl(
            &root,
            "abc",
            &[r#"{"type":"user","cwd":"/tmp/test","message":{"role":"user","content":"hi"}}"#],
        );
        let update = urx.recv_timeout(Duration::from_secs(2)).expect("update");
        assert_eq!(update.session_id, "abc");
        assert!(matches!(update.state, AgentState::Busy { .. }));

        write_jsonl(
            &root,
            "abc",
            &[r#"{"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn"}}"#],
        );
        let update = urx.recv_timeout(Duration::from_secs(2)).expect("update");
        assert!(matches!(update.state, AgentState::Waiting { .. }));

        drop(handle);
    }
}
```

- [ ] **Step 3.2: Add tempfile dev-dependency**

Append to `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3.3: Run watcher tests**

Run: `cd src-tauri && cargo test --lib claude_watcher::watcher`
Expected: 1 passed (the integration test).

If test is flaky on a slow Windows runner, increase the `recv_timeout` to 4 s.

- [ ] **Step 3.4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/claude_watcher/watcher.rs
git commit -m "feat(watcher): fs watcher with offset tracking and tick loop"
```

---

## Task 4: AgentRegistry (state + aggregation + cwd mapping)

**Files:**

- Modify: `src-tauri/src/agent_registry.rs`

- [ ] **Step 4.1: Write the registry**

Replace `src-tauri/src/agent_registry.rs`:

```rust
use std::collections::HashMap;

use parking_lot::Mutex;
use serde::Serialize;
use uuid::Uuid;

use crate::claude_watcher::state::AgentState;

#[derive(Debug, Default)]
pub struct AgentRegistry {
    inner: Mutex<RegistryInner>,
}

#[derive(Debug, Default)]
struct RegistryInner {
    pane_cwd: HashMap<Uuid, String>,
    cwd_session: HashMap<String, String>,
    session_state: HashMap<String, AgentState>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentStatePayload {
    None,
    Idle {
        session_id: String,
    },
    Busy {
        tool: Option<String>,
    },
    Waiting {
        session_id: String,
    },
}

impl From<&AgentState> for AgentStatePayload {
    fn from(s: &AgentState) -> Self {
        match s {
            AgentState::None => AgentStatePayload::None,
            AgentState::Idle { session_id } => AgentStatePayload::Idle {
                session_id: session_id.clone(),
            },
            AgentState::Busy { tool } => AgentStatePayload::Busy { tool: tool.clone() },
            AgentState::Waiting { session_id } => AgentStatePayload::Waiting {
                session_id: session_id.clone(),
            },
        }
    }
}

impl AgentRegistry {
    pub fn observe_session(&self, cwd: &str, session_id: &str, state: AgentState) {
        let mut g = self.inner.lock();
        g.cwd_session.insert(cwd.to_string(), session_id.to_string());
        g.session_state.insert(session_id.to_string(), state);
    }

    pub fn observe_pane_cwd(&self, pane_id: Uuid, cwd: String) {
        let mut g = self.inner.lock();
        g.pane_cwd.insert(pane_id, cwd);
    }

    pub fn forget_pane(&self, pane_id: Uuid) {
        let mut g = self.inner.lock();
        g.pane_cwd.remove(&pane_id);
    }

    pub fn pane_state(&self, pane_id: Uuid) -> AgentStatePayload {
        let g = self.inner.lock();
        let cwd = match g.pane_cwd.get(&pane_id) {
            Some(c) => c,
            None => return AgentStatePayload::None,
        };
        let session_id = match g.cwd_session.get(cwd) {
            Some(s) => s,
            None => return AgentStatePayload::None,
        };
        match g.session_state.get(session_id) {
            Some(state) => AgentStatePayload::from(state),
            None => AgentStatePayload::None,
        }
    }

    pub fn pane_session_id(&self, pane_id: Uuid) -> Option<String> {
        let g = self.inner.lock();
        let cwd = g.pane_cwd.get(&pane_id)?;
        g.cwd_session.get(cwd).cloned()
    }

    pub fn project_state(&self, panes: &[Uuid]) -> AgentStatePayload {
        let mut best = AgentStatePayload::None;
        let mut rank = 0u8;
        for p in panes {
            let s = self.pane_state(*p);
            let r = match &s {
                AgentStatePayload::Busy { .. } => 4,
                AgentStatePayload::Waiting { .. } => 3,
                AgentStatePayload::Idle { .. } => 2,
                AgentStatePayload::None => 1,
            };
            if r > rank {
                rank = r;
                best = s;
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pid() -> Uuid {
        Uuid::new_v4()
    }

    #[test]
    fn maps_pane_to_session_via_cwd() {
        let r = AgentRegistry::default();
        let p = pid();
        r.observe_pane_cwd(p, "/tmp/proj".into());
        r.observe_session(
            "/tmp/proj",
            "sess-abc",
            AgentState::Busy {
                tool: Some("Edit".into()),
            },
        );
        match r.pane_state(p) {
            AgentStatePayload::Busy { tool } => assert_eq!(tool.as_deref(), Some("Edit")),
            other => panic!("expected Busy, got {:?}", other),
        }
    }

    #[test]
    fn returns_none_when_no_cwd_match() {
        let r = AgentRegistry::default();
        let p = pid();
        r.observe_pane_cwd(p, "/other".into());
        r.observe_session(
            "/tmp/proj",
            "sess-abc",
            AgentState::Waiting {
                session_id: "sess-abc".into(),
            },
        );
        assert_eq!(r.pane_state(p), AgentStatePayload::None);
    }

    #[test]
    fn project_aggregation_busy_wins() {
        let r = AgentRegistry::default();
        let p1 = pid();
        let p2 = pid();
        r.observe_pane_cwd(p1, "/a".into());
        r.observe_pane_cwd(p2, "/b".into());
        r.observe_session(
            "/a",
            "s1",
            AgentState::Waiting {
                session_id: "s1".into(),
            },
        );
        r.observe_session("/b", "s2", AgentState::Busy { tool: None });
        assert!(matches!(r.project_state(&[p1, p2]), AgentStatePayload::Busy { .. }));
    }

    #[test]
    fn project_aggregation_waiting_over_idle() {
        let r = AgentRegistry::default();
        let p1 = pid();
        let p2 = pid();
        r.observe_pane_cwd(p1, "/a".into());
        r.observe_pane_cwd(p2, "/b".into());
        r.observe_session(
            "/a",
            "s1",
            AgentState::Idle {
                session_id: "s1".into(),
            },
        );
        r.observe_session(
            "/b",
            "s2",
            AgentState::Waiting {
                session_id: "s2".into(),
            },
        );
        assert!(matches!(
            r.project_state(&[p1, p2]),
            AgentStatePayload::Waiting { .. }
        ));
    }

    #[test]
    fn pane_session_id_returns_mapped_session() {
        let r = AgentRegistry::default();
        let p = pid();
        r.observe_pane_cwd(p, "/x".into());
        r.observe_session(
            "/x",
            "sess-x",
            AgentState::Idle {
                session_id: "sess-x".into(),
            },
        );
        assert_eq!(r.pane_session_id(p).as_deref(), Some("sess-x"));
    }
}
```

- [ ] **Step 4.2: Run tests**

Run: `cd src-tauri && cargo test --lib agent_registry`
Expected: 5 passed.

- [ ] **Step 4.3: Commit**

```bash
git add src-tauri/src/agent_registry.rs
git commit -m "feat(registry): pane-session mapping with project aggregation"
```

---

## Task 5: Wire OSC 7 → registry

**Files:**

- Modify: `src-tauri/src/terminal.rs` (around line 297-306, the `parsed.cwds` loop)

- [ ] **Step 5.1: Add registry access to terminal reader thread**

Open `src-tauri/src/terminal.rs`. At the top, add:

```rust
use crate::agent_registry::AgentRegistry;
```

Find the function `spawn_terminal` (the Tauri command). Update its signature to accept registry state. The current handler probably looks like `pub async fn spawn_terminal(...)` with `State<'_, SessionMap>` injected by Tauri. Add a second `State<'_, Arc<AgentRegistry>>` parameter.

**Concrete change** — search for the parameter list of `spawn_terminal` and add the registry State injection. Then in the body, before spawning the reader thread, clone the registry Arc:

```rust
let reader_registry: Arc<AgentRegistry> = registry.inner().clone();
```

In the reader thread (around line 297), update the cwd loop:

```rust
for cwd in parsed.cwds {
    reader_registry.observe_pane_cwd(reader_pane_uuid, cwd.clone());
    let _ = reader_app.emit(
        "terminal-cwd",
        CwdPayload {
            session_id: reader_session_id.clone(),
            cwd,
        },
    );
}
```

**Note**: `reader_pane_uuid` is the pane's UUID. The current code uses `session_id: String`. If pane_id is not yet a Uuid, parse `Uuid::parse_str(&session_id).unwrap_or_default()` — but better, change `session_id` to be a `Uuid` throughout this file. **For this task, just parse on the fly:**

```rust
let reader_pane_uuid = Uuid::parse_str(&reader_session_id).unwrap_or_else(|_| Uuid::nil());
```

Place this clone before `thread::spawn`.

- [ ] **Step 5.2: Hook close_terminal to forget pane**

In `terminal.rs`, find `close_terminal`. After PTY shutdown, add:

```rust
if let Ok(uuid) = Uuid::parse_str(&session_id) {
    registry.forget_pane(uuid);
}
```

The `registry` parameter must also be added to `close_terminal`'s State injection.

- [ ] **Step 5.3: Verify build**

Run: `cd src-tauri && cargo check`
Expected: compiles. Errors here typically mean the `State<'_, Arc<AgentRegistry>>` injection point in `lib.rs` isn't set up yet — that's fine, will be done in Task 6. For now, comment out the registry usage if the build fails, OR proceed to Task 6 to register the state, then come back.

**Pragmatic order:** do Task 6.1 (register the state in lib.rs) before this step compiles. Steps 5.1 and 5.2 may stay unfinished until after 6.1 — see Task 6.

- [ ] **Step 5.4: Commit**

```bash
git add src-tauri/src/terminal.rs
git commit -m "feat(terminal): forward OSC 7 cwd updates to AgentRegistry"
```

---

## Task 6: Boot watcher + emit tauri events

**Files:**

- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 6.1: Register state and start watcher in setup**

Replace `src-tauri/src/lib.rs`:

```rust
mod agent_registry;
mod claude_watcher;
mod fonts;
mod session;
mod terminal;
mod terminal_state;

use std::path::PathBuf;
use std::sync::Arc;

use agent_registry::AgentRegistry;
use claude_watcher::watcher::run_watcher;
use fonts::get_font_data;
use tauri::{AppHandle, Emitter, Manager};
use terminal::{
    close_terminal, resize_terminal, scroll_terminal, search_terminal, send_input,
    send_mouse_event, spawn_terminal, SessionMap,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry: Arc<AgentRegistry> = Arc::new(AgentRegistry::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SessionMap::default())
        .manage(registry.clone())
        .setup({
            let registry = registry.clone();
            move |app| {
                let app_handle = app.handle().clone();
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
            close_terminal,
            scroll_terminal,
            search_terminal,
            send_mouse_event,
            get_font_data,
            agent_state_for_pane,
            agent_state_for_project,
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
```

- [ ] **Step 6.2: Build**

Run: `cd src-tauri && cargo build`
Expected: compiles. If `terminal.rs` changes from Task 5 reference `registry` parameters that don't exist yet, finish Task 5.1 / 5.2 in this task before declaring done.

- [ ] **Step 6.3: Smoke test manually**

Start the app:

```bash
cd C:/Users/TRINITX/Desktop/arkadia && pnpm tauri dev
```

In a pane, run `ccd` (assuming PowerShell alias is set up).
Open DevTools console (Ctrl+Shift+I). You should see no errors.
Inspect logs (run in DevTools console):

```javascript
window.__TAURI__.event.listen("agent-state-changed", (e) =>
  console.log(e.payload),
);
```

Now type a prompt to Claude. You should see `agent-state-changed` events with state `busy` then `waiting`.

- [ ] **Step 6.4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/terminal.rs
git commit -m "feat: boot claude_watcher, register AgentRegistry, emit agent-state-changed"
```

---

## Task 7: Frontend store + listener

**Files:**

- Create: `src/lib/agentState.ts`
- Modify: `src/store.ts`
- Modify: `src/App.tsx`

- [ ] **Step 7.1: Define agent state types**

Create `src/lib/agentState.ts`:

```typescript
export type AgentStateValue =
  | { kind: "none" }
  | { kind: "idle"; session_id: string }
  | { kind: "busy"; tool?: string | null }
  | { kind: "waiting"; session_id: string };

export interface AgentEventPayload {
  session_id: string;
  cwd: string;
  state: AgentStateValue;
}

export function isActive(s: AgentStateValue): boolean {
  return s.kind === "busy" || s.kind === "waiting";
}

export function aggregate(states: AgentStateValue[]): AgentStateValue {
  const order: Record<AgentStateValue["kind"], number> = {
    busy: 4,
    waiting: 3,
    idle: 2,
    none: 1,
  };
  return states.reduce<AgentStateValue>(
    (best, s) => (order[s.kind] > order[best.kind] ? s : best),
    { kind: "none" },
  );
}
```

- [ ] **Step 7.2: Add agent state slice to store**

In `src/store.ts`, near the existing slices, add:

```typescript
import { AgentStateValue, aggregate } from "@/lib/agentState";

interface AgentSlice {
  paneAgentStates: Record<string, AgentStateValue>;
  setPaneAgentState: (paneId: string, state: AgentStateValue) => void;
  paneAgentStateFor: (paneId: string) => AgentStateValue;
  projectAgentStateFor: (paneIds: string[]) => AgentStateValue;
}
```

(Adapt to whatever pattern the existing store uses — Zustand, plain React useState, etc. The key contract: `setPaneAgentState` updates one pane, the read selectors return the live value.)

For a Zustand-style slice:

```typescript
export const useAgentStore = create<AgentSlice>((set, get) => ({
  paneAgentStates: {},
  setPaneAgentState: (paneId, state) =>
    set((s) => ({
      paneAgentStates: { ...s.paneAgentStates, [paneId]: state },
    })),
  paneAgentStateFor: (paneId) =>
    get().paneAgentStates[paneId] ?? { kind: "none" },
  projectAgentStateFor: (paneIds) =>
    aggregate(paneIds.map((p) => get().paneAgentStates[p] ?? { kind: "none" })),
}));
```

If the project uses plain React state, add similar setters/selectors at the App level instead.

- [ ] **Step 7.3: Wire listener in App.tsx**

In `src/App.tsx`, in the boot `useEffect`:

```typescript
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { AgentEventPayload, AgentStateValue } from "@/lib/agentState";
import { useAgentStore } from "@/store";

// inside useEffect
const setPaneAgentState = useAgentStore.getState().setPaneAgentState;

const unlisten = await listen<AgentEventPayload>("agent-state-changed", (e) => {
  const { cwd, state } = e.payload;
  // refresh pane states whose cwd matches
  const panes = panesByCwd(cwd); // helper that returns pane_id[] for a cwd from current pane tree
  panes.forEach((paneId) => setPaneAgentState(paneId, state));
});

// also refresh on cwd change events:
const unlistenCwd = await listen("terminal-cwd", async (e: any) => {
  const paneId = e.payload.session_id;
  const fresh: AgentStateValue = await invoke("agent_state_for_pane", {
    paneId,
  });
  setPaneAgentState(paneId, fresh);
});

return () => {
  unlisten();
  unlistenCwd();
};
```

The `panesByCwd` helper iterates the current `paneTree` and returns IDs of leaves whose `cwd` matches. Define it in `src/lib/paneTree.ts`:

```typescript
export function panesByCwd(tree: PaneTreeNode, cwd: string): string[] {
  if (tree.kind === "leaf") return tree.cwd === cwd ? [tree.id] : [];
  return [...panesByCwd(tree.left, cwd), ...panesByCwd(tree.right, cwd)];
}
```

- [ ] **Step 7.4: Verify build + manual smoke**

Run: `pnpm tauri dev` and verify no TS errors. In DevTools, inspect `window.useAgentStore?.getState().paneAgentStates` — should populate when Claude is running.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/agentState.ts src/store.ts src/App.tsx src/lib/paneTree.ts
git commit -m "feat(frontend): agent state store + tauri event listener"
```

---

## Task 8: AgentBadge + Sidepanel integration

**Files:**

- Create: `src/components/AgentBadge.tsx`
- Modify: `src/components/Sidepanel.tsx`

- [ ] **Step 8.1: Create reusable badge**

Create `src/components/AgentBadge.tsx`:

```tsx
import { AgentStateValue } from "@/lib/agentState";

interface AgentBadgeProps {
  state: AgentStateValue;
  size?: number;
}

export function AgentBadge({ state, size = 8 }: AgentBadgeProps) {
  if (state.kind === "none" || state.kind === "idle") return null;
  const cls =
    state.kind === "busy" ? "bg-amber-500 animate-pulse" : "bg-cyan-500";
  const tooltip =
    state.kind === "busy"
      ? state.tool
        ? `Claude bosse: ${state.tool}…`
        : "Claude bosse…"
      : "Claude attend une réponse";
  return (
    <span
      title={tooltip}
      className={`absolute -top-0.5 -right-0.5 rounded-full ring-1 ring-zinc-900/50 ${cls}`}
      style={{ width: size, height: size }}
    />
  );
}
```

- [ ] **Step 8.2: Add badge to Sidepanel**

In `src/components/Sidepanel.tsx`, locate where each project icon is rendered (look for the map over projects). Wrap the icon with `relative` positioning and add the badge:

```tsx
import { AgentBadge } from './AgentBadge';
import { useAgentStore } from '@/store';

// inside the project map, where icon is rendered:
const projectState = useAgentStore((s) =>
  s.projectAgentStateFor(panesInProject(project, paneTree)),
);

<div className="relative">
  <ProjectIcon ... />
  <AgentBadge state={projectState} size={8} />
</div>
```

The `panesInProject` helper returns the list of pane ids belonging to the given project (across all its tabs). Define it in `src/lib/paneTree.ts`:

```typescript
export function panesInProject(
  project: Project,
  paneTree: ProjectPaneTree,
): string[] {
  const out: string[] = [];
  for (const tab of project.tabs) {
    walk(paneTree[tab.id], (leaf) => out.push(leaf.id));
  }
  return out;
}
function walk(
  node: PaneTreeNode | undefined,
  fn: (leaf: PaneTreeLeaf) => void,
) {
  if (!node) return;
  if (node.kind === "leaf") fn(node);
  else {
    walk(node.left, fn);
    walk(node.right, fn);
  }
}
```

Adapt to actual project/tab/paneTree types.

- [ ] **Step 8.3: Manual smoke**

Run `pnpm tauri dev`. Lance `ccd` in a pane. Sidepanel project icon should show:

- Cyan dot when Claude is waiting for a prompt.
- Amber pulsing dot when Claude is processing.

- [ ] **Step 8.4: Commit**

```bash
git add src/components/AgentBadge.tsx src/components/Sidepanel.tsx src/lib/paneTree.ts
git commit -m "feat(ui): agent badge on sidepanel project icons"
```

---

## Task 9: TabBar badge integration

**Files:**

- Modify: `src/components/TabBar.tsx`

- [ ] **Step 9.1: Add badge per tab**

In `src/components/TabBar.tsx`, in the tab render, add:

```tsx
import { AgentBadge } from "./AgentBadge";
import { useAgentStore } from "@/store";

const tabState = useAgentStore((s) =>
  s.projectAgentStateFor(panesInTab(tab, paneTree)),
);

<div className="relative ...existing classes">
  <span>{title}</span>
  {/* existing close button etc. */}
  <AgentBadge state={tabState} size={6} />
</div>;
```

`panesInTab` helper in `src/lib/paneTree.ts`:

```typescript
export function panesInTab(tab: Tab, paneTree: ProjectPaneTree): string[] {
  const out: string[] = [];
  walk(paneTree[tab.id], (leaf) => out.push(leaf.id));
  return out;
}
```

- [ ] **Step 9.2: Manual smoke**

Open multiple tabs in a project, only one running Claude. Only that tab's dot should be active.

- [ ] **Step 9.3: Commit**

```bash
git add src/components/TabBar.tsx src/lib/paneTree.ts
git commit -m "feat(ui): agent badge per tab in TabBar"
```

---

## Task 10: Session model (serde types)

**Files:**

- Modify: `src-tauri/src/session.rs`

- [ ] **Step 10.1: Define types + roundtrip test**

Replace `src-tauri/src/session.rs`:

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const SESSION_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionFile {
    pub version: u32,
    pub saved_at: String,
    pub active_project_id: Option<Uuid>,
    pub projects: Vec<ProjectSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectSession {
    pub project_id: Uuid,
    pub active_tab_id: Option<Uuid>,
    pub tabs: Vec<TabSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TabSession {
    pub tab_id: Uuid,
    pub title: String,
    pub active_pane_id: Uuid,
    pub pane_tree: PaneTreeSerialized,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PaneTreeSerialized {
    Leaf {
        pane_id: Uuid,
        cwd: String,
        profile_id: String,
        agent_resume: Option<AgentResume>,
    },
    Split {
        orientation: Orientation,
        ratio: f32,
        left: Box<PaneTreeSerialized>,
        right: Box<PaneTreeSerialized>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentResume {
    pub kind: String,
    pub session_id: String,
    pub command: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_complex_session() {
        let s = SessionFile {
            version: SESSION_VERSION,
            saved_at: "2026-04-30T12:00:00Z".into(),
            active_project_id: Some(Uuid::new_v4()),
            projects: vec![ProjectSession {
                project_id: Uuid::new_v4(),
                active_tab_id: Some(Uuid::new_v4()),
                tabs: vec![TabSession {
                    tab_id: Uuid::new_v4(),
                    title: "main".into(),
                    active_pane_id: Uuid::new_v4(),
                    pane_tree: PaneTreeSerialized::Split {
                        orientation: Orientation::Horizontal,
                        ratio: 0.5,
                        left: Box::new(PaneTreeSerialized::Leaf {
                            pane_id: Uuid::new_v4(),
                            cwd: "C:\\Users\\test".into(),
                            profile_id: "pwsh".into(),
                            agent_resume: Some(AgentResume {
                                kind: "claude-code".into(),
                                session_id: "abc-123".into(),
                                command: "ccd --resume".into(),
                            }),
                        }),
                        right: Box::new(PaneTreeSerialized::Leaf {
                            pane_id: Uuid::new_v4(),
                            cwd: "C:\\Users\\test".into(),
                            profile_id: "pwsh".into(),
                            agent_resume: None,
                        }),
                    },
                }],
            }],
        };
        let j = serde_json::to_string(&s).unwrap();
        let back: SessionFile = serde_json::from_str(&j).unwrap();
        assert_eq!(s, back);
    }
}
```

- [ ] **Step 10.2: Run tests**

Run: `cd src-tauri && cargo test --lib session::tests`
Expected: 1 passed.

- [ ] **Step 10.3: Commit**

```bash
git add src-tauri/src/session.rs
git commit -m "feat(session): serde model with PaneTreeSerialized + AgentResume"
```

---

## Task 11: Session atomic storage

**Files:**

- Modify: `src-tauri/src/session.rs`

- [ ] **Step 11.1: Add atomic save/load + recovery**

Append to `src-tauri/src/session.rs`:

```rust
use std::path::{Path, PathBuf};

pub fn save_atomic(file: &Path, session: &SessionFile) -> std::io::Result<()> {
    let tmp = tmp_path(file);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(session)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, file)?;
    Ok(())
}

pub fn load_with_recovery(file: &Path) -> Option<SessionFile> {
    let tmp = tmp_path(file);
    if tmp.exists() && !file.exists() {
        let _ = std::fs::rename(&tmp, file);
    }
    let content = std::fs::read_to_string(file).ok()?;
    let s: SessionFile = serde_json::from_str(&content).ok()?;
    if s.version != SESSION_VERSION {
        return None;
    }
    Some(s)
}

pub fn clear(file: &Path) {
    let _ = std::fs::remove_file(file);
    let _ = std::fs::remove_file(tmp_path(file));
}

fn tmp_path(file: &Path) -> PathBuf {
    let mut s = file.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

#[cfg(test)]
mod storage_tests {
    use super::*;

    fn empty_session() -> SessionFile {
        SessionFile {
            version: SESSION_VERSION,
            saved_at: "2026-04-30T00:00:00Z".into(),
            active_project_id: None,
            projects: vec![],
        }
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        save_atomic(&path, &empty_session()).unwrap();
        let loaded = load_with_recovery(&path).unwrap();
        assert_eq!(loaded.version, SESSION_VERSION);
    }

    #[test]
    fn promotes_tmp_when_main_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        let tmp = tmp_path(&path);
        std::fs::write(&tmp, serde_json::to_string(&empty_session()).unwrap()).unwrap();
        assert!(!path.exists());
        let loaded = load_with_recovery(&path).unwrap();
        assert_eq!(loaded.version, SESSION_VERSION);
        assert!(path.exists());
    }

    #[test]
    fn returns_none_for_old_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        std::fs::write(&path, r#"{"version":0,"saved_at":"x","active_project_id":null,"projects":[]}"#).unwrap();
        assert!(load_with_recovery(&path).is_none());
    }

    #[test]
    fn returns_none_for_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        std::fs::write(&path, "not json").unwrap();
        assert!(load_with_recovery(&path).is_none());
    }
}
```

- [ ] **Step 11.2: Run tests**

Run: `cd src-tauri && cargo test --lib session`
Expected: 5 passed (1 from Task 10 + 4 storage).

- [ ] **Step 11.3: Commit**

```bash
git add src-tauri/src/session.rs
git commit -m "feat(session): atomic save + load with .tmp recovery"
```

---

## Task 12: Tauri session commands

**Files:**

- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 12.1: Add commands**

Append to `src-tauri/src/lib.rs` near the other `#[tauri::command]` definitions:

```rust
use session::{clear as session_clear_fn, load_with_recovery, save_atomic, SessionFile};

fn session_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("session.json")
}

#[tauri::command]
fn session_load(app: AppHandle) -> Option<SessionFile> {
    load_with_recovery(&session_path(&app))
}

#[tauri::command]
fn session_save(app: AppHandle, session: SessionFile) -> Result<(), String> {
    save_atomic(&session_path(&app), &session).map_err(|e| e.to_string())
}

#[tauri::command]
fn session_clear(app: AppHandle) {
    session_clear_fn(&session_path(&app));
}
```

Add the three new commands to `tauri::generate_handler!` list.

- [ ] **Step 12.2: Build + smoke**

Run: `cd src-tauri && cargo build`. Then `pnpm tauri dev`.
In DevTools console:

```javascript
await window.__TAURI__.core.invoke("session_save", {
  session: {
    version: 1,
    saved_at: new Date().toISOString(),
    active_project_id: null,
    projects: [],
  },
});
const back = await window.__TAURI__.core.invoke("session_load");
console.log(back);
```

Expected: prints back the empty session.

- [ ] **Step 12.3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(session): tauri commands session_load/save/clear"
```

---

## Task 13: spawn_with_init_command (stdin injection)

**Files:**

- Modify: `src-tauri/src/terminal.rs`

- [ ] **Step 13.1: Add init command parameter to spawn**

In `terminal.rs`, find the `spawn_terminal` Tauri command. Add an optional parameter `init_command: Option<String>` to its signature. After the PTY is spawned, before returning, schedule the injection:

```rust
if let Some(cmd) = init_command {
    let writer_for_init = writer.clone();
    let term_for_init = term.clone();
    std::thread::spawn(move || {
        // Wait for first prompt: poll the terminal for non-empty cursor row, max 1.5s
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let t = term_for_init.lock();
            // Heuristic: if there is at least one printable cell and cursor is on a fresh line, inject.
            // Concrete check: just wait 800ms minimum then write — PowerShell prompt appears within that.
            drop(t);
        }
        let _ = writer_for_init.lock().write_all(format!("{cmd}\r").as_bytes());
    });
}
```

(Pragmatic approach: simple 800ms delay sleep + write. Avoid OSC 133 detection complexity for v1.)

- [ ] **Step 13.2: Build**

Run: `cd src-tauri && cargo build`.
Expected: compiles. The frontend will pass `init_command: null` until Task 14, so existing behavior is preserved.

- [ ] **Step 13.3: Manual smoke**

In DevTools, after `pnpm tauri dev`:

```javascript
const id = crypto.randomUUID();
await window.__TAURI__.core.invoke("spawn_terminal", {
  sessionId: id,
  cols: 80,
  rows: 24,
  cwd: "C:\\Users\\TRINITX",
  initCommand: "echo HELLO_INIT",
});
```

Expected: a new pane should print `HELLO_INIT` automatically after PowerShell prompt appears.

- [ ] **Step 13.4: Commit**

```bash
git add src-tauri/src/terminal.rs
git commit -m "feat(terminal): support init_command injection after spawn"
```

---

## Task 14: Frontend save/restore + Settings UI

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/store.ts`
- Modify: `src/lib/paneTree.ts`
- Modify: `src/components/SettingsDialog.tsx`

- [ ] **Step 14.1: Serialize/restore helpers**

Add to `src/lib/paneTree.ts`:

```typescript
import type { PaneTreeSerialized } from "@/lib/sessionTypes";

export function serializePaneTree(
  node: PaneTreeNode,
  agentResumes: Record<string, AgentResume>,
): PaneTreeSerialized {
  if (node.kind === "leaf") {
    return {
      kind: "leaf",
      pane_id: node.id,
      cwd: node.cwd,
      profile_id: node.profileId ?? "powershell-7",
      agent_resume: agentResumes[node.id] ?? null,
    };
  }
  return {
    kind: "split",
    orientation: node.orientation,
    ratio: node.ratio,
    left: serializePaneTree(node.left, agentResumes),
    right: serializePaneTree(node.right, agentResumes),
  };
}

export function restorePaneTree(s: PaneTreeSerialized): PaneTreeNode {
  if (s.kind === "leaf") {
    return { kind: "leaf", id: s.pane_id, cwd: s.cwd, profileId: s.profile_id };
  }
  return {
    kind: "split",
    orientation: s.orientation,
    ratio: s.ratio,
    left: restorePaneTree(s.left),
    right: restorePaneTree(s.right),
  };
}
```

Create `src/lib/sessionTypes.ts` mirroring the Rust types:

```typescript
export interface AgentResume {
  kind: string;
  session_id: string;
  command: string;
}
export type PaneTreeSerialized =
  | {
      kind: "leaf";
      pane_id: string;
      cwd: string;
      profile_id: string;
      agent_resume: AgentResume | null;
    }
  | {
      kind: "split";
      orientation: "horizontal" | "vertical";
      ratio: number;
      left: PaneTreeSerialized;
      right: PaneTreeSerialized;
    };
export interface TabSession {
  tab_id: string;
  title: string;
  active_pane_id: string;
  pane_tree: PaneTreeSerialized;
}
export interface ProjectSession {
  project_id: string;
  active_tab_id: string | null;
  tabs: TabSession[];
}
export interface SessionFile {
  version: number;
  saved_at: string;
  active_project_id: string | null;
  projects: ProjectSession[];
}
```

- [ ] **Step 14.2: Restore on boot**

In `src/App.tsx` boot effect, before any default project creation:

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { SessionFile } from "@/lib/sessionTypes";
import { restorePaneTree } from "@/lib/paneTree";

const session: SessionFile | null = await invoke("session_load");
if (session && session.version === 1) {
  for (const p of session.projects) {
    addProject({ id: p.project_id /* ... */ });
    for (const tab of p.tabs) {
      addTabToProject(p.project_id, { id: tab.tab_id, title: tab.title });
      const tree = restorePaneTree(tab.pane_tree);
      setPaneTreeForTab(tab.tab_id, tree);
      // For each leaf, spawn terminal with optional init_command:
      const leaves = collectLeaves(tab.pane_tree);
      for (const leaf of leaves) {
        const initCmd = leaf.agent_resume
          ? `${leaf.agent_resume.command} ${leaf.agent_resume.session_id}`
          : null;
        await invoke("spawn_terminal", {
          sessionId: leaf.pane_id,
          cols: 80,
          rows: 24,
          cwd: leaf.cwd,
          initCommand: initCmd,
        });
      }
    }
  }
  if (session.active_project_id) setActiveProject(session.active_project_id);
}
```

`collectLeaves` helper in `paneTree.ts`:

```typescript
export function collectLeaves(
  s: PaneTreeSerialized,
): Array<Extract<PaneTreeSerialized, { kind: "leaf" }>> {
  if (s.kind === "leaf") return [s];
  return [...collectLeaves(s.left), ...collectLeaves(s.right)];
}
```

- [ ] **Step 14.3: 30s save loop**

In `src/App.tsx`:

```typescript
useEffect(
  () => {
    const interval = setInterval(async () => {
      const session = await buildSessionFile(); // see below
      await invoke("session_save", { session });
    }, 30_000);

    // also save on window unload
    const onUnload = () => {
      invoke("session_save", { session: buildSessionFileSync() });
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
    };
  },
  [
    /* deps including projects, paneTree, agentStates */
  ],
);

async function buildSessionFile(): Promise<SessionFile> {
  const projects = useProjectStore.getState().projects;
  const paneTrees = usePaneTreeStore.getState().byTab;
  const agentStates = useAgentStore.getState().paneAgentStates;
  const sessionMap: Record<string, AgentResume> = {};
  for (const [paneId, st] of Object.entries(agentStates)) {
    if (st.kind === "idle" || st.kind === "waiting") {
      sessionMap[paneId] = {
        kind: "claude-code",
        session_id: st.session_id,
        command: getResumeCommandFromSettings(),
      };
    }
  }
  return {
    version: 1,
    saved_at: new Date().toISOString(),
    active_project_id: useProjectStore.getState().activeId ?? null,
    projects: projects.map((p) => ({
      project_id: p.id,
      active_tab_id: p.activeTabId ?? null,
      tabs: p.tabs.map((tab) => ({
        tab_id: tab.id,
        title: tab.title,
        active_pane_id: tab.activePaneId,
        pane_tree: serializePaneTree(paneTrees[tab.id], sessionMap),
      })),
    })),
  };
}
```

Adapt to the project's actual store shape.

- [ ] **Step 14.4: Settings UI section**

Add to `src/components/SettingsDialog.tsx`:

```tsx
<section>
  <h3>Sessions</h3>
  <label>
    <input type="checkbox" checked={settings.restoreTabs} onChange={...} />
    Restaurer les onglets au démarrage
  </label>
  <label>
    <input type="checkbox" checked={settings.resumeClaude} onChange={...} />
    Reprendre les conversations Claude Code (ccd --resume)
  </label>
  <label>
    Commande resume Claude
    <input value={settings.resumeCommand} onChange={(e) => setSettings({ resumeCommand: e.target.value })} />
  </label>
  <button onClick={() => invoke('session_clear')}>Effacer la session sauvegardée</button>
</section>
```

- [ ] **Step 14.5: Manual smoke test (the big one)**

Test manuel complet :

1. Start `pnpm tauri dev`.
2. Open 2 projects, 1 tab each, type `ccd` in one of them.
3. Send 1-2 messages to Claude.
4. Close Arkadia (window close button).
5. Verify `session.json` exists in `%APPDATA%/com.arkadia.app/` (or wherever app_data resolves) and contains the agent_resume entry.
6. Reopen Arkadia.
7. Both projects/tabs are restored. The Claude pane spawns PowerShell, then ~800ms later types `ccd --resume <id>` and Claude reprend la conversation.

- [ ] **Step 14.6: Commit**

```bash
git add src/App.tsx src/store.ts src/lib/paneTree.ts src/lib/sessionTypes.ts src/components/SettingsDialog.tsx
git commit -m "feat(session): persist tabs/splits/cwd with ccd --resume on restore"
```

---

## Task 15: Notification on Waiting (optional but recommended)

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/components/SettingsDialog.tsx`

- [ ] **Step 15.1: Detect transitions to Waiting and notify**

In `src/App.tsx` listener:

```typescript
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

let prevState: Record<string, AgentStateValue> = {};
const unlistenAgent = await listen<AgentEventPayload>(
  "agent-state-changed",
  async (e) => {
    // existing pane state update...
    if (settings.notifyOnWaiting && document.visibilityState !== "visible") {
      const wasBusy = prevState[e.payload.session_id]?.kind === "busy";
      if (wasBusy && e.payload.state.kind === "waiting") {
        const granted = await isPermissionGranted();
        if (granted) {
          sendNotification({
            title: "Claude attend",
            body: `Une réponse est requise dans <projet>`,
          });
        } else {
          await requestPermission();
        }
      }
    }
    prevState[e.payload.session_id] = e.payload.state;
  },
);
```

- [ ] **Step 15.2: Settings toggle**

```tsx
<label>
  <input type="checkbox" checked={settings.notifyOnWaiting} onChange={...} />
  Notification système quand Claude attend une réponse
</label>
```

- [ ] **Step 15.3: Commit**

```bash
git add src/App.tsx src/components/SettingsDialog.tsx
git commit -m "feat(notification): toast when Claude transitions busy→waiting unfocused"
```

---

## Final verification

After all tasks complete, run end-to-end:

1. Clean build: `pnpm tauri build`. Expected: no errors, MSI generated.
2. Open 3 projects, run `ccd` in 2 of them, leave the third with plain shell.
3. Verify badges: 2 projects show cyan/amber dynamically, third shows nothing.
4. Send prompts to one Claude, watch state transitions live in sidebar (<500ms).
5. Close Arkadia mid-conversation.
6. Reopen: both Claude conversations resume automatically; third project tab restores too.
7. Run `cargo test` in `src-tauri/`: all tests pass.

### Acceptance criteria

- Badge appears within 1s of `ccd` startup.
- Busy→Waiting visible within 500ms.
- 30s save loop never freezes UI (DevTools: main thread blocked < 5ms).
- 5-tab/8-pane restore < 2s.
- `~/.claude/settings.json` is never modified.
- Corrupt `session.json` → app boots empty without crash.
