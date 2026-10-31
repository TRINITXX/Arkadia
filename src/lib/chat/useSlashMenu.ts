import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RewindPoint,
  SessionChoice,
  SlashCommandInfo,
} from "@/lib/chat/chatProtocol";
import {
  commandText,
  isListed,
  menuCommands,
  needsArgs,
  pageCommand,
  parseSlash,
  rewindRows,
  sessionRows,
  slashEntries,
  TERMINAL_ONLY,
  terminalOnlyNotice,
  type PagePanel,
  type PickerRow,
  type SlashEntry,
} from "@/lib/chat/chatSlash";
import type { RewindMode, SlashActions } from "@/lib/chat/useSlashActions";

/** What the input card hands its `/` menu. */
export interface ChatSlash {
  /** Claude Code's commands, with their descriptions. */
  commands: SlashCommandInfo[];
  /** Their names alone (init's `slash_commands`), until the full list comes. */
  names: string[];
  sessionId: string | null;
  /** The page's commands' work; absent, their panels stay empty (preview). */
  actions?: SlashActions;
}

/** What the popup above the input shows. */
export type SlashView =
  | { kind: "menu"; entries: SlashEntry[]; index: number }
  | {
      kind: "panel";
      panel: PagePanel;
      /** Null while the list loads. */
      rows: PickerRow[] | null;
      error?: string;
      index: number;
    }
  | { kind: "hint"; text: string };

type Loaded = {
  panel: PagePanel;
  /** When it came: the rows' « hier 14:32 » count from it. */
  at: number;
  sessions?: SessionChoice[];
  points?: RewindPoint[];
  error?: string;
};

/**
 * The `/` menu of the input (`ChatSlashMenu` draws it). Typing `/` lists the
 * commands, filtered as the name grows; ↑↓ move, Tab completes, Enter runs
 * one without arguments (or completes one that needs them), Esc closes. A
 * page command (/resume, /rewind) opens its panel instead: the text after
 * its name filters the panel's list, Enter takes a row (the rewind: Ctrl+
 * Enter takes the code too, Alt+Enter the code alone). Terminal-only
 * commands get a notice instead of being sent.
 */
