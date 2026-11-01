import { Fragment, useLayoutEffect, useRef } from "react";
import { History, Plug, Undo2 } from "lucide-react";
import {
  slashHead,
  type McpAction,
  type McpRow,
  type PickerRow,
} from "@/lib/chat/chatSlash";
import type { RewindMode } from "@/lib/chat/useSlashActions";
import type { SlashMenu } from "@/lib/chat/useSlashMenu";

const PANEL_TITLES = {
  resume: "Reprendre une conversation",
  rewind: "Revenir avant un message",
  mcp: "Serveurs MCP",
};

const PANEL_ICONS = { resume: History, rewind: Undo2, mcp: Plug };

const PANEL_KEYS = {
  resume: "Entrée : reprendre · Échap : fermer",
  rewind:
    "Entrée : revenir ici · Ctrl+Entrée : avec le code · Alt+Entrée : le code seul · Échap : fermer",
  mcp: "Entrée : se connecter ou reconnecter · Ctrl+Entrée : couper ou rallumer · Échap : fermer",
};

/** /mcp's buttons: Enter's action on a server's row. */
const MCP_BUTTONS: Partial<Record<McpAction, string>> = {
  connect: "Se connecter",
  reconnect: "Reconnecter",
};

/** /rewind's other choices on the selected row, besides Enter's. */
const REWIND_CHOICES: [RewindMode, string, string][] = [
  ["both", "+ le code", "Revenir ici et remettre le code (Ctrl+Entrée)"],
  [
    "code",
    "code seul",
    "Remettre le code comme avant ce message, la conversation reste (Alt+Entrée)",
  ],
];

const PANEL_EMPTY = {
  resume: "Aucune autre conversation dans ce dossier",
  rewind: "Aucun message à reprendre",
  mcp: "Aucun serveur MCP",
};

/**
 * The popup above the input (`useSlashMenu`): the `/` commands by group, a
 * page command's panel (/resume, /rewind), or a notice. Clicks keep the
 * focus in the input (`onMouseDown`), where the keys are read.
 */
