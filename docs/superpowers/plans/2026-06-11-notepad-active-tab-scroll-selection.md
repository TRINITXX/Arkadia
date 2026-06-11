# Bloc-note latéral + bascule onglet Active + sélection scrollback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter les trois features validées dans `docs/superpowers/specs/2026-06-11-notepad-active-tab-scroll-selection-design.md` : bascule auto de la sidebar vers l'onglet Active, panneau bloc-note redimensionnable avec historique par projet, et sélection terminal ancrée au scrollback (extension molette + auto-scroll au bord).

**Architecture:** Trois chantiers indépendants. (1) Un `useEffect` local dans `Sidepanel.tsx`. (2) Un module de persistance `notepadStore.ts` (fichier `notepad.json` via `@tauri-apps/plugin-store`) + composant `NotepadPanel.tsx` monté dans le flex row racine d'`App.tsx`, ouvert par une icône dans `Toolbar.tsx`. (3) Sélection en coordonnées absolues (`total_row`, 0 = plus vieille ligne du scrollback) dans le renderer WASM, extraction du texte par une nouvelle commande Tauri `get_text_range`, conversions viewport↔absolu côté `TerminalWebGPU.tsx`.

**Tech Stack:** React 18 + TypeScript (frontend), Rust (renderer WASM `crates/terminal-renderer` via wasm-pack, backend Tauri 2 `src-tauri`), Tailwind v4, lucide-react, `@tauri-apps/plugin-store`, `@tauri-apps/plugin-clipboard-manager`.

**Conventions de vérification** (utilisées dans toutes les tâches) :
- Typecheck frontend : `npx tsc --noEmit` (depuis la racine du repo)
- Lint : `npx eslint src`
- Tests Rust backend : `cargo test --manifest-path src-tauri/Cargo.toml`
- Build renderer WASM : `pnpm run build:renderer:dev`
- Il n'y a **pas** d'infra de test JS (pas de jest/vitest) — le frontend se vérifie par typecheck + lint + vérification manuelle dans l'app (`pnpm tauri dev`).
- Strings UI en **anglais** (convention existante : "no toolbar button — open settings to add one").

---

### Task 1: Bascule auto de la sidebar vers l'onglet Active

**Files:**
- Modify: `src/components/Sidepanel.tsx:1` (imports) et `src/components/Sidepanel.tsx:186` (après le `useState` de `view`)

- [ ] **Step 1: Ajouter le useEffect de détection de transition**

Dans `src/components/Sidepanel.tsx`, remplacer la ligne 1 :

```tsx
import { Fragment, useMemo, useState } from "react";
```

par :

```tsx
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
```

Puis, juste après la ligne `const [view, setView] = useState<"active" | "inactive">("inactive");` (ligne ~186), insérer :

```tsx
  // Auto-switch to the Active tab when a project transitions inactive→active
  // (the user typed in one of its terminals). Never switches back the other way.
  const prevActiveIdsRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const prev = prevActiveIdsRef.current;
    prevActiveIdsRef.current = activeProjectIds;
    if (!prev) return; // initial render — keep the default view
    for (const id of activeProjectIds) {
      if (!prev.has(id)) {
        setView("active");
        return;
      }
    }
  }, [activeProjectIds]);
```

Note : `activeProjectIds` est déjà une prop (`ReadonlySet<string>`, ligne 45) recalculée par `useMemo` dans `App.tsx:159` — l'identité de l'objet change à chaque ajout/retrait, donc l'effet se déclenche bien.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` puis `npx eslint src`
Expected: 0 erreur.

- [ ] **Step 3: Vérification manuelle**

Run: `pnpm tauri dev`. Sidebar sur l'onglet "Inactive" → taper dans le terminal d'un projet inactif → la sidebar bascule sur "Active". Re-taper dans le même projet (déjà actif) → pas de re-bascule si on est revenu sur "Inactive" manuellement.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidepanel.tsx
git commit -m "feat(sidebar): auto-switch to Active tab when a project becomes active"
```

---

### Task 2: Module de persistance du bloc-note

**Files:**
- Create: `src/lib/notepadStore.ts`

- [ ] **Step 1: Créer le module complet**

Créer `src/lib/notepadStore.ts` :

```ts
import { Store } from "@tauri-apps/plugin-store";

/**
 * Persistence for the notepad panel. Separate file from store.json so the
 * main saveState() doesn't rewrite notepad data (and vice versa).
 * Keys: "panelWidth" (global) and one key per projectId ("proj-…").
 */
const STORE_FILE = "notepad.json";
const KEY_PANEL_WIDTH = "panelWidth";

export const HISTORY_CAP = 100;
export const PANEL_WIDTH_MIN = 240;
export const PANEL_WIDTH_MAX = 600;
export const PANEL_WIDTH_DEFAULT = 320;

export interface NotepadEntry {
  id: string;
  text: string;
  createdAt: number; // epoch ms
}

export interface NotepadProjectState {
  /** In-progress text, not yet copied/archived. */
  draft: string;
  /** Archived messages, most recent first. */
  history: NotepadEntry[];
}

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return storePromise;
}