export function useSlashMenu({
  text,
  setText,
  slash,
  send,
}: {
  text: string;
  setText: (text: string) => void;
  slash: ChatSlash;
  /** Sends a command as a message, the input emptied; `now` as Ctrl+Enter. */
  send: (text: string, now: boolean) => void;
}) {
  // Each keeps the text it was set for: typing resets it without an effect.
  const [selected, setSelected] = useState({ i: 0, text: "" });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [hint, setHint] = useState<{ text: string; for: string } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** A /resume or /rewind choice under way (`pick`). */
  const picking = useRef(false);

  const commands = useMemo(
    () => menuCommands(slash.commands, slash.names),
    [slash.commands, slash.names],
  );
  const menuQuery = /^\/(\S*)$/.exec(text)?.[1];
  const entries = useMemo(
    () => (menuQuery === undefined ? [] : slashEntries(commands, menuQuery)),
    [commands, menuQuery],
  );
  const opened = /^\/(\S+)\s([\s\S]*)$/.exec(text);
  const panel = opened ? pageCommand(opened[1])?.panel : undefined;
  const filter = opened?.[2] ?? "";

  // A panel loads its list each time it opens.
  const { actions } = slash;
  useEffect(() => {
    if (!panel || !actions) return;
    let alive = true;
    const load: Promise<Omit<Loaded, "at">> =
      panel === "resume"
        ? actions.sessions().then((sessions) => ({ panel, sessions }))
        : actions.rewindPoints().then((points) => ({ panel, points }));
    load.then(
      (data) => alive && setLoaded({ ...data, at: Date.now() }),
      (e: unknown) =>
        alive &&
        setLoaded({
          panel,
          at: Date.now(),
          error: e instanceof Error ? e.message : String(e),
        }),
    );
    return () => {
      alive = false;
      setLoaded(null);
    };
  }, [panel, actions]);

  const rows = useMemo(() => {
    if (!panel || loaded?.panel !== panel) return null;
    if (panel === "resume") {
      return sessionRows(
        loaded.sessions ?? [],
        filter,
        slash.sessionId,
        loaded.at,
      );
    }
    return rewindRows(loaded.points ?? [], filter, loaded.at);
  }, [panel, loaded, filter, slash.sessionId]);

  const at = (count: number, first = 0) =>
    selected.text === text
      ? Math.min(selected.i, Math.max(0, count - 1))
      : first;
  let view: SlashView | null = null;
  if (hint?.for === text) view = { kind: "hint", text: hint.text };
  else if (panel) {
    view = {
      kind: "panel",
      panel,
      rows,
      error: loaded?.error,
      // The current session can't be taken: start on the next one.
      index: at(
        rows?.length ?? 0,
        Math.max(0, rows?.findIndex((r) => !r.disabled) ?? 0),
      ),
    };
  } else if (entries.length > 0 && dismissed !== text) {
    view = { kind: "menu", entries, index: at(entries.length) };
  }

  /** A command the page answers itself: true when nothing is to be sent. */
  const intercept = (message: string): boolean => {
    const cmd = parseSlash(message);
    if (!cmd) return false;
    if (pageCommand(cmd.name)) {
      setText(`/${cmd.name} ${cmd.args}`);
      return true;
    }
    if (
      TERMINAL_ONLY.has(cmd.name) &&
      !isListed(slash.commands, slash.names, cmd.name)
    ) {
      setText(message);
      setHint({ text: terminalOnlyNotice(cmd.name), for: message });
      return true;
    }
    return false;
  };

  const complete = (entry: SlashEntry) =>
    setText(`/${commandText(entry.command)} `);

  /** `now`: Ctrl+Enter, the turn under way stops for it, as typed text. */
  const choose = (entry: SlashEntry, now = false) => {
    const { command } = entry;
    if (pageCommand(command.name) || needsArgs(command.argumentHint)) {
      complete(entry);
      return;
    }
    const message = `/${commandText(command)}`;
    if (!intercept(message)) send(message, now);
  };

  const pick = (row: PickerRow, mode: RewindMode = "conversation") => {
    // One choice at a time: a second relaunch would stop the Claude Code the
    // first one just started (a double click, Enter held).
    if (!panel || row.disabled || !actions || picking.current) return;
    picking.current = true;
    if (panel === "resume") {
      const at = text;
      setHint({ text: "Reprise…", for: at });
      actions
        .resume(row.id)
        .then(
          (why) => {
            if (why) setHint({ text: why, for: at });
            else setText("");
          },
          (e: unknown) =>
            setHint({
              text: e instanceof Error ? e.message : String(e),
              for: at,
            }),
        )
        .finally(() => {
          picking.current = false;
        });
      return;
    }
    try {
      const point = loaded?.points?.find((p) => p.uuid === row.id);
      if (!point) return;
      const why = actions.rewind(point, mode);
      if (why) setHint({ text: why, for: text });
      // Back before the message: it waits in the input, as in the terminal.
      // The code alone: the conversation goes on, the input empties.
      else setText(mode === "code" ? "" : point.text);
    } finally {
      picking.current = false;
    }
  };

  const select = (i: number) => setSelected({ i, text });

  /** The input's keys while the popup shows; true when the key was its. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!view || view.kind === "hint") return false;
    const count =
      view.kind === "menu" ? view.entries.length : (view.rows?.length ?? 0);
    const enter =
      e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      if (count > 0) select((view.index + step + count) % count);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (view.kind === "menu") setDismissed(text);
      else setText("");
      return true;
    }
    if (view.kind === "menu") {
      const entry = view.entries[view.index];
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        complete(entry);
        return true;
      }
      if (enter) {
        e.preventDefault();
        choose(entry, e.ctrlKey || e.metaKey);
        return true;
      }
      return false;
    }
    if (enter || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      const row = view.rows?.[view.index];
      // Enter held down repeats: only its first press chooses.
      if (enter && row && !e.repeat) {
        pick(
          row,
          e.altKey ? "code" : e.ctrlKey || e.metaKey ? "both" : "conversation",
        );
      }
      return true;
    }
    return false;
  };

  return { view, onKeyDown, intercept, select, choose, pick };
}

export type SlashMenu = ReturnType<typeof useSlashMenu>;
