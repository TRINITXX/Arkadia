# Arkadia ⇄ Worktree Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/w` skill add its new git worktree to Arkadia as a live project (switched-to, with `ccd` auto-running in its terminal), and make the `/m` skill remove that Arkadia project and finish worktree cleanup after its terminal is closed.

**Architecture:** Arkadia gains an *external-action* entry point: the `single-instance` plugin callback (already registered, release-only) parses a small argv vocabulary (`--wt-add`, `--wt-remove`, `--wt-notify`) and emits a Tauri event `external-action` to the main webview. A React listener reuses the existing live `onAddProject` / `onDeleteProject` code paths (the same ones the "new project" button uses), spawns the project's terminal with the backend's already-present `init_command`, runs the deferred worktree-folder removal via a new detached-process Rust command, and shows toasts. The `/w` and `/m` skills invoke the running Arkadia binary with these flags.

**Tech Stack:** Tauri 2, Rust (`tauri`, `tauri-plugin-single-instance`, `portable-pty`), React 18 + TypeScript, Vite, Vitest, `@tauri-apps/api`. Skills are Markdown in `~/.claude/skills/`.

## Global Constraints

- **Arkadia bundle identifier:** `com.trinitx.arkadia` (single-instance key). Any build with this identifier forwards argv to the one running instance.
- **single-instance is release-only** (`#[cfg(not(debug_assertions))]`, `src-tauri/src/lib.rs:37-48`). The feature therefore works only in a **built/installed** Arkadia, never under `pnpm tauri dev`. Confirmed acceptable: the user always runs the release app.
- **Activation requires a rebuild + reinstall + restart** of Arkadia (Rust + bundled frontend). A restart kills all running `ccd` sessions.
- **Windows only.** Terminal shell is `pwsh.exe` (`terminal.rs:315`), launched **with** the user profile (no `-NoProfile`) → the `ccd` PowerShell function is defined in spawned terminals.
- **Do not run `npm install` in worktrees** — their `node_modules` is a shared junction (see the `/w` skill).
- **Never touch git `master`** in any skill flow. `/m` merges into the recorded origin branch only.
- **`Project` schema is fixed** (`src/types.ts:95-110`): `{ id, name, path, color, order, workspaceId?, rootOrder? }`. `normalizeProject` (`src/store.ts:261-275`) strips unknown fields on load — do **not** add new persisted project fields.
- **Argv vocabulary (exact):**
  - `arkadia.exe --wt-add --path "<abs>" --name "<name>" --color "<#hex>" --run "ccd"`
  - `arkadia.exe --wt-remove --path "<abs>" --after "<pwsh command>"`
  - `arkadia.exe --wt-notify --level "<info|error>" --message "<text>"`
  All values are single strings; paths are absolute Windows paths.

---

## File Structure

**Arkadia — Rust (`src-tauri/src/`):**
- `external_action.rs` — **new**. Pure argv parser `parse_external_action(argv) -> Option<ExternalAction>` + the `ExternalAction` payload struct. Unit-tested.
- `lib.rs` — **modify**. Wire the parser into the single-instance callback and emit `external-action`; register a new `run_detached` command.
- `terminal.rs` — **no change** (`spawn_terminal` already accepts `init_command`, `terminal.rs:301,467-477`).

**Arkadia — React (`src/`):**
- `App.tsx` — **modify**. `spawnPane`/`spawnTabFor` gain an optional `initCommand`; add the `external-action` listener + `onExternalAdd` / `onExternalRemove` handlers; mount the toaster; add `run_detached` invoke on removal.
- `lib/externalAction.ts` — **new**. Pure helpers: resolve a project by path, derive the ccd tab spawn, build nothing git-related (git stays in the skills). Unit-tested.
- `components/Toaster.tsx` — **new**. Minimal toast stack driven by a `pushToast` callback + the notify event. 
- `types.ts` — **modify**. Add `ExternalAction` and `Toast` TS types (non-persisted).