export function newEntryId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clampPanelWidth(w: unknown): number {
  if (typeof w !== "number" || !Number.isFinite(w)) return PANEL_WIDTH_DEFAULT;
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(w)));
}

function normalizeEntry(e: unknown): NotepadEntry | null {
  const x = (e ?? {}) as Record<string, unknown>;
  if (typeof x.text !== "string" || x.text.length === 0) return null;
  return {
    id: typeof x.id === "string" ? x.id : newEntryId(),
    text: x.text,
    createdAt: typeof x.createdAt === "number" ? x.createdAt : 0,
  };
}

export function normalizeProjectState(raw: unknown): NotepadProjectState {
  const x = (raw ?? {}) as Record<string, unknown>;
  const history = Array.isArray(x.history)
    ? (x.history.map(normalizeEntry).filter(Boolean) as NotepadEntry[]).slice(
        0,
        HISTORY_CAP,
      )
    : [];
  return {
    draft: typeof x.draft === "string" ? x.draft : "",
    history,
  };
}

export async function loadProjectNotepad(
  projectId: string,
): Promise<NotepadProjectState> {
  const store = await getStore();
  const raw = await store.get<unknown>(projectId);
  return normalizeProjectState(raw);
}

export async function saveProjectNotepad(
  projectId: string,
  state: NotepadProjectState,
): Promise<void> {
  const store = await getStore();
  await store.set(projectId, {
    draft: state.draft,
    history: state.history.slice(0, HISTORY_CAP),
  });
  await store.save();
}

export async function loadPanelWidth(): Promise<number> {
  const store = await getStore();
  const raw = await store.get<unknown>(KEY_PANEL_WIDTH);
  return clampPanelWidth(raw);
}

