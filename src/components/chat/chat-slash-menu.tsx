import { Fragment, useLayoutEffect, useRef } from "react";
import { History, Undo2 } from "lucide-react";
import { SLASH_GROUP_LABELS, type PickerRow } from "@/lib/chat/chatSlash";
import type { RewindMode } from "@/lib/chat/useSlashActions";
import type { SlashMenu } from "@/lib/chat/useSlashMenu";

const PANEL_TITLES = {
  resume: "Reprendre une conversation",
  rewind: "Revenir avant un message",
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
          const head = i === 0 || view.entries[i - 1].group !== entry.group;
          // Headers beside the rows, not around them: they stick on scroll.
          return (
            // Claude Code's rows can share a name (a built-in and a skill).
            <Fragment key={`${entry.group}:${command.name}:${i}`}>
              {head && (
                <div className="chat-slash-group">
                  {SLASH_GROUP_LABELS[entry.group]}
                </div>
              )}
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
  const row = (r: PickerRow, i: number) => (
    <div
      key={r.id}
      ref={i === view.index ? (el) => void (onRef.current = el) : undefined}
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
  return (
    <div className="chat-slash panel" onMouseDown={keep}>
      <div className="chat-slash-title">
        {panel === "resume" ? <History /> : <Undo2 />}
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
        <div className="chat-slash-rows">{rows.map(row)}</div>
      )}
      <div className="chat-slash-keys">
        {panel === "resume"
          ? "Entrée : reprendre · Échap : fermer"
          : "Entrée : revenir ici · Ctrl+Entrée : avec le code · Alt+Entrée : le code seul · Échap : fermer"}
      </div>
    </div>
  );
}