**Skills (`~/.claude/skills/`):**
- `w/SKILL.md` — **modify**. After junction step, best-effort call `arkadia.exe --wt-add …`.
- `m/SKILL.md` — **modify**. Case B (worktree origin): after in-place merge/junction/branch-delete, call `arkadia.exe --wt-remove … --after "<retry remove + notify>"`.

---

## Task 1: Rust argv parser (`external_action.rs`)

**Files:**
- Create: `src-tauri/src/external_action.rs`
- Modify: `src-tauri/src/lib.rs:6-8` (add `mod external_action;`)
- Test: inline `#[cfg(test)]` in `external_action.rs`

**Interfaces:**
- Produces: `pub struct ExternalAction { pub kind: String, pub path: Option<String>, pub name: Option<String>, pub color: Option<String>, pub run: Option<String>, pub after: Option<String>, pub level: Option<String>, pub message: Option<String> }` (derives `serde::Serialize, Clone, Debug, PartialEq`).
- Produces: `pub fn parse_external_action(argv: &[String]) -> Option<ExternalAction>` — returns `Some` only when argv contains one of `--wt-add` / `--wt-remove` / `--wt-notify`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/external_action.rs`:

```rust
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ExternalAction {
    pub kind: String,
    pub path: Option<String>,
    pub name: Option<String>,
    pub color: Option<String>,
    pub run: Option<String>,
    pub after: Option<String>,
    pub level: Option<String>,
    pub message: Option<String>,
}