export async function savePanelWidth(width: number): Promise<void> {
  const store = await getStore();
  await store.set(KEY_PANEL_WIDTH, clampPanelWidth(width));
  await store.save();
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` puis `npx eslint src`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add src/lib/notepadStore.ts
git commit -m "feat(notepad): persistence module for per-project prompt history"
```

---

### Task 3: Composant NotepadPanel

**Files:**
- Create: `src/components/NotepadPanel.tsx`

- [ ] **Step 1: Créer le composant complet**

Créer `src/components/NotepadPanel.tsx` :

```tsx
import { useEffect, useRef, useState } from "react";
import { writeText as writeClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy, Pencil, Trash2, X } from "lucide-react";
import {
  HISTORY_CAP,
  PANEL_WIDTH_DEFAULT,
  clampPanelWidth,
  loadPanelWidth,
  loadProjectNotepad,
  newEntryId,
  savePanelWidth,
  saveProjectNotepad,
  type NotepadEntry,
} from "@/lib/notepadStore";

const DRAFT_SAVE_DEBOUNCE_MS = 500;
const COPIED_FLASH_MS = 1200;

interface NotepadPanelProps {
  projectId: string | null;
  projectName: string | null;
  onClose: () => void;
}

export function NotepadPanel({
  projectId,
  projectName,
  onClose,
}: NotepadPanelProps) {
  const [width, setWidth] = useState(PANEL_WIDTH_DEFAULT);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<NotepadEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live mirrors so window-level resize handlers and unmount flush read
  // current values without re-subscribing.
  const historyRef = useRef(history);
  const widthRef = useRef(width);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  // Panel width: load once.
  useEffect(() => {
    void loadPanelWidth().then(setWidth);
  }, []);

  // Per-project state: (re)load when the active project changes.
  useEffect(() => {
    setLoaded(false);
    setCopiedId(null);
    if (!projectId) {
      setDraft("");
      setHistory([]);
      return;
    }
    let cancelled = false;
    void loadProjectNotepad(projectId).then((s) => {
      if (cancelled) return;
      setDraft(s.draft);
      setHistory(s.history);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, [projectId]);

  const persist = (id: string, draftValue: string, hist: NotepadEntry[]) => {
    void saveProjectNotepad(id, { draft: draftValue, history: hist });
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!projectId || !loaded) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      persist(projectId, value, historyRef.current);
    }, DRAFT_SAVE_DEBOUNCE_MS);
  };

  const flashCopied = (id: string) => {
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(
      () => setCopiedId(null),
      COPIED_FLASH_MS,
    );
  };

  const copyDraft = async () => {
    if (!projectId || !loaded) return;
    const text = draft.trimEnd();
    if (text.trim().length === 0) return;
    try {
      await writeClipboard(text);
    } catch (err) {
      console.error("[arkadia] notepad clipboard write failed:", err);
      return;
    }
    const entry: NotepadEntry = {
      id: newEntryId(),
      text,
      createdAt: Date.now(),
    };
    const next = [entry, ...historyRef.current].slice(0, HISTORY_CAP);
    setHistory(next);
    setDraft("");
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    persist(projectId, "", next);
    flashCopied(entry.id);
    textareaRef.current?.focus();
  };

  const copyEntry = async (entry: NotepadEntry) => {
    try {
      await writeClipboard(entry.text);
      flashCopied(entry.id);
    } catch (err) {
      console.error("[arkadia] notepad clipboard write failed:", err);
    }
  };

  const loadEntry = (entry: NotepadEntry) => {
    if (!projectId || !loaded) return;
    setDraft(entry.text);
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    persist(projectId, entry.text, historyRef.current);
    textareaRef.current?.focus();
  };

  const deleteEntry = (entry: NotepadEntry) => {
    if (!projectId || !loaded) return;
    const next = historyRef.current.filter((e) => e.id !== entry.id);
    setHistory(next);
    persist(projectId, draft, next);
  };

  // Width resize: drag handle on the left edge. Window-level listeners so
  // the drag survives the cursor leaving the handle.
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const onMove = (ev: MouseEvent) => {
      setWidth(clampPanelWidth(startWidth + (startX - ev.clientX)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      void savePanelWidth(widthRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-zinc-800 bg-zinc-950"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        onMouseDown={onResizeStart}
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-zinc-700"
      />

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <span className="text-xs font-medium text-zinc-200">Notepad</span>
        <span className="flex-1 truncate text-xs text-zinc-500">
          {projectName ?? ""}
        </span>
        <button
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          title="Close"
          aria-label="Close notepad"
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      {!projectId ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-zinc-600">
          select a project to use the notepad
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-800 p-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === "Enter") {
                  e.preventDefault();
                  void copyDraft();
                }
              }}
              placeholder="write a prompt…"
              spellCheck={false}
              disabled={!loaded}
              className="h-40 resize-none rounded border border-zinc-800 bg-zinc-900 p-2 text-xs leading-5 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <button
              onClick={() => void copyDraft()}
              disabled={!loaded || draft.trim().length === 0}
              className="flex h-7 items-center justify-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 text-xs text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
            >
              <Copy size={12} />
              <span>Copy</span>
              <span className="text-zinc-500">Ctrl+Enter</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {history.length === 0 ? (
              <div className="px-1 py-2 text-xs text-zinc-600">
                no messages yet — copied prompts land here
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="group relative rounded border border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700"
                  >
                    <button
                      type="button"
                      onClick={() => void copyEntry(entry)}
                      title="Copy to clipboard"
                      className="w-full px-2 py-1.5 text-left"
                    >
                      <span className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-4 text-zinc-300">
                        {entry.text}
                      </span>
                    </button>
                    <div className="absolute right-1 top-1 hidden items-center gap-0.5 rounded bg-zinc-900 px-0.5 group-hover:flex">
                      {copiedId === entry.id && (
                        <Check size={12} className="text-emerald-400" />
                      )}
                      <button
                        type="button"
                        onClick={() => loadEntry(entry)}
                        title="Load into editor"
                        className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteEntry(entry)}
                        title="Delete"
                        className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

Notes pour l'exécutant :
- La `textarea` est native : Ctrl+A/C/X/V, Ctrl+flèches, Maj+flèches, Ctrl+Backspace, undo/redo fonctionnent sans code. Ne **pas** ajouter de handler qui `preventDefault` ces touches. Seul Ctrl+Entrée est intercepté.
- L'`onKeyDown` Escape est sur le div racine (bubbling depuis la textarea) — pas de listener `window`.
- `copiedId` sur `copyDraft` référence une entrée qui vient d'être ajoutée à l'historique → le check vert apparaît sur la nouvelle entrée en tête.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` puis `npx eslint src`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add src/components/NotepadPanel.tsx
git commit -m "feat(notepad): resizable side panel with per-project prompt history"
```

---

### Task 4: Icône toolbar + montage dans App

**Files:**
- Modify: `src/components/Toolbar.tsx:1-63` (props + bouton)
- Modify: `src/App.tsx` (state + props Toolbar + montage du panneau, zone lignes ~952-1046)

- [ ] **Step 1: Ajouter le bouton dans Toolbar.tsx**

Dans `src/components/Toolbar.tsx`, remplacer l'import lucide (lignes 2-7) :

```tsx
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  NotebookPen,
  Settings as SettingsIcon,
} from "lucide-react";
```

(Si `NotebookPen` n'existe pas dans la version installée de lucide-react, utiliser `StickyNote` à la place — vérifier avec le typecheck.)

Étendre l'interface (lignes 11-16) :

```tsx
interface ToolbarProps {
  buttons: ToolbarButton[];
  onRunAction: (button: ActionButton) => void;
  onOpenSettings: () => void;
  notepadOpen: boolean;
  onToggleNotepad: () => void;
  disabled?: boolean;
}
```

Mettre à jour la destructuration (lignes 18-23) :

```tsx
export function Toolbar({
  buttons,
  onRunAction,
  onOpenSettings,
  notepadOpen,
  onToggleNotepad,
  disabled = false,
}: ToolbarProps) {
```

Insérer le bouton **juste avant** le bouton Settings (ligne 52) :

```tsx
      <button
        onClick={onToggleNotepad}
        className={`ml-1 flex size-7 items-center justify-center rounded hover:bg-zinc-900 hover:text-zinc-100 ${
          notepadOpen ? "bg-zinc-900 text-zinc-100" : "text-zinc-400"
        }`}
        title="Notepad"
        aria-label="Notepad"
        type="button"
      >
        <NotebookPen size={14} />
      </button>
```

Le bouton n'est **pas** soumis à `disabled` (le panneau gère lui-même l'absence de projet actif).

- [ ] **Step 2: Câbler dans App.tsx**

Dans `src/App.tsx` :

1. Ajouter l'import du composant à côté des autres imports de composants :

```tsx
import { NotepadPanel } from "./components/NotepadPanel";
```

(Adapter le préfixe : suivre la forme des imports voisins existants — `./components/…` ou `@/components/…`.)

2. Ajouter le state près des autres `useState` de dialogues (zone ligne ~120) :

```tsx
  const [notepadOpen, setNotepadOpen] = useState(false);
```

3. Étendre le rendu de `<Toolbar … />` (ligne ~989) :

```tsx
        <Toolbar
          buttons={toolbarButtons}
          onRunAction={runToolbarAction}
          onOpenSettings={() => setSettingsOpen(true)}
          notepadOpen={notepadOpen}
          onToggleNotepad={() => setNotepadOpen((v) => !v)}
          disabled={!activeProject}
        />
```

4. Monter le panneau comme **troisième enfant du flex row racine**, juste après la fermeture du `<div className="flex flex-1 flex-col overflow-hidden">` (ligne ~1046) et avant `<AddProjectDialog …>` :

```tsx
      {notepadOpen && (
        <NotepadPanel
          projectId={activeProject?.id ?? null}
          projectName={activeProject?.name ?? null}
          onClose={() => setNotepadOpen(false)}
        />
      )}
```

Le panneau prend sa place dans le flex row (`shrink-0` + width inline) → le `flex-1` de la colonne centrale rétrécit, le `ResizeObserver` de `TerminalWebGPU.tsx:700` redimensionne le PTY. Aucun overlay.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` puis `npx eslint src`
Expected: 0 erreur.

- [ ] **Step 4: Vérification manuelle**

Run: `pnpm tauri dev`. Vérifier :
- Clic icône → le panneau s'ouvre à droite, le terminal rétrécit (pas de recouvrement) ; re-clic → fermeture et le terminal reprend la largeur.
- Écrire un texte → Copy (et Ctrl+Entrée) → coller ailleurs OK, entrée archivée en tête, zone vidée.
- Fermer/rouvrir le panneau et l'app → historique et draft conservés.
- Changer de projet actif → l'historique affiché change.
- Redimensionner par la poignée gauche (min 240, max 600) → largeur conservée après réouverture.
- Dans la textarea : Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+flèches, Maj+flèches, Ctrl+Z se comportent comme un éditeur classique.
- Échap dans le panneau → fermeture.

- [ ] **Step 5: Commit**

```bash
git add src/components/Toolbar.tsx src/App.tsx
git commit -m "feat(notepad): toolbar toggle button and panel mount in app layout"
```

---

### Task 5: Backend — `text_range` + commande `get_text_range` (TDD)

**Files:**
- Modify: `src-tauri/src/terminal_state.rs` (méthode publique + tests dans le `mod tests` existant, ligne ~1157)
- Modify: `src-tauri/src/terminal.rs` (nouvelle commande, à placer après `search_terminal`, ligne ~775)
- Modify: `src-tauri/src/lib.rs:14-17` (use) et `src-tauri/src/lib.rs:67-81` (generate_handler)

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src-tauri/src/terminal_state.rs`, ajouter à la fin du `mod tests` existant (après les tests `encode_mouse_*`) :

```rust
    #[test]
    fn text_range_single_line() {
        let mut t = TerminalState::new(4, 20);
        t.advance_bytes(b"hello world");
        // No scrollback yet: total row 0 = screen row 0.
        assert_eq!(t.text_range(2, 0, 4, 0), "llo");
    }

    #[test]
    fn text_range_reversed_endpoints() {
        let mut t = TerminalState::new(4, 20);
        t.advance_bytes(b"hello world");
        assert_eq!(t.text_range(4, 0, 2, 0), "llo");
    }

    #[test]
    fn text_range_multiline_trims_trailing_blanks() {
        let mut t = TerminalState::new(4, 20);
        t.advance_bytes(b"alpha\r\nbeta");
        // From inside "alpha" to the right edge of "beta"'s row: trailing
        // blank cells must be trimmed on every line.
        assert_eq!(t.text_range(2, 0, 19, 1), "pha\nbeta");
    }

    #[test]
    fn text_range_spans_scrollback_and_screen() {
        let mut t = TerminalState::new(2, 10);
        // Three lines on a 2-row screen: "one" scrolls out into scrollback.
        t.advance_bytes(b"one\r\ntwo\r\nthree");
        assert_eq!(t.scrollback_len(), 1);
        // total row 0 = "one" (scrollback), 1 = "two", 2 = "three" (screen).
        assert_eq!(t.text_range(0, 0, 9, 2), "one\ntwo\nthree");
    }

    #[test]
    fn text_range_wide_grapheme_skips_continuation() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes("日本".as_bytes());
        // 日 occupies cols 0-1 (continuation cell at col 1), 本 cols 2-3.
        assert_eq!(t.text_range(0, 0, 3, 0), "日本");
    }

    #[test]
    fn text_range_out_of_bounds_clamps() {
        let mut t = TerminalState::new(2, 10);
        t.advance_bytes(b"ab");
        // End row far beyond the grid: clamps to the last total row.
        assert_eq!(t.text_range(0, 0, 9, 99), "ab");
        // Start row beyond the grid: empty result.
        assert_eq!(t.text_range(0, 50, 9, 99), "");
    }
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cargo test --manifest-path src-tauri/Cargo.toml text_range`
Expected: échec de compilation — `no method named text_range found for struct TerminalState`.

- [ ] **Step 3: Implémenter `text_range`**

Dans `src-tauri/src/terminal_state.rs`, ajouter dans le `impl TerminalState`, juste après la méthode `search` (ligne ~242) :

```rust
    /// Extracts the text covered by an inclusive selection in *total* row
    /// coordinates (0 = oldest scrollback line, `scrollback_len()` = visible
    /// row 0 — same convention as `search`). Endpoints may be passed in any
    /// order. Continuation cells of wide graphemes are skipped; trailing
    /// blanks are trimmed per line, lines are joined with '\n'.
    pub fn text_range(
        &self,
        start_col: u32,
        start_row: u32,
        end_col: u32,
        end_row: u32,
    ) -> String {
        let ((sc, sr), (ec, er)) = if (start_row, start_col) > (end_row, end_col) {
            ((end_col, end_row), (start_col, start_row))
        } else {
            ((start_col, start_row), (end_col, end_row))
        };
        let sb_len = self.scrollback_len() as u32;
        let total_rows = sb_len + self.rows as u32;
        if sr >= total_rows {
            return String::new();
        }
        let er = er.min(total_rows - 1);
        let mut out = String::new();
        for row in sr..=er {
            let line: &[TerminalCell] = if row < sb_len {
                &self.scrollback[row as usize]
            } else {
                match self.active_screen().get((row - sb_len) as usize) {
                    Some(l) => l,
                    None => continue,
                }
            };
            let mut row_text = String::new();
            for (idx, cell) in line.iter().enumerate() {
                let col = idx as u32;
                // Continuation cell (right half of a wide grapheme): the main
                // cell on its left already contributed the full text.
                if cell.width == 0 {
                    continue;
                }
                let selected = if sr == er {
                    col >= sc && col <= ec
                } else if row == sr {
                    col >= sc
                } else if row == er {
                    col <= ec
                } else {
                    true
                };
                if selected {
                    row_text.push_str(&cell.text);
                }
            }
            out.push_str(row_text.trim_end());
            if row < er {
                out.push('\n');
            }
        }
        out
    }
