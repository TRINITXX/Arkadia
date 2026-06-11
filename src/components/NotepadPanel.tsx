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

function nowMs(): number {
  return Date.now();
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
      createdAt: nowMs(),
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
