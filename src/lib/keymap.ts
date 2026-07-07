/**
 * Translates a React keyboard event into the raw bytes to write to a PTY.
 *
 * Shared by the main terminal and the notification popup's reply field so the
 * popup behaves *exactly* like Arkadia's terminal input: every shortcut is just
 * forwarded to the PTY, so the running app (Claude Code) interprets them — e.g.
 * `Alt+V` → `ESC v` (paste clipboard image), held space → repeated `0x20`
 * (voice mode), readline word-motions, etc.
 *
 * Returns `null` when the event produces no byte sequence (pure modifiers,
 * unhandled combos) so the caller can let it through.
 */
/**
 * Human-readable label for a keyboard shortcut, e.g. "Shift+Tab", "Ctrl+C",
 * "Esc", "↑". Used to display a prompt-bar shortcut button captured live in the
 * settings editor. Modifier order is stable (Ctrl, Alt, Shift, Meta).
 */
export function describeKeyEvent(e: React.KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  const named: Record<string, string> = {
    " ": "Space",
    Escape: "Esc",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "⌫",
    Delete: "Del",
    Home: "Home",
    End: "End",
    PageUp: "PgUp",
    PageDown: "PgDn",
    Insert: "Ins",
  };
  const key =
    named[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return [...mods, key].join("+");
}

export function keyEventToBytes(e: React.KeyboardEvent): Uint8Array | null {
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    switch (e.key) {
      case "ArrowLeft":
        return new TextEncoder().encode("\x1b[1;5D");
      case "ArrowRight":
        return new TextEncoder().encode("\x1b[1;5C");
      case "ArrowUp":
        return new TextEncoder().encode("\x1b[1;5A");
      case "ArrowDown":
        return new TextEncoder().encode("\x1b[1;5B");
      // Ctrl+Backspace → Ctrl+W (backward-kill-word). PSReadLine, bash readline,
      // zsh, Claude Code all interpret 0x17 as "delete previous word".
      case "Backspace":
        return new Uint8Array([0x17]);
      // Ctrl+Delete → Alt+D (kill-word forward) in readline conventions.
      case "Delete":
        return new TextEncoder().encode("\x1bd");
    }
  }
  switch (e.key) {
    case "Enter":
      // Shift+Enter sends ESC+CR (a.k.a. Alt-Enter) — Claude Code and most
      // readline-style apps interpret this as "newline without submit".
      return new TextEncoder().encode(e.shiftKey ? "\x1b\r" : "\r");
    case "Backspace":
      return new Uint8Array([0x7f]);
    case "Tab":
      return new TextEncoder().encode(e.shiftKey ? "\x1b[Z" : "\t");
    case "Escape":
      return new TextEncoder().encode("\x1b");
    case "ArrowUp":
      return new TextEncoder().encode("\x1b[A");
    case "ArrowDown":
      return new TextEncoder().encode("\x1b[B");
    case "ArrowRight":
      return new TextEncoder().encode("\x1b[C");
    case "ArrowLeft":
      return new TextEncoder().encode("\x1b[D");
    case "Home":
      return new TextEncoder().encode("\x1b[H");
    case "End":
      return new TextEncoder().encode("\x1b[F");
    case "PageUp":
      return new TextEncoder().encode("\x1b[5~");
    case "PageDown":
      return new TextEncoder().encode("\x1b[6~");
    case "Insert":
      return new TextEncoder().encode("\x1b[2~");
    case "Delete":
      return new TextEncoder().encode("\x1b[3~");
  }
  if (e.key.startsWith("F") && e.key.length <= 3) {
    const n = parseInt(e.key.slice(1), 10);
    if (n >= 1 && n <= 4) {
      return new TextEncoder().encode(`\x1bO${"PQRS"[n - 1]}`);
    }
    if (n >= 5 && n <= 12) {
      const map: Record<number, string> = {
        5: "15",
        6: "17",
        7: "18",
        8: "19",
        9: "20",
        10: "21",
        11: "23",
        12: "24",
      };
      return new TextEncoder().encode(`\x1b[${map[n]}~`);
    }
  }
  if (e.key.length === 1) {
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const code = e.key.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) return new Uint8Array([code - 96]);
      if (e.key === "@") return new Uint8Array([0x00]);
      if (e.key === "[") return new Uint8Array([0x1b]);
      if (e.key === "\\") return new Uint8Array([0x1c]);
      if (e.key === "]") return new Uint8Array([0x1d]);
      if (e.key === "^") return new Uint8Array([0x1e]);
      if (e.key === "_") return new Uint8Array([0x1f]);
      return null;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const enc = new TextEncoder().encode(e.key);
      const out = new Uint8Array(enc.length + 1);
      out[0] = 0x1b;
      out.set(enc, 1);
      return out;
    }
    return new TextEncoder().encode(e.key);
  }
  return null;
}
