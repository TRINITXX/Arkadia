import { useEffect, useMemo, useRef, useState } from "react";
import type {
  McpServerInfo,
  RewindPoint,
  SessionChoice,
  SlashCommandInfo,
} from "@/lib/chat/chatProtocol";
import { openUrl } from "@/lib/bridge";
import {
  commandText,
  isListed,
  mcpRows,
  menuCommands,
  needsArgs,
  pageCommand,
  parseSlash,
  rewindRows,
  sessionRows,
  slashEntries,
  TERMINAL_ONLY,
  terminalOnlyNotice,
  type McpAction,
  type McpRow,
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
  /** /mcp: the servers as last told, and what its buttons ask. */
  mcp?: {
    servers: McpServerInfo[];
    act: (server: string, action: McpAction) => Promise<string | undefined>;
    refresh: () => void;
  };
}

/** A /mcp row's action under way: asked, its sign-in open, or why it failed. */
export type McpPending = { state: "asking" | "signin" } | { error: string };

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
      /** /mcp: its actions under way, by server. */
      pending?: Record<string, McpPending>;
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
  const [mcpPending, setMcpPending] = useState<Record<string, McpPending>>({});
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
  // /mcp's list is the chat's own, told as it changes: asked again on open.
  const mcpRefresh = slash.mcp?.refresh;
  useEffect(() => {
    if (panel === "mcp") mcpRefresh?.();
  }, [panel, mcpRefresh]);
  useEffect(() => {
    if (!panel || panel === "mcp" || !actions) return;
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

  const mcpServers = slash.mcp?.servers;
  const rows = useMemo((): PickerRow[] | null => {
    if (panel === "mcp") return mcpRows(mcpServers ?? [], filter);
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
  }, [panel, loaded, filter, slash.sessionId, mcpServers]);

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
      error: panel === "mcp" ? undefined : loaded?.error,
      pending: mcpPending,
      // The current session can't be taken: start on the next one.
      index: at(
        rows?.length ?? 0,
        Math.max(0, rows?.findIndex((r) => !r.disabled) ?? 0),
      ),
    };
  } else if (entries.length > 0 && dismissed !== text) {
    view = { kind: "menu", entries, index: at(entries.length) };
  }

  /** Whether `intercept` takes this message: it then rewrites the input. */
  const takes = (message: string): boolean => {
    const cmd = parseSlash(message);
    return (
      !!cmd &&
      (!!pageCommand(cmd.name) ||
        (TERMINAL_ONLY.has(cmd.name) &&
          !isListed(slash.commands, slash.names, cmd.name)))
    );
  };

  /** A command the page answers itself: true when nothing is to be sent. */
  const intercept = (message: string): boolean => {
    const cmd = parseSlash(message);
    if (!cmd || !takes(message)) return false;
    if (pageCommand(cmd.name)) {
      setText(`/${cmd.name} ${cmd.args}`);
      return true;
    }
    setText(message);
    setHint({ text: terminalOnlyNotice(cmd.name), for: message });
    return true;
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

  /** /mcp: Enter's action on a row, or Ctrl+Enter's (`toggle`). */
  const mcpPick = (row: McpRow, toggle: boolean) => {
    const action = toggle ? row.toggle : row.action;
    const mcp = slash.mcp;
    const now = mcpPending[row.id];
    if (!action || !mcp || (now && "state" in now)) return;
    const server = row.id;
    const set = (p: McpPending | null) =>
      setMcpPending((all) => {
        const next = { ...all };
        if (p) next[server] = p;
        else delete next[server];
        return next;
      });
    set({ state: "asking" });
    mcp.act(server, action).then(
      (authUrl) => {
        if (!authUrl) return set(null);
        // Signed in in the browser: the row turns green once the chat sees it.
        set({ state: "signin" });
        openUrl(authUrl).catch((e: unknown) => set({ error: String(e) }));
      },
      (e: unknown) =>
        set({ error: e instanceof Error ? e.message : String(e) }),
    );
  };

  // A server connected or cut off since: its sign-in is over.
  useEffect(() => {
    setMcpPending((all) => {
      const over = Object.keys(all).filter((name) => {
        const p = all[name];
        const s = mcpServers?.find((x) => x.name === name);
        return (
          "state" in p &&
          p.state === "signin" &&
          (s?.status === "connected" || s?.status === "disabled")
        );
      });
      if (over.length === 0) return all;
      const next = { ...all };
      for (const name of over) delete next[name];
      return next;
    });
  }, [mcpServers]);

  const pick = (row: PickerRow, mode: RewindMode = "conversation") => {
    if (panel === "mcp") {
      mcpPick(row as McpRow, mode !== "conversation");
      return;
    }
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

  return { view, onKeyDown, takes, intercept, select, choose, pick, mcpPick };
}

export type SlashMenu = ReturnType<typeof useSlashMenu>;