```

Note : sur l'alt screen, `scrollback_len()` retourne 0 (ligne 193-199) donc les coordonnées totales = coordonnées écran et l'indexation `self.scrollback[…]` n'est jamais atteinte.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cargo test --manifest-path src-tauri/Cargo.toml text_range`
Expected: `6 passed`. Lancer aussi la suite complète : `cargo test --manifest-path src-tauri/Cargo.toml` → tout vert.

- [ ] **Step 5: Exposer la commande Tauri**

Dans `src-tauri/src/terminal.rs`, ajouter après `search_terminal` (ligne ~775) :

```rust
#[tauri::command]
pub fn get_text_range(
    session_id: String,
    start_col: u32,
    start_row: u32,
    end_col: u32,
    end_row: u32,
    state: State<'_, SessionMap>,
) -> Result<String, String> {
    let sessions = state.sessions.lock();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("unknown session {session_id}"))?;
    let text = session
        .term
        .lock()
        .text_range(start_col, start_row, end_col, end_row);
    Ok(text)
}
```

Dans `src-tauri/src/lib.rs`, étendre l'import (lignes 14-17) :

```rust
use terminal::{
    close_terminal, get_text_range, request_render, resize_terminal, scroll_terminal,
    search_terminal, send_input, send_mouse_event, spawn_terminal, SessionMap,
};
```