export function ChatSlashMenu({ menu }: { menu: SlashMenu }) {
  const { view } = menu;
  const onRef = useRef<HTMLElement | null>(null);
  const index = view && view.kind !== "hint" ? view.index : -1;
  // The selected row stays in sight (REVIEW.md, « Rangée qui déborde »).
  useLayoutEffect(() => {
    onRef.current?.scrollIntoView({ block: "nearest" });
  }, [index, view?.kind]);
  if (!view) return null;

  const keep = (e: React.MouseEvent) => e.preventDefault();

  if (view.kind === "hint") {
    return (
      <div className="chat-slash" onMouseDown={keep}>
        <div className="chat-slash-hint">{view.text}</div>
      </div>
    );
  }

  if (view.kind === "menu") {
    return (
      <div className="chat-slash" onMouseDown={keep}>
        {view.entries.map((entry, i) => {
          const { command } = entry;
          const head = slashHead(view.entries, i);
          // Headers beside the rows, not around them: they stick on scroll.
          return (
            // Claude Code's rows can share a name (a built-in and a skill).
            <Fragment key={`${entry.group}:${command.name}:${i}`}>
              {head && <div className="chat-slash-group">{head}</div>}
              <button
                type="button"
                ref={
                  i === view.index
                    ? (el) => void (onRef.current = el)
                    : undefined
                }
                className={`chat-slash-item${i === view.index ? " on" : ""}`}
                onMouseMove={() => i !== view.index && menu.select(i)}
                onClick={() => menu.choose(entry)}
              >
                <span className="name">/{command.name}</span>
                {command.argumentHint && (
                  <span className="args">{command.argumentHint}</span>
                )}
                <span className="desc">{command.description}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
    );
  }

  const { panel, rows } = view;
  const rowRef = (i: number) =>
    i === view.index
      ? (el: HTMLElement | null) => void (onRef.current = el)
      : undefined;
  /**
   * /mcp (the user's pick A of 01/11/2026): its section's title, a dot of
   * its state, its name and where it is set; « Se connecter » or
   * « Reconnecter », a switch on a server connected or cut off; while its
   * sign-in is open in the browser, a line says so.
   */
  const mcpRow = (r: McpRow, i: number) => {
    const p = view.pending?.[r.id];
    const busy = p && "state" in p ? p.state : null;
    const error = p && "error" in p ? p.error : r.error;
    const button = r.action && MCP_BUTTONS[r.action];
    const on = r.status === "connected";
    return (
      <Fragment key={r.id}>
        {r.head && <div className="chat-slash-group">{r.head}</div>}
        <div
          ref={rowRef(i)}
          className={`chat-pick chat-mcp-row ${r.status}${i === view.index ? " on" : ""}`}
          onMouseMove={() => i !== view.index && menu.select(i)}
          onClick={() => menu.mcpPick(r, false)}
        >
          <span className={`dot${busy ? " wait" : ""}`} />
          <span className="t" title={r.id}>
            {r.title}
            {r.source && <small>{r.source}</small>}
          </span>
          {busy ? (
            <span className="m">
              {busy === "signin" ? "ouvert dans le navigateur…" : "…"}
            </span>
          ) : (
            <>
              {r.status === "pending" && (
                <span className="m">connexion en cours</span>
              )}
              {button && (
                <button
                  type="button"
                  className="code main"
                  onClick={(e) => {
                    e.stopPropagation();
                    menu.mcpPick(r, false);
                  }}
                >
                  {button}
                </button>
              )}
              {(on || r.status === "disabled") && (
                <button
                  type="button"
                  className={`chat-mcp-switch${on ? " on" : ""}`}
                  title={
                    on
                      ? "Couper ce serveur (Ctrl+Entrée)"
                      : "Rallumer ce serveur (Ctrl+Entrée)"
                  }
                  aria-label={on ? "Couper" : "Rallumer"}
                  onClick={(e) => {
                    e.stopPropagation();
                    menu.mcpPick(r, true);
                  }}
                />
              )}
            </>
          )}
        </div>
        {error && <div className="chat-mcp-err">{error}</div>}
      </Fragment>
    );
  };
  const row = (r: PickerRow, i: number) => (
    <div
      key={r.id}
      ref={rowRef(i)}
      className={`chat-pick${i === view.index ? " on" : ""}${r.disabled ? " off" : ""}`}
      onMouseMove={() => i !== view.index && menu.select(i)}
      onClick={() => menu.pick(r)}
    >
      <span className="t">{r.title}</span>
      {r.disabled ? (
        <span className="tag">{r.disabled}</span>
      ) : (
        panel === "rewind" &&
        i === view.index &&
        REWIND_CHOICES.map(([mode, label, title]) => (
          <button
            key={mode}
            type="button"
            className="code"
            title={title}
            onClick={(e) => {
              e.stopPropagation();
              menu.pick(r, mode);
            }}
          >
            {label}
          </button>
        ))
      )}
      <span className="m">{r.meta}</span>
    </div>
  );
  const Icon = PANEL_ICONS[panel];
  return (
    <div className="chat-slash panel" onMouseDown={keep}>
      <div className="chat-slash-title">
        <Icon />
        {PANEL_TITLES[panel]}
        <small>tape pour filtrer</small>
      </div>
      {view.error ? (
        <div className="chat-slash-hint error">{view.error}</div>
      ) : rows === null ? (
        <div className="chat-slash-hint">Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="chat-slash-hint">{PANEL_EMPTY[panel]}</div>
      ) : (
        <div className="chat-slash-rows">
          {panel === "mcp" ? (rows as McpRow[]).map(mcpRow) : rows.map(row)}
        </div>
      )}
      <div className="chat-slash-keys">{PANEL_KEYS[panel]}</div>
    </div>
  );
}