// (implementation added in Step 3)

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_wt_add_with_all_flags() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe", "--wt-add",
            "--path", "C:\\wt\\vtc-mobile-side",
            "--name", "vtc-mobile-side",
            "--color", "#ee9b00",
            "--run", "ccd",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "add");
        assert_eq!(a.path.as_deref(), Some("C:\\wt\\vtc-mobile-side"));
        assert_eq!(a.name.as_deref(), Some("vtc-mobile-side"));
        assert_eq!(a.color.as_deref(), Some("#ee9b00"));
        assert_eq!(a.run.as_deref(), Some("ccd"));
    }

    #[test]
    fn parses_wt_remove_with_after() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe", "--wt-remove",
            "--path", "C:\\wt\\x",
            "--after", "git worktree remove --force C:\\wt\\x",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "remove");
        assert_eq!(a.after.as_deref(), Some("git worktree remove --force C:\\wt\\x"));
    }

    #[test]
    fn parses_wt_notify() {
        let a = parse_external_action(&argv(&[
            "arkadia.exe", "--wt-notify", "--level", "info", "--message", "done",
        ]))
        .expect("should parse");
        assert_eq!(a.kind, "notify");
        assert_eq!(a.level.as_deref(), Some("info"));
        assert_eq!(a.message.as_deref(), Some("done"));
    }

    #[test]
    fn returns_none_without_action_flag() {
        assert!(parse_external_action(&argv(&["arkadia.exe"])).is_none());
        assert!(parse_external_action(&argv(&["arkadia.exe", "--focus"])).is_none());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test external_action`
Expected: FAIL — `cannot find function parse_external_action`.

- [ ] **Step 3: Write minimal implementation**

Insert above the `#[cfg(test)]` block:

```rust
/// Reads the value following `flag` in `argv` (e.g. `--path C:\x` → `Some("C:\\x")`).
fn value_after(argv: &[String], flag: &str) -> Option<String> {
    argv.iter().position(|a| a == flag).and_then(|i| argv.get(i + 1)).cloned()
}

/// Parses Arkadia's external-action argv vocabulary. Returns `None` when no
/// `--wt-*` action flag is present (i.e. an ordinary launch / focus forward).
pub fn parse_external_action(argv: &[String]) -> Option<ExternalAction> {
    let kind = if argv.iter().any(|a| a == "--wt-add") {
        "add"
    } else if argv.iter().any(|a| a == "--wt-remove") {
        "remove"
    } else if argv.iter().any(|a| a == "--wt-notify") {
        "notify"
    } else {
        return None;
    };
    Some(ExternalAction {
        kind: kind.to_string(),
        path: value_after(argv, "--path"),
        name: value_after(argv, "--name"),
        color: value_after(argv, "--color"),
        run: value_after(argv, "--run"),
        after: value_after(argv, "--after"),
        level: value_after(argv, "--level"),
        message: value_after(argv, "--message"),
    })
}
```

Add to `src-tauri/src/lib.rs` after line 7 (`mod terminal;`):

```rust
mod external_action;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test external_action`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/external_action.rs src-tauri/src/lib.rs
git commit -m "feat(external-action): parse --wt-add/--wt-remove/--wt-notify argv"
```

---

## Task 2: `run_detached` Rust command

**Files:**
- Modify: `src-tauri/src/lib.rs` (add command + register it)
- Test: inline `#[cfg(test)]` in `lib.rs` (spawn a no-op and assert Ok)

**Interfaces:**
- Produces: `#[tauri::command] fn run_detached(command: String, cwd: String) -> Result<(), String>` — spawns `pwsh.exe -NoProfile -Command <command>` detached (survives the caller's terminal being closed), returns immediately.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/lib.rs`:

```rust
#[test]
fn run_detached_spawns_without_error() {
    // A trivial command that exits immediately.
    let cwd = std::env::temp_dir().to_string_lossy().to_string();
    assert!(run_detached("exit 0".to_string(), cwd).is_ok());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test run_detached_spawns_without_error`
Expected: FAIL — `cannot find function run_detached`.

- [ ] **Step 3: Write minimal implementation**

Add near `open_path` in `src-tauri/src/lib.rs`:

```rust
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
        // DETACHED_PROCESS (0x8) | CREATE_NEW_PROCESS_GROUP (0x200): fully
        // independent of the caller's console so a closed PTY can't kill it.
        c.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}
```

Register it: add `run_detached,` inside `tauri::generate_handler![ … ]` in `lib.rs` (after `open_path,`, line 132).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test run_detached_spawns_without_error`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(terminal): add run_detached command for deferred worktree cleanup"
```

---

## Task 3: Emit `external-action` from single-instance callback

**Files:**
- Modify: `src-tauri/src/lib.rs:37-48` (single-instance block)

**Interfaces:**
- Consumes: `parse_external_action` (Task 1), `tauri::Emitter` (already imported, `lib.rs:17`).
- Produces: runtime event `"external-action"` with an `ExternalAction` payload, delivered to the `main` webview.

> Not unit-testable (needs a running Tauri app + second process). Verified manually in Task 8. This task is a focused edit with a compile check.

- [ ] **Step 1: Replace the single-instance callback body**

In `src-tauri/src/lib.rs`, replace lines 39-47 (the `plugin(tauri_plugin_single_instance::init(...))` closure) with:

```rust
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: builds (release single-instance path compiles; a `cargo build` in debug won't compile this block because of `#[cfg(not(debug_assertions))]`, so run `cargo build --release` to actually type-check it).

Run: `cd src-tauri && cargo build --release`
Expected: builds with no errors referencing `external_action` / `emit`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(external-action): forward --wt-* argv to frontend via event"
```

---

## Task 4: Frontend types + pure helpers (`lib/externalAction.ts`)

**Files:**
- Modify: `src/types.ts` (add `ExternalAction`, `Toast`)
- Create: `src/lib/externalAction.ts`
- Test: `src/lib/externalAction.test.ts`

**Interfaces:**
- Produces (types): 
  ```ts
  export interface ExternalAction { kind: "add" | "remove" | "notify"; path?: string; name?: string; color?: string; run?: string; after?: string; level?: "info" | "error"; message?: string; }
  export interface Toast { id: string; level: "info" | "error"; message: string; }
  ```
- Produces: `export function findProjectByPath(projects: Project[], path: string): Project | undefined` — case-insensitive, separator-insensitive path match (Windows).
- Produces: `export function parentOf(projects: Project[], worktreePath: string): Project | undefined` — the project whose `path` is the parent repo of a `vtc-mobile-<n>`-style sibling; used to inherit `color`/`workspaceId`. Matches the sibling whose path shares the worktree's parent directory and is the longest existing project path prefix sibling; if none, returns `undefined`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/externalAction.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findProjectByPath, parentOf } from "./externalAction";
import type { Project } from "../types";

const p = (id: string, name: string, path: string, extra: Partial<Project> = {}): Project => ({
  id, name, path, color: "#fff", order: 0, ...extra,
});

describe("findProjectByPath", () => {
  const projects = [p("a", "Main", "C:\\Users\\T\\VTC-Planner\\VTC-Planner-Mobile")];
  it("matches ignoring case and separators", () => {
    expect(findProjectByPath(projects, "c:/users/t/vtc-planner/vtc-planner-mobile")?.id).toBe("a");
  });
  it("returns undefined when absent", () => {
    expect(findProjectByPath(projects, "C:\\other")).toBeUndefined();
  });
});

describe("parentOf", () => {
  const main = p("m", "vtc-mobile-prod", "C:\\VTC\\vtc-mobile-prod", { color: "#ee9b00", workspaceId: "ws-1" });
  const projects = [main];
  it("finds the sibling repo sharing the parent dir", () => {
    const parent = parentOf(projects, "C:\\VTC\\vtc-mobile-side");
    expect(parent?.id).toBe("m");
  });
  it("returns undefined with no sibling", () => {
    expect(parentOf([], "C:\\VTC\\vtc-mobile-side")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/externalAction.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement**

Add to `src/types.ts` (end of file):

```ts
export interface ExternalAction {
  kind: "add" | "remove" | "notify";
  path?: string;
  name?: string;
  color?: string;
  run?: string;
  after?: string;
  level?: "info" | "error";
  message?: string;
}

export interface Toast {
  id: string;
  level: "info" | "error";
  message: string;
}
```

Create `src/lib/externalAction.ts`:

```ts
import type { Project } from "../types";

/** Normalise a Windows path for comparison: lowercase, forward slashes, no trailing sep. */
function norm(pathStr: string): string {
  return pathStr.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function findProjectByPath(projects: Project[], path: string): Project | undefined {
  const target = norm(path);
  return projects.find((p) => norm(p.path) === target);
}

/** The existing project that is a sibling of `worktreePath` (same parent dir).
 *  Used to inherit color/workspace so worktrees cluster under their repo. */
export function parentOf(projects: Project[], worktreePath: string): Project | undefined {
  const parentDir = norm(worktreePath).split("/").slice(0, -1).join("/");
  return projects
    .filter((p) => norm(p.path).split("/").slice(0, -1).join("/") === parentDir)
    .sort((a, b) => b.path.length - a.path.length)[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/externalAction.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lib/externalAction.ts src/lib/externalAction.test.ts
git commit -m "feat(external-action): add path-matching helpers and types"
```

---

## Task 5: `initCommand` passthrough in spawn

**Files:**
- Modify: `src/App.tsx:441-457` (`spawnPane`), `src/App.tsx:459-485` (`spawnTabFor`)

**Interfaces:**
- Consumes: `invoke("spawn_terminal", { cwd, cols, rows, init_command })` (backend already accepts `init_command`, `terminal.rs:301`).
- Produces: `spawnPane(cwd: string, initCommand?: string)` and `spawnTabFor(project: Project, initCommand?: string)`.

> The invoke argument name must be snake_case `init_command` (Tauri maps it to the Rust `init_command` param).

- [ ] **Step 1: Modify `spawnPane`**

Replace `src/App.tsx:441-457` with:

```tsx
  const spawnPane = useCallback(
    async (cwd: string, initCommand?: string): Promise<string | null> => {
      const { cols, rows } = measureSpawnSize();
      try {
        const sessionId = await invoke<string>("spawn_terminal", {
          cwd,
          cols,
          rows,
          init_command: initCommand,
        });
        return sessionId;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [measureSpawnSize],
  );
```

- [ ] **Step 2: Modify `spawnTabFor`**

In `src/App.tsx:459-463`, change the signature and the `spawnPane` call:

```tsx
  const spawnTabFor = useCallback(
    async (
      project: Project,
      initCommand?: string,
    ): Promise<{ tabId: string; paneId: string } | null> => {
      const paneId = await spawnPane(project.path, initCommand);
```

(leave the rest of the function unchanged).

- [ ] **Step 3: Verify build + existing tests**

Run: `pnpm build:renderer:dev && pnpm tsc --noEmit`
Expected: no type errors. (`initCommand` is optional, so all existing call sites still compile.)

Run: `pnpm vitest run`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(terminal): thread optional initCommand through spawnPane/spawnTabFor"
```

---

## Task 6: Toaster component

**Files:**
- Create: `src/components/Toaster.tsx`
- Test: `src/components/Toaster.test.tsx`

**Interfaces:**
- Produces: `export function useToasts(): { toasts: Toast[]; pushToast: (level: "info" | "error", message: string) => void }` and `export function Toaster({ toasts }: { toasts: Toast[] }): JSX.Element`.
- Consumes: `Toast` type (Task 4).

- [ ] **Step 1: Write the failing test**

Create `src/components/Toaster.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToasts } from "./Toaster";

describe("useToasts", () => {
  it("adds a toast with a unique id and level", () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.pushToast("info", "hello"));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("hello");
    expect(result.current.toasts[0].level).toBe("info");
    expect(result.current.toasts[0].id).toBeTruthy();
  });
});
```

> If `@testing-library/react` is not a dev dependency yet, add it: `pnpm add -D @testing-library/react @testing-library/dom`. Check `package.json` first; only add if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/Toaster.test.tsx`
Expected: FAIL — module/hook not found.

- [ ] **Step 3: Implement**

Create `src/components/Toaster.tsx`:

```tsx
import { useCallback, useState } from "react";
import type { Toast } from "../types";

let toastSeq = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((level: "info" | "error", message: string) => {
    const id = `toast-${++toastSeq}`;
    setToasts((prev) => [...prev, { id, level, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, level === "error" ? 8000 : 5000);
  }, []);
  return { toasts, pushToast };
}

export function Toaster({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            color: "#fff",
            background: t.level === "error" ? "#b00020" : "#1f2937",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            maxWidth: 420,
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
```

> `setTimeout`/`window` usage: keep the hook test focused on `pushToast` adding the toast (Step 1) — do not assert on the auto-dismiss timer in the unit test.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/Toaster.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Toaster.tsx src/components/Toaster.test.tsx package.json
git commit -m "feat(ui): add minimal toaster for external-action feedback"
```

---

## Task 7: Wire the `external-action` listener in `App.tsx`

**Files:**
- Modify: `src/App.tsx` (imports; mount `useToasts` + `<Toaster/>`; add the listener effect)

**Interfaces:**
- Consumes: `listen` (already imported `App.tsx:3`), `ExternalAction` + helpers (Tasks 4), `useToasts`/`Toaster` (Task 6), `onAddProject`/`onDeleteProject`/`spawnTabFor`/`setActiveProjectId`/`projects` (existing `App.tsx`), `invoke("run_detached", …)` (Task 2).
- Behaviour:
  - `kind:"add"` → build project `{ id: newProjectId(), name, path, color: color||parent.color, order: projects.length, workspaceId: parent?.workspaceId ?? null }`, `setProjects([...prev, project])`, `setActiveProjectId(project.id)`, then `spawnTabFor(project, run)` so the auto-spawn effect (`App.tsx:761-778`) sees a tab and does **not** create a blank one. Toast `info` "➕ <name> ajouté".
  - `kind:"remove"` → `findProjectByPath`; if found, `onDeleteProject(id)` (closes its terminals), then if `after` present `invoke("run_detached", { command: after, cwd: <parent repo path or home> })`. Toast `info` "➖ <name> retiré — nettoyage worktree en cours".
  - `kind:"notify"` → `pushToast(level||"info", message)`.

> **Race note:** `onAddProject` is *not* reused directly for `add` because it can't set `workspaceId`/inherit color and it doesn't spawn the ccd tab. The handler builds the project inline, then **awaits `spawnTabFor` before `setActiveProjectId`** — so by the time the project becomes active, its ccd tab already exists and the blank-tab auto-spawn effect (`App.tsx:763-778`) skips. Reversing this order yields a spurious blank second tab.

- [ ] **Step 1: Add imports** (top of `src/App.tsx`)

```tsx
import { Toaster, useToasts } from "./components/Toaster";
import { findProjectByPath, parentOf } from "./lib/externalAction";
import type { ExternalAction } from "./types";
```

- [ ] **Step 2: Mount toasts** — inside the `App` component, near the other `useState`s:

```tsx
  const { toasts, pushToast } = useToasts();
```

And render the toaster once, just before the component's closing root tag (near where the top-level JSX returns — add `<Toaster toasts={toasts} />` as a sibling of the main layout div).

- [ ] **Step 3: Add the listener effect** — after the existing project handlers (e.g. after `onChangeColor`, ~`App.tsx:906`):

```tsx
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<ExternalAction>("external-action", async (event) => {
      const a = event.payload;
      if (a.kind === "notify") {
        pushToast(a.level ?? "info", a.message ?? "");
        return;
      }
      if (a.kind === "add" && a.path && a.name) {
        const parent = parentOf(projects, a.path);
        const project: Project = {
          id: newProjectId(),
          name: a.name,
          path: a.path,
          color: a.color || parent?.color || "#a8a8a8",
          order: projects.length,
          workspaceId: parent?.workspaceId ?? null,
        };
        setProjects((prev) => [...prev, project]);
        await spawnTabFor(project, a.run); // add the ccd tab BEFORE activating…
        setActiveProjectId(project.id); // …so the auto-spawn effect (App.tsx:763-778) sees a tab and skips the blank one
        pushToast("info", `➕ ${a.name} ajouté`);
        return;
      }
      if (a.kind === "remove" && a.path) {
        const proj = findProjectByPath(projects, a.path);
        if (!proj) {
          pushToast("error", `Projet introuvable pour ${a.path}`);
          return;
        }
        onDeleteProject(proj.id);
        if (a.after) {
          const parent = parentOf(projects, a.path);
          const cwd = parent?.path ?? "C:\\";
          void invoke("run_detached", { command: a.after, cwd });
        }
        pushToast("info", `➖ ${proj.name} retiré — nettoyage worktree en cours`);
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [projects, spawnTabFor, onDeleteProject, pushToast]);
```

- [ ] **Step 4: Verify build + tsc + tests**

Run: `pnpm build:renderer:dev && pnpm tsc --noEmit && pnpm vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(external-action): handle add/remove/notify from the /w and /m skills"
```

---

## Task 8: Build, install, and manually verify the Arkadia feature

**Files:** none (build + manual verification).

- [ ] **Step 1: Build the release bundle**

Run: `pnpm tauri build`
Expected: produces `target/release/arkadia.exe` and `target/release/bundle/nsis/Arkadia_0.1.0_x64-setup.exe`.

- [ ] **Step 2: Install/replace the running Arkadia**

Close the running Arkadia (this ends current `ccd` sessions), run the NSIS installer (or launch the freshly built `target/release/arkadia.exe`), and start it.

- [ ] **Step 3: Manual add test** — from any other shell (e.g. Windows Terminal), run:

```powershell
& "C:\Users\TRINITX\Desktop\Claude Desktop\Arkadia\target\release\arkadia.exe" --wt-add --path "C:\Users\TRINITX\Desktop\VTC-Planner\vtc-mobile-side" --name "vtc-mobile-side" --color "#ee9b00" --run "Write-Host HELLO_FROM_INIT"
```

Expected: Arkadia switches to a new `vtc-mobile-side` project, a terminal opens in that folder, and `HELLO_FROM_INIT` is printed (~1s later), and a "➕ vtc-mobile-side ajouté" toast appears.

- [ ] **Step 4: Manual notify test:**

```powershell
& "…\arkadia.exe" --wt-notify --level info --message "✅ test toast"
```

Expected: a toast "✅ test toast".

- [ ] **Step 5: Manual remove test:**

```powershell
& "…\arkadia.exe" --wt-remove --path "C:\Users\TRINITX\Desktop\VTC-Planner\vtc-mobile-side" --after "Start-Sleep 1; & '…\arkadia.exe' --wt-notify --message 'cleanup ran'"
```

Expected: the `vtc-mobile-side` project + its terminals close; ~1s later a "cleanup ran" toast confirms the detached `--after` process ran independently of the closed terminal.

- [ ] **Step 6: Commit any fixes found during manual testing, then tag**

```bash
git add -A && git commit -m "fix(external-action): address manual-test findings"   # only if fixes were needed
```

---

## Task 9: Wire `/w` to add the Arkadia project

**Files:**
- Modify: `~/.claude/skills/w/SKILL.md` (add a best-effort step after the junction step; renumber Rapport)

**Interfaces:**
- Consumes: the running Arkadia's `--wt-add` (Task 3/7). Resolve the exe from the running process so the single-instance key matches.

- [ ] **Step 1: Add the Arkadia step** to `w/SKILL.md`, after step 6 (node_modules junction) and before Baseline. Insert:

````markdown
7. **Ajouter le worktree comme projet Arkadia** (best-effort — ne jamais faire échouer la création du worktree si Arkadia est absent) :
   ```bash
   ARK=$(powershell -NoProfile -Command "(Get-Process arkadia -ErrorAction SilentlyContinue | Select-Object -First 1).Path" 2>/dev/null | tr -d '\r')
   if [ -n "$ARK" ]; then
     COLOR=$(powershell -NoProfile -Command "\$m=Get-Content \"\$env:APPDATA\com.trinitx.arkadia\store.json\" -Raw | ConvertFrom-Json; (\$m.projects | Where-Object { \$_.path -eq '$MAIN' } | Select-Object -First 1).color" 2>/dev/null | tr -d '\r')
     "$ARK" --wt-add --path "$WT_PATH" --name "$(basename "$WT_PATH")" --color "${COLOR:-#ee9b00}" --run "ccd"
   else
     echo "Arkadia non détecté — projet non ajouté (worktree créé quand même)."
   fi
   ```
   Arkadia bascule sur le nouveau projet et lance `ccd` tout seul.
````

Renumber the following `Baseline`/`Rapport` steps to 8/9. In the Rapport step, mention the project appeared in Arkadia (or the fallback message).

- [ ] **Step 2: Verify the skill reads coherently** — re-read `w/SKILL.md` end-to-end; confirm step numbers are sequential and `$MAIN`/`$WT_PATH` are defined before use.

- [ ] **Step 3: Commit** (skills are outside the Arkadia repo; commit in the skills location if it is version-controlled, otherwise note the change)

```bash
# If ~/.claude is a git repo:
git -C "$HOME/.claude" add skills/w/SKILL.md && git -C "$HOME/.claude" commit -m "feat(w): register new worktree as an Arkadia project"
```

---

## Task 10: Wire `/m` (Case B) to remove the Arkadia project + defer folder removal

**Files:**
- Modify: `~/.claude/skills/m/SKILL.md` (Case B cleanup)

**Interfaces:**
- Consumes: the running Arkadia's `--wt-remove … --after …` and `--wt-notify` (Tasks 3/7).

- [ ] **Step 1: Restructure Case B cleanup** in `m/SKILL.md`. For a worktree-origin merge run **from inside the worktree**, replace the §5 cleanup for this case with:

````markdown
### Nettoyage quand `/m` est lancé DEPUIS le worktree (Arkadia détecté)

1. En place (le cwd interdit seulement de supprimer le *dossier*, pas d'agir dedans) :
   - retirer la junction node_modules (non-récursif, cf. §5 principal),
   - `git branch -d "$WT_BRANCH"` depuis `$MERGE_CWD`.
2. Résoudre l'exe Arkadia du process courant :
   ```bash
   ARK=$(powershell -NoProfile -Command "(Get-Process arkadia -ErrorAction SilentlyContinue | Select-Object -First 1).Path" 2>/dev/null | tr -d '\r')
   ```
3. Construire la commande `--after` (retry car la fermeture du terminal est asynchrone) qui supprime le dossier puis notifie via Arkadia :
   ```bash
   AFTER="\$p='$WT_PATH'; for (\$i=0; \$i -lt 30; \$i++) { git -C '$MAIN' worktree remove --force \$p 2>\$null; if (-not (Test-Path \$p)) { break }; Start-Sleep -Milliseconds 500 }; if (Test-Path \$p) { & '$ARK' --wt-notify --level error --message ('Echec suppression '+\$p) } else { & '$ARK' --wt-notify --level info --message ('✅ $WT_BRANCH mergé dans $ORIGIN et worktree nettoyé') }"
   ```
4. Déclencher la fermeture + le nettoyage différé (ceci ferme le terminal courant) :
   ```bash
   "$ARK" --wt-remove --path "$WT_PATH" --after "$AFTER"
   ```
   Prévenir l'utilisateur juste avant : « Merge fait. Ce terminal va se fermer, le worktree se nettoie en arrière-plan, une notif Arkadia confirmera. »
5. Si `ARK` est vide (Arkadia absent) : faire le `git worktree remove` classique en direct (§5 principal) et signaler.
````

- [ ] **Step 2: Keep the `master` origin path (Case A) unchanged** and keep the generic §5 (junction-safe removal) as the fallback when Arkadia is absent.

- [ ] **Step 3: Re-read `m/SKILL.md`** — confirm `$MAIN`, `$MERGE_CWD`, `$ORIGIN`, `$WT_PATH`, `$WT_BRANCH` are all defined earlier in the skill before this section uses them.

- [ ] **Step 4: Commit**

```bash
git -C "$HOME/.claude" add skills/m/SKILL.md && git -C "$HOME/.claude" commit -m "feat(m): remove Arkadia project + deferred worktree cleanup on merge"
```

---

## Task 11: End-to-end verification (real `/w` → work → `/m`)

**Files:** none (manual, in the running rebuilt Arkadia).

- [ ] **Step 1:** From the main VTC project terminal in Arkadia, run `/w e2e`. Expect: worktree `vtc-mobile-e2e` created, `.env` copied, Arkadia switches to it, `ccd` starts.
- [ ] **Step 2:** In that new `ccd`, make a trivial commit (e.g. touch a file, commit) so there is something to merge.
- [ ] **Step 3:** In the same worktree `ccd`, run `/m`. Expect: merge into `feat/build-1.1.0`, the worktree terminal closes, and within a few seconds an Arkadia toast confirms "✅ … mergé … et worktree nettoyé". Verify `git worktree list` no longer shows `vtc-mobile-e2e` and the branch is gone.
- [ ] **Step 4:** Confirm the shared `node_modules` of the main repo is intact (`ls node_modules/expo` in the main repo).

---

## Self-Review Notes

- **Spec coverage:** trigger (Tasks 1,3), add+switch+ccd (Tasks 5,7,9), same-workspace+parent-color (Task 4 `parentOf`, Task 7), `/m` from worktree with deferred folder removal (Tasks 2,7,10), toast confirmation (Tasks 6,7,10), best-effort fallback (Tasks 9,10). Covered.
- **`.env` copy** already shipped in `w/SKILL.md` (independent of this plan).
- **Type consistency:** `init_command` (snake_case) at both the invoke call (Task 5) and the Rust param (`terminal.rs:301`); `ExternalAction` fields identical across Rust (Task 1) and TS (Task 4); event name `"external-action"` identical in Tasks 3 and 7; `--after`/`--wt-notify` contract identical across Tasks 7 and 10.
- **Known limitation:** cold-start argv (Arkadia not already running) is not handled — acceptable because `/w` and `/m` are always typed inside a running Arkadia terminal. Documented in Global Constraints.
```