et ajouter `get_text_range,` dans la liste `generate_handler![…]` (lignes 67-81).

- [ ] **Step 6: Compiler**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 0 erreur (warnings préexistants tolérés).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/terminal_state.rs src-tauri/src/terminal.rs src-tauri/src/lib.rs
git commit -m "feat(terminal): get_text_range command reading scrollback + screen"
```

---

### Task 6: Sélection en coordonnées absolues (renderer WASM + frontend)

Cette tâche change la sémantique du renderer **et** migre le frontend dans le même commit — un état intermédiaire mélangerait coordonnées écran et absolues.

**Files:**
- Modify: `crates/terminal-renderer/src/lib.rs:58-91` (doc Selection), `:303-317` (doc set_selection), `:331-360` (suppression selection_text), `:371-431` (build_instances)
- Modify: `src/components/TerminalWebGPU.tsx:416-430` (refs), `:490-503` (helpers), `:755-776` (Ctrl+C), `:788-897` (drag handlers), `:687` (resize), `:899-954` (mousedown)

- [ ] **Step 1: Renderer — Selection en total rows**

Dans `crates/terminal-renderer/src/lib.rs` :

1. Documenter la nouvelle convention sur la struct (ligne 58) :

```rust
/// Selection endpoints. Columns are viewport columns; rows are *total* rows:
/// 0 = oldest scrollback line, `scroll_max - scroll_offset` = first visible
/// row. Anchoring to content (not the viewport) keeps the highlight glued to
/// the text while the user scrolls.
#[derive(Clone, Copy)]
struct Selection {
```

2. Documenter `set_selection` (ligne 303) :

```rust
    /// Sets the selection. Rows are *total* rows (0 = oldest scrollback
    /// line), columns are viewport columns. Endpoints may be in any order.
    pub fn set_selection(
```

(corps inchangé)

3. Dans `build_instances` (ligne 371), insérer au début de la fonction, avant la boucle `for (row_idx, runs)` :

```rust
        // First visible row in total coordinates — converts the viewport row
        // of each drawn cell into the Selection's total-row space.
        let visible_start = payload.scroll_max.saturating_sub(payload.scroll_offset);
```

et remplacer (lignes 428-431) :

```rust
                    let in_selection = self
                        .selection
                        .map(|s| s.contains(col, row_idx as u32))
                        .unwrap_or(false);
```

par :

```rust
                    let in_selection = self
                        .selection
                        .map(|s| s.contains(col, visible_start + row_idx as u32))
                        .unwrap_or(false);
```

4. Supprimer entièrement la méthode `selection_text` (lignes 331-360) — le texte est désormais extrait par le backend (`get_text_range`), qui voit tout le scrollback.

- [ ] **Step 2: Rebuild du renderer**

Run: `pnpm run build:renderer:dev`
Expected: build OK ; le `.d.ts` régénéré ne contient plus `selection_text`.

- [ ] **Step 3: Frontend — refs et helpers**

Dans `src/components/TerminalWebGPU.tsx` :

1. Remplacer la déclaration `dragStartRef` (ligne 419) et ajouter les nouvelles refs :

```tsx
  // Drag anchor in *total* row coordinates (0 = oldest scrollback line) so
  // the selection stays glued to content while the viewport scrolls.
  const dragStartRef = useRef<{ col: number; row: number } | null>(null);
  const dragMovedRef = useRef(false);
  // Current selection endpoints (total rows), mirroring the renderer's
  // Selection — needed to fetch the selected text from the backend on copy.
  const selectionRef = useRef<{
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
  } | null>(null);
  // Last mouse position of an in-progress drag, to re-anchor the selection
  // end when the viewport scrolls under a stationary cursor.
  const lastDragPosRef = useRef<{ x: number; y: number } | null>(null);
```

(`dragMovedRef` existe déjà ligne 420 — ne pas le dupliquer, seulement insérer les deux nouvelles refs et le commentaire de `dragStartRef`.)

2. Après la fonction `cellAt` (ligne ~503), ajouter :

```tsx
  // First visible row in total coordinates (same convention as SearchHit).
  const visibleStartRow = () => {
    const s = screenRef.current;
    return s ? s.scroll_max - s.scroll_offset : 0;
  };

  // cellAt clamped to the grid — selection coordinates must not run past the
  // last row/col when the pointer leaves the wrapper during a drag.
  const selectionCellAt = (clientX: number, clientY: number) => {
    const { col, row } = cellAt(clientX, clientY);
    const s = screenRef.current;
    return {
      col: Math.min(col, (s?.cols ?? 1) - 1),
      row: Math.min(row, (s?.rows ?? 1) - 1),
    };
  };
```

- [ ] **Step 4: Frontend — mousedown / mousemove / mouseup en coordonnées absolues**

1. Dans `onMouseDown` (ligne 952), remplacer :

```tsx
    dragStartRef.current = { col, row };
```

par :

```tsx
    dragStartRef.current = { col, row: visibleStartRow() + row };
```

2. Dans le handler `onMove` du useEffect window-level (lignes 818-832), remplacer le bloc drag-select :

```tsx
      const start = dragStartRef.current;
      const r = rendererRef.current;
      if (!start || !r) return;
      const { col, row } = cellAt(e.clientX, e.clientY);
      if (col === start.col && row === start.row) return;
      // First real move: commit the start of the selection.
      if (!dragMovedRef.current) {
        dragMovedRef.current = true;
        // Drag cancels any pending click.
        pendingClickRef.current = null;
        // Clear any prior selection from a previous drag now that we know
        // this gesture is actually a drag.
        r.clear_selection();
      }
      r.set_selection(start.col, start.row, col, row);
```

par :

```tsx
      const start = dragStartRef.current;
      const r = rendererRef.current;
      if (!start || !r) return;
      lastDragPosRef.current = { x: e.clientX, y: e.clientY };
      const { col, row } = selectionCellAt(e.clientX, e.clientY);
      const totalRow = visibleStartRow() + row;
      if (col === start.col && totalRow === start.row) return;
      // First real move: commit the start of the selection.
      if (!dragMovedRef.current) {
        dragMovedRef.current = true;
        // Drag cancels any pending click.
        pendingClickRef.current = null;
        // Clear any prior selection from a previous drag now that we know
        // this gesture is actually a drag.
        r.clear_selection();
        selectionRef.current = null;
      }
      selectionRef.current = {
        startCol: start.col,
        startRow: start.row,
        endCol: col,
        endRow: totalRow,
      };
      r.set_selection(start.col, start.row, col, totalRow);
```

3. Dans `onUp` (ligne 853 et suivantes), après `dragStartRef.current = null;`, ajouter :

```tsx
      lastDragPosRef.current = null;
```

4. À **chaque** site `r.clear_selection()` du fichier (Ctrl+C ligne 772, click-sur-lien ligne 862, plain-click ligne 885 — l'occurrence du drag est déjà traitée au point 2), ajouter immédiatement après :

```tsx
        selectionRef.current = null;
```

- [ ] **Step 5: Frontend — copie via le backend**

Remplacer le bloc Ctrl+C (lignes 755-776) :

```tsx
    // Ctrl+C: copy if a selection is active, otherwise fall through to SIGINT.
    if (
      r &&
      e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "c" &&
      r.has_selection()
    ) {
      const text = r.selection_text();
      if (text.length > 0) {
        e.preventDefault();
        try {
          await writeClipboard(text);
        } catch (err) {
          console.error("[arkadia] clipboard write failed:", err);
        }
        r.clear_selection();
        redraw();
        return;
      }
    }
```

par :

```tsx
    // Ctrl+C: copy if a selection is active, otherwise fall through to SIGINT.
    // The selected text lives in the backend (scrollback + screen) — the
    // renderer only knows the visible payload.
    if (
      r &&
      e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "c" &&
      r.has_selection() &&
      selectionRef.current
    ) {
      e.preventDefault();
      const sel = selectionRef.current;
      try {
        const text = await invoke<string>("get_text_range", {
          sessionId: pane.id,
          startCol: sel.startCol,
          startRow: sel.startRow,
          endCol: sel.endCol,
          endRow: sel.endRow,
        });
        if (text.length > 0) {
          await writeClipboard(text);
        }
      } catch (err) {
        console.error("[arkadia] clipboard write failed:", err);
      }
      r.clear_selection();
      selectionRef.current = null;
      redraw();
      return;
    }
```

(Changement de comportement assumé : une sélection active dont le texte est vide ne retombe plus sur SIGINT — Ctrl+C la consomme et la vide. Cas marginal, comportement plus prévisible.)

- [ ] **Step 6: Frontend — clear au resize**

Dans la fonction `apply` du ResizeObserver (ligne ~687), juste après :

```tsx
      if (cols === lastCols && rows === lastRows) return;
```

ajouter :

```tsx
      // The grid is changing: viewport columns no longer line up with the
      // selected content — drop the selection rather than show a stale shape.
      rendererRef.current?.clear_selection();
      selectionRef.current = null;
```

- [ ] **Step 7: Typecheck + lint + vérification manuelle**

Run: `npx tsc --noEmit` puis `npx eslint src`
Expected: 0 erreur (toute référence restante à `selection_text` casserait le typecheck).

Run: `pnpm tauri dev`, puis dans un shell (hors claude code) :
- Générer de l'historique (`ls -R` ou équivalent), sélectionner du texte, **scroller à la molette** → le surlignage suit le texte (ne reste plus figé à l'écran).
- Ctrl+C → le texte collé correspond exactement à la sélection, y compris si elle est partiellement hors écran au moment de la copie.
- Clic simple → la sélection se vide. Redimensionner la fenêtre → la sélection se vide.
- Sur l'alt screen (vim/less) : drag-sélection avec Shift se comporte comme avant.

- [ ] **Step 8: Commit**

```bash
git add crates/terminal-renderer/src/lib.rs src/components/TerminalWebGPU.tsx
git commit -m "feat(terminal): anchor selection to scrollback content"
```

---

### Task 7: Extension de la sélection à la molette + auto-scroll au bord

**Files:**
- Modify: `src/components/TerminalWebGPU.tsx` (nouvel effet + auto-scroll dans `onMove`/`onUp`)

- [ ] **Step 1: Re-ancrage de l'extrémité quand le viewport scrolle pendant un drag**

Dans `src/components/TerminalWebGPU.tsx`, ajouter ce useEffect juste après le useEffect des window-level mouse listeners (après la ligne ~897) :

```tsx
  // While a drag is in progress, a wheel or edge auto-scroll moves the
  // content under a (possibly stationary) cursor: re-anchor the selection
  // end to the cell currently under the last known mouse position so the
  // selection keeps extending past one screen.
  useEffect(() => {
    const start = dragStartRef.current;
    const pos = lastDragPosRef.current;
    const r = rendererRef.current;
    if (!start || !dragMovedRef.current || !pos || !r) return;
    const { col, row } = selectionCellAt(pos.x, pos.y);
    const totalRow = visibleStartRow() + row;
    selectionRef.current = {
      startCol: start.col,
      startRow: start.row,
      endCol: col,
      endRow: totalRow,
    };
    r.set_selection(start.col, start.row, col, totalRow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.screen?.scroll_offset, pane.screen?.scroll_max]);
```

(`scroll_max` dans les deps couvre le cas « au live, du nouvel output arrive pendant le drag » : l'offset reste 0 mais le contenu défile.)

- [ ] **Step 2: Auto-scroll au bord pendant le drag**

1. Ajouter les refs et le helper près des autres refs de sélection (après `lastDragPosRef`) :

```tsx
  // Edge auto-scroll while drag-selecting past the top/bottom border.
  const autoScrollTimerRef = useRef<number | null>(null);
  const autoScrollDeltaRef = useRef(0);
```

et, après la fonction `selectionCellAt` :

```tsx
  const stopAutoScroll = () => {
    if (autoScrollTimerRef.current !== null) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
    autoScrollDeltaRef.current = 0;
  };
```

2. Dans le handler `onMove` (bloc drag-select de la Task 6), juste après la ligne `r.set_selection(start.col, start.row, col, totalRow);`, ajouter :

```tsx
      // Edge auto-scroll: dragging past the top/bottom edge scrolls into
      // history/live (speed ∝ overshoot, one tick per 50ms). The selection
      // end is re-anchored by the scroll_offset effect on each repaint.
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const cellH = cellRef.current.h;
        let delta = 0;
        if (e.clientY < rect.top) {
          // Backend convention: positive delta = scroll INTO history (up).
          delta = Math.ceil((rect.top - e.clientY) / cellH);
        } else if (e.clientY > rect.bottom) {
          delta = -Math.ceil((e.clientY - rect.bottom) / cellH);
        }
        autoScrollDeltaRef.current = delta;
        if (delta !== 0 && autoScrollTimerRef.current === null) {
          autoScrollTimerRef.current = window.setInterval(() => {
            const d = autoScrollDeltaRef.current;
            if (d === 0 || !dragStartRef.current) {
              stopAutoScroll();
              return;
            }
            void invoke("scroll_terminal", { sessionId: pane.id, delta: d });
          }, 50);
        } else if (delta === 0) {
          stopAutoScroll();
        }
      }
```

3. Dans `onUp`, à côté de `lastDragPosRef.current = null;`, ajouter :

```tsx
      stopAutoScroll();
```

4. Dans le cleanup du useEffect des window-level listeners (le `return () => {…}` ligne ~892), ajouter :

```tsx
      stopAutoScroll();
```

- [ ] **Step 3: Typecheck + lint + vérification manuelle**

Run: `npx tsc --noEmit` puis `npx eslint src`
Expected: 0 erreur.

Run: `pnpm tauri dev`, dans un shell avec beaucoup d'historique :
- Démarrer un drag, **scroller à la molette sans bouger la souris** → la sélection s'étend ligne à ligne au-delà d'un écran.
- Maintenir le drag et sortir le curseur **au-dessus** du terminal → auto-scroll vers l'historique, vitesse croissante avec le dépassement ; **en-dessous** → auto-scroll vers le live. Relâcher → l'auto-scroll s'arrête.
- Ctrl+C après une sélection multi-écrans → tout le texte sélectionné est collé.
- Vérifier qu'un clic simple et le click-sur-lien fonctionnent toujours.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalWebGPU.tsx
git commit -m "feat(terminal): extend selection on wheel scroll and edge auto-scroll"
```

---

### Task 8: Passe finale

**Files:**
- Aucun nouveau — vérifications globales.

- [ ] **Step 1: Vérifications complètes**

Run, dans l'ordre :
- `npx tsc --noEmit` → 0 erreur
- `npx eslint src` → 0 erreur
- `npx prettier --check "src/**/*.{ts,tsx,css,json}"` → clean (sinon `pnpm run format` puis re-commit)
- `cargo test --manifest-path src-tauri/Cargo.toml` → tout vert
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` et `cargo fmt --manifest-path crates/terminal-renderer/Cargo.toml -- --check` → clean
- `pnpm run build:renderer:dev` → OK

- [ ] **Step 2: Test de bout en bout des trois features**

`pnpm tauri dev` : dérouler une session réelle — taper dans 2 projets inactifs (bascule sidebar ×2), écrire et copier 3 prompts dans le bloc-note sur 2 projets différents, redémarrer l'app et vérifier la persistance, sélectionner 200+ lignes au drag + molette + auto-scroll et coller le résultat.

- [ ] **Step 3: Commit de la passe de format éventuelle**

```bash
git add -A
git commit -m "chore: format pass after notepad/selection features"
```

(Uniquement si la passe Prettier/fmt a modifié des fichiers.)
