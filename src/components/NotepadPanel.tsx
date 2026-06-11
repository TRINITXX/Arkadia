import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText as writeClipboard } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy, Pencil, Trash2, X } from "lucide-react";
import {
  EDITOR_HEIGHT_MIN,
  HISTORY_CAP,
  PANEL_WIDTH_DEFAULT,
  clampPanelWidth,
  loadEditorHeight,
  loadPanelWidth,
  loadProjectNotepad,
  newEntryId,
  saveEditorHeight,
  savePanelWidth,
  saveProjectNotepad,
  type NotepadEntry,
} from "@/lib/notepadStore";

const DRAFT_SAVE_DEBOUNCE_MS = 500;
const COPIED_FLASH_MS = 1200;

function nowMs(): number {
  return Date.now();
}

function defaultEditorHeight(): number {
  return Math.round(window.innerHeight / 2);
}

function clampEditorHeight(h: number): number {
  // Leave room for the header, the Copy button and a slice of history.
  return Math.max(EDITOR_HEIGHT_MIN, Math.min(window.innerHeight - 160, h));
}

function deferCaret(ta: HTMLTextAreaElement, pos: number): void {
  // Restore the caret after React re-renders the controlled textarea.
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(pos, pos);
  });
}

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
  const [editorHeight, setEditorHeight] = useState<number>(defaultEditorHeight);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<NotepadEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live mirrors so window-level resize handlers, unmount flush, and
  // project-switch flush read current values without re-subscribing.
  const historyRef = useRef(history);
  const widthRef = useRef(width);
  const editorHeightRef = useRef(editorHeight);
  const draftRef = useRef(draft);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);
  useEffect(() => {
    editorHeightRef.current = editorHeight;
  }, [editorHeight]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Panel width + editor height: load once.
  useEffect(() => {
    void loadPanelWidth().then(setWidth);
    void loadEditorHeight().then((h) => {
      if (h !== null) setEditorHeight(clampEditorHeight(h));
    });
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
      // Flush a pending debounced draft save so closing the panel (or
      // switching project) within the debounce window loses nothing.
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
        if (projectId) {
          void saveProjectNotepad(projectId, {
            draft: draftRef.current,
            history: historyRef.current,
          });
        }
      }
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

  // Archives `text` at the head of the project history and clears the editor.
  const archiveDraft = (text: string) => {
    if (!projectId || !loaded) return;
    const entry: NotepadEntry = {
      id: newEntryId(),
      text,
      createdAt: nowMs(),
    };
    const next = [entry, ...historyRef.current].slice(0, HISTORY_CAP);
    setHistory(next);
    setDraft("");
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    persist(projectId, "", next);
    flashCopied(entry.id);
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
    archiveDraft(text);
    textareaRef.current?.focus();
  };

  // Ctrl+A then Ctrl+C / Ctrl+X: copying or cutting the WHOLE draft validates
  // it — archive to history and clear the editor, like the Copy button.
  // Partial copies stay plain copies. We take over the clipboard write
  // (preventDefault + setData): clearing the editor re-renders the textarea,
  // which could otherwise race the native default action and copy nothing.
  const onEditorCopyOrCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current;
    if (!ta || !projectId || !loaded) return;
    if (ta.selectionStart !== 0 || ta.selectionEnd !== ta.value.length) return;
    const text = ta.value.trimEnd();
    if (text.trim().length === 0) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
    archiveDraft(text);
  };

  // Pasting an image (e.g. a PrintScreen capture) saves it to disk via the
  // backend and inserts the file path at the caret, ready for a prompt.
  // Text pastes are left to the native handler.
  const onEditorPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find((it) =>
      it.type.startsWith("image/"),
    );
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    const ext = item.type.split("/")[1] ?? "png";
    void (async () => {
      try {
        const buf = await file.arrayBuffer();
        const path = await invoke<string>("save_screenshot", {
          bytes: Array.from(new Uint8Array(buf)),
          ext,
        });
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const next =
          ta.value.slice(0, start) + path + ta.value.slice(ta.selectionEnd);
        onDraftChange(next);
        deferCaret(ta, start + path.length);
      } catch (err) {
        console.error("[arkadia] screenshot paste failed:", err);
      }
    })();
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

  // Editor height resize: drag the divider between the editor and history.
  const onEditorResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = editorHeightRef.current;
    const onMove = (ev: MouseEvent) => {
      setEditorHeight(clampEditorHeight(startHeight + (ev.clientY - startY)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      void saveEditorHeight(editorHeightRef.current);
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
          <div className="flex shrink-0 flex-col gap-2 p-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onCopy={onEditorCopyOrCut}
              onCut={onEditorCopyOrCut}
              onPaste={onEditorPaste}
              placeholder="write a prompt…"
              spellCheck={false}
              disabled={!loaded}
              style={{ height: editorHeight }}
              className="resize-none rounded border border-zinc-800 bg-zinc-900 p-2 text-xs leading-5 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <button
              onClick={() => void copyDraft()}
              disabled={!loaded || draft.trim().length === 0}
              className="flex h-7 items-center justify-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 text-xs text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
            >
              <Copy size={12} />
              <span>Copy</span>
              <span className="text-zinc-500">Ctrl+A · Ctrl+C</span>
            </button>
          </div>

          <div
            onMouseDown={onEditorResizeStart}
            className="h-1 shrink-0 cursor-row-resize border-t border-zinc-800 hover:bg-zinc-600"
          />

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
